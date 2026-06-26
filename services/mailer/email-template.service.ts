/**
 * @file services/mailer/email-template.service.ts
 * @description Email Template service (mailer)
 */
import { compile, TemplateFunction } from "@deps";
import {
  EMAIL_TYPES,
  EmailTemplateStorageConfig,
  IEmailTemplateStorage,
  IncludeLookup,
  LocaleData,
  LocalesConfig,
} from "@interfaces/email.ts";
import { useKVCacheProvider } from "../cache/deno-kv-cache.provider.ts";
// Remove import to break circular dependency
import { DenoKVCacheProvider } from "../cache/index.ts";
import { envConfig } from "../../config/env.ts";

/**
 * Email template storage implementation
 */
export class EmailTemplateStorage implements IEmailTemplateStorage {
  private basePath: string;

  constructor(config?: EmailTemplateStorageConfig) {
    // Allow override via env var, fallback to static/mail
    this.basePath = config?.basePath ||
      Deno.env.get("EMAIL_TEMPLATE_PATH") ||
      new URL("../../static/mail/views", import.meta.url).pathname;
  }

  async getKeys(): Promise<string[]> {
    const keys: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.basePath)) {
        if (entry.isFile && entry.name.endsWith(".ejs")) {
          keys.push(entry.name.replace(".ejs", ""));
        }
      }

      const partialsPath = this.basePath.replace(/views$/, "partials");
      try {
        for await (const entry of Deno.readDir(partialsPath)) {
          if (entry.isFile && entry.name.endsWith(".ejs")) {
            keys.push(`partials:${entry.name.replace(".ejs", "")}`);
          }
        }
      } catch {
        // Partials directory might not exist
      }
    } catch (error) {
      console.error("Error reading template directory:", error);
    }
    return keys;
  }

  async getItem<T = string>(key: string): Promise<T | null> {
    try {
      let path;
      if (key.startsWith("partials:")) {
        const partialsPath = this.basePath.replace(/views$/, "partials");
        path = `${partialsPath}/${key.replace("partials:", "")}.ejs`;
      } else {
        path = `${this.basePath}/${key}.ejs`;
      }
      const content = await Deno.readTextFile(path);
      return content as T;
    } catch {
      return null;
    }
  }
}

/**
 * Email template service for handling template compilation and caching
 *
 * Uses a two-tier caching strategy:
 * - L1: In-memory Map for compiled TemplateFunction (zero-overhead on repeat calls)
 * - L2: DenoKV for raw EJS strings (shared across process restarts/instances)
 */
export class EmailTemplateService {
  private templateStorage: IEmailTemplateStorage;
  /** L2 cache: DenoKV for raw EJS template strings (serializable, shared across instances) */
  private templateStringCache: DenoKVCacheProvider;
  private includesCache: DenoKVCacheProvider;
  /** L1 cache: In-memory Map for compiled TemplateFunction (non-serializable) */
  private compiledTemplateCache: Map<string, TemplateFunction> = new Map();
  /** L1 cache: In-memory project variables from _project-variables.json */
  private projectVariables: Record<string, string> | null = null;
  /** L1 cache: In-memory locale data keyed by locale code */
  private localeCache: Map<string, LocaleData> = new Map();
  /** L1 cache: Locales configuration from _locales.json */
  private localesConfig: LocalesConfig | null = null;

  constructor(templateStorage?: IEmailTemplateStorage) {
    this.templateStorage = templateStorage || new EmailTemplateStorage();
    this.templateStringCache = useKVCacheProvider(60 * 60 * 24);
    this.includesCache = useKVCacheProvider(60 * 60 * 24);
  }

