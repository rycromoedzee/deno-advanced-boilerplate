// Check to see if ENV Secrets are configured
// If not generate some for the user

import { envConfig } from "@config/env.ts";
import { useScriptGenerateJWTKeys } from "../generate-jwt-keys.ts";

async function generateRandomBase64(length: number = 32): Promise<string> {
  const command = new Deno.Command("sh", {
    args: ["-c", `openssl rand -base64 ${length}`],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const error = new TextDecoder().decode(stderr);
    throw new Error(`Failed to generate random string: ${error}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

async function generateRandomBase64WithStringReplace(
  length: number = 32,
): Promise<string> {
  const command = new Deno.Command("sh", {
    args: ["-c", `openssl rand ${length} | base64 | tr '+/' '-_' | tr -d '='`],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const error = new TextDecoder().decode(stderr);
    throw new Error(`Failed to generate random string: ${error}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

console.log(
  "================================================================",
);
console.log(
  "======================== SECRETS THAT ARE NOT SET ========================",
);

if (
  !envConfig.storage.encryptionKey ||
  envConfig.storage.encryptionKey === undefined
) {
  console.log(`STORAGE ENCRYPTION KEY ==> ${await generateRandomBase64(32)}`);
}

if (
  !envConfig.auth.passwordPepper || envConfig.auth.passwordPepper === undefined
) {
  console.log(`AUTH PASSWORD PEPPER KEY ==> ${await generateRandomBase64(32)}`);
}

if (
  !envConfig.auth.generalEncryptionKey ||
  envConfig.auth.generalEncryptionKey === undefined
) {
  console.log(`AUTH ENCRYPTION KEY ==> ${await generateRandomBase64(32)}`);
}

if (!envConfig.auth.refreshKey || envConfig.auth.refreshKey === undefined) {
  console.log(
    `AUTH REFRESH TOKEN KEY ==> ${await generateRandomBase64WithStringReplace(
      64,
    )}`,
  );
}

if (!envConfig.auth.jwtPrivate || envConfig.auth.jwtPrivate === undefined) {
  const { privateKey, publicKey } = await useScriptGenerateJWTKeys();

  console.log("JWT KEYS:");
  console.log(`PRIVATE KEY: ${privateKey}`);
  console.log(`PUBLIC KEY: ${publicKey}`);
  console.log(`ALGO: EdDSA`);
  console.log(`CURVE: Ed25519`);
}

console.log(
  "================================================================",
);
