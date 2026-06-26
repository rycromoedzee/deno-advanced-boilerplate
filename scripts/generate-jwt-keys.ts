import { ed25519 } from "@noble/curves/ed25519";
import { Buffer } from "node:buffer";

export async function useScriptGenerateJWTKeys() {
  const privateBytes = ed25519.utils.randomPrivateKey();
  const publicBytes = ed25519.getPublicKey(privateBytes);

  return {
    privateKey: Buffer.from(privateBytes).toString("base64"),
    publicKey: Buffer.from(publicBytes).toString("base64"),
  };
}
