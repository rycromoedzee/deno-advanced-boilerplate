/**
 * @file services/db-backup/dump.ts
 * @description Dump service module (db backup)
 */
import type { LibSQLClient } from "@deps";

const HEADER = "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n";
const FOOTER = "COMMIT;\nPRAGMA foreign_keys=ON;\n";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot serialize non-finite number: ${value}`);
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Uint8Array) {
    const hex = Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
    return `X'${hex}'`;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `X'${hex}'`;
  }
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`Unsupported value type for SQL literal: ${typeof value}`);
}

export function createDumpStream(client: LibSQLClient): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        const tx = await client.transaction("deferred");
        try {
          push(HEADER);

          // Fetch user tables and tag virtuals (so shadow tables are excluded).
          const tablesResult = await tx.execute(
            "SELECT name, sql FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL " +
              "AND name NOT LIKE 'sqlite_%' ORDER BY name",
          );
          const rawTables = tablesResult.rows.map((r) => ({
            name: r.name as string,
            sql: r.sql as string,
          }));
          const isVirtual = (sql: string) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql);
          const virtualNames = new Set(rawTables.filter((t) => isVirtual(t.sql)).map((t) => t.name));

          const shadowSuffixes = ["_data", "_idx", "_content", "_docsize", "_config"];
          const shadowNames = new Set<string>();
          for (const v of virtualNames) {
            for (const s of shadowSuffixes) shadowNames.add(`${v}${s}`);
          }
          const userTables = rawTables.filter((t) => !shadowNames.has(t.name));

          for (const t of userTables) {
            push(`${t.sql};\n`);
          }

          // Preserve AUTOINCREMENT state.
          const seqCheck = await tx.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'",
          );
          if (seqCheck.rows.length > 0) {
            const seqRows = await tx.execute("SELECT name, seq FROM sqlite_sequence");
            if (seqRows.rows.length > 0) {
              push("DELETE FROM sqlite_sequence;\n");
              for (const row of seqRows.rows) {
                const name = sqlLiteral(row.name);
                const seq = sqlLiteral(row.seq);
                push(`INSERT INTO sqlite_sequence (name, seq) VALUES (${name}, ${seq});\n`);
              }
            }
          }

          for (const t of userTables) {
            const rowsResult = await tx.execute(`SELECT * FROM ${quoteIdent(t.name)}`);
            const cols = rowsResult.columns;
            const colList = cols.map(quoteIdent).join(", ");
            for (const row of rowsResult.rows) {
              const values = cols.map((c) => sqlLiteral((row as Record<string, unknown>)[c])).join(", ");
              push(`INSERT INTO ${quoteIdent(t.name)} (${colList}) VALUES (${values});\n`);
            }
          }

          // Emit user-defined indexes
          const idxResult = await tx.execute(
            "SELECT sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name",
          );
          for (const row of idxResult.rows) {
            push(`${row.sql};\n`);
          }

          // Emit triggers
          const trigResult = await tx.execute(
            "SELECT sql FROM sqlite_schema WHERE type='trigger' AND sql IS NOT NULL ORDER BY name",
          );
          for (const row of trigResult.rows) {
            push(`${row.sql};\n`);
          }

          // Emit views
          const viewResult = await tx.execute(
            "SELECT sql FROM sqlite_schema WHERE type='view' AND sql IS NOT NULL ORDER BY name",
          );
          for (const row of viewResult.rows) {
            push(`${row.sql};\n`);
          }

          push(FOOTER);
        } finally {
          try {
            await tx.rollback();
          } catch { /* already closed */ }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}