  /**
   * Rewrites asset URLs in HTML to use the Bunny.net CDN base URL.
   * Handles:
   *   - <img src="..."> tags
   *   - background="..." HTML attributes (e.g. <td background="...">)
   *   - CSS url(...) references in inline style attributes and <style> blocks
   * Only rewrites relative paths (not http/https/data URIs).
   * @param html The HTML string to rewrite
   * @returns The HTML string with updated asset URLs
   */
  rewriteImgSrcToBunny(html: string): string {
    const publicUrl = envConfig.public.frontURL.replace(/\/$/, "");
    const BUNNY_CDN_BASE = `https://${publicUrl}/assets/resources/mail`;

    const rewriteUrl = (url: string): string => {
      if (/^(https?:|data:)/.test(url)) return url;
      let cleanUrl = url.replace(/^\/?(mail\/assets\/)?/, "");
      if (!cleanUrl.startsWith("/")) cleanUrl = "/" + cleanUrl;
      return `${BUNNY_CDN_BASE}${cleanUrl}`;
    };

    // Rewrite <img src="..."> tags
    let result = html.replace(
      /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi,
      (match, src) => match.replace(src, rewriteUrl(src)),
    );

    // Rewrite background="..." attribute on any element (e.g. <td background="...">)
    result = result.replace(
      /\bbackground=["']([^"']+)["']/gi,
      (match, bg) => match.replace(bg, rewriteUrl(bg)),
    );

    // Rewrite CSS url(...) references in inline style attributes and <style> blocks
    // Matches: url(path), url('path'), url("path")
    result = result.replace(
      /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
      (_match, quote, url) => {
        const rewritten = rewriteUrl(url.trim());
        return `url(${quote}${rewritten}${quote})`;
      },
    );

    return result;
  }

  /**
   * Clears all template caches (L1 in-memory and L2 DenoKV).
   * Call this after updating email template files to ensure fresh templates are served.
   */
  async clearTemplateCache(): Promise<void> {
    this.compiledTemplateCache.clear();
    this.projectVariables = null;
    this.localeCache.clear();
    this.localesConfig = null;
    await this.templateStringCache.clearNamespace("email-templates");
    await this.includesCache.clearNamespace("email-templates");
  }

  /**
   * Loads and caches the project-level design variables from _project-variables.json.
   * Cached in-memory (L1) for the lifetime of the process; cleared with clearTemplateCache().
   */
  async getProjectVariables(): Promise<Record<string, string>> {
    if (this.projectVariables) {
      return this.projectVariables;
    }

    const varsPath = new URL("../../static/mail/_project-variables.json", import.meta.url).pathname;
    const raw = await Deno.readTextFile(varsPath);
    this.projectVariables = JSON.parse(raw);
    return this.projectVariables!;
  }

  /**
   * Loads the locales configuration from _locales.json.
   * Cached in-memory (L1) for the lifetime of the process.
   */
  async getLocalesConfig(): Promise<LocalesConfig> {
    if (this.localesConfig) {
      return this.localesConfig;
    }

    const configPath = new URL("../../static/mail/_locales.json", import.meta.url).pathname;
    const raw = await Deno.readTextFile(configPath);
    this.localesConfig = JSON.parse(raw) as LocalesConfig;
    return this.localesConfig;
  }

  /**
   * Loads locale data for a given locale code.
   * Falls back to the default locale if the requested locale file is not found.
   * Cached in-memory (L1) for the lifetime of the process; cleared with clearTemplateCache().
   */
  async getLocaleData(locale: string): Promise<LocaleData> {
    const cached = this.localeCache.get(locale);
    if (cached) {
      return cached;
    }

    const localePath = new URL(`../../static/mail/locales/${locale}.json`, import.meta.url).pathname;
    try {
      const raw = await Deno.readTextFile(localePath);
      const data = JSON.parse(raw) as LocaleData;
      this.localeCache.set(locale, data);
      return data;
    } catch {
      // If locale file not found and it's not already the default, fall back
      const config = await this.getLocalesConfig();
      if (locale !== config.defaultLocale) {
        return this.getLocaleData(config.defaultLocale);
      }
      // Default locale file missing — return empty
      return {};
    }
  }

  /**
   * Creates a translation function t() for the given locale.
   * Resolves dot-path keys (e.g. "reset.reset-password") against the nested locale JSON.
   * Falls back to the default locale, then to the raw key if not found.
   */
  async createTranslationFunction(locale: string): Promise<(key: string) => string> {
    const config = await this.getLocalesConfig();
    const localeData = await this.getLocaleData(locale);
    const fallbackData = locale !== config.defaultLocale ? await this.getLocaleData(config.defaultLocale) : null;

    const resolve = (data: LocaleData, key: string): string | undefined => {
      // First try direct flat key lookup (e.g. "sign-up.header" as a literal key)
      const direct = (data as Record<string, unknown>)[key];
      if (typeof direct === "string") return direct;

      // Then try nested dot-path traversal (e.g. "sign-up" -> "header")
      const parts = key.split(".");
      let current: unknown = data;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== "object") {
          return undefined;
        }
        current = (current as Record<string, unknown>)[part];
      }
      return typeof current === "string" ? current : undefined;
    };

    return (key: string): string => {
      return resolve(localeData, key) ?? (fallbackData ? resolve(fallbackData, key) : undefined) ?? key;
    };
  }

  /**
   * Gets email metadata (subject, category) for a template.
   * Subject is resolved from locale files using the template's subjectKey.
   */
  async getEmailMetadata(
    templateName: string,
    language: string,
  ): Promise<{ subject: string; emailCategory: string }> {
    const email = EMAIL_TYPES.find((emailType) => emailType.name === templateName);

    if (!email) {
      throw new Error(`Email ${templateName} not found`);
    }

    const t = await this.createTranslationFunction(language);

    return {
      subject: t(email.subjectKey),
      emailCategory: email.category,
    };
  }

  /**
   * Gets a compiled email template function with two-tier caching
   *
   * L1: In-memory Map for compiled TemplateFunction (zero-overhead on repeat calls)
   * L2: DenoKV for raw EJS strings (shared across process restarts/instances)
   *
   * @param templateName The name of the template (without extension)
   * @returns The compiled template function
   * @throws Error if the template file is not found
   */
  async getEmailTemplate(templateName: string): Promise<TemplateFunction> {
    const cacheKey = `ejs-template-${templateName}`;

    // L1: Check in-memory compiled template cache (fastest path)
    const l1Cached = this.compiledTemplateCache.get(cacheKey);
    if (l1Cached) {
      return l1Cached;
    }

    // Resolve includes (needed for compilation)
    const resolvedIncludes = await this.getOrLoadIncludes();

    // L2: Check DenoKV for raw EJS string
    const l2CachedString = await this.templateStringCache.get<string>(
      "email-templates",
      cacheKey,
    );

    let view: string;
    if (l2CachedString) {
      view = l2CachedString;
    } else {
      // L2 miss: Load from storage
      const loadedView = await this.templateStorage.getItem<string>(templateName);
      if (!loadedView) {
        throw new Error("Email template not found");
      }
      view = loadedView;
      // Cache the raw string in L2 (DenoKV can serialize strings)
      await this.templateStringCache.set(
        "email-templates",
        cacheKey,
        view,
        { ttl: 60 * 60 * 24 },
      );
    }

    // Compile the template (this is fast ~1ms)
    const compiledTemplate = this.compileTemplate(view, resolvedIncludes);

    // Store in L1 in-memory cache (functions can't be serialized to DenoKV)
    this.compiledTemplateCache.set(cacheKey, compiledTemplate);

    return compiledTemplate;
  }

  /**
   * Get or load includes (partials) with caching
   */
  private async getOrLoadIncludes(): Promise<IncludeLookup> {
    const includesLookup = await this.includesCache.get<IncludeLookup>(
      "email-templates",
      "ejs-includes",
    );

    if (includesLookup) {
      return includesLookup;
    }

    const keys = await this.templateStorage.getKeys();
    const includeKeys = keys.filter((k) => k.startsWith("partials:"));

    const resolvedEntries = await Promise.all(
      includeKeys.map(async (includeKey) => {
        const includeContent = await this.templateStorage.getItem<string>(
          includeKey,
        );
        return [includeKey, includeContent || ""];
      }),
    );

    const newIncludesLookup = Object.fromEntries(resolvedEntries);
    await this.includesCache.set(
      "email-templates",
      "ejs-includes",
      newIncludesLookup,
      { ttl: 60 * 60 * 24 },
    );
    return newIncludesLookup;
  }

  /**
   * Compile an EJS template with the includer for partials
   */
  private compileTemplate(
    view: string,
    resolvedIncludes: IncludeLookup,
  ): TemplateFunction {
    return compile(view, {
      includer: (originalPath: string) => {
        let key = originalPath.replace(/^(\.\/|\.\.\/)+/, "").replace(
          /\.ejs$/,
          "",
        );
        if (key.startsWith("partials/")) {
          key = key.replace("partials/", "partials:");
        } else if (!key.startsWith("partials:")) key = `partials:${key}`;
        const includeContent = resolvedIncludes[key];
        if (!includeContent) {
          throw new Error(
            `Could not find include ${originalPath} (resolved as ${key})`,
          );
        }
        return {
          template: includeContent,
        };
      },
    });
  }
}
