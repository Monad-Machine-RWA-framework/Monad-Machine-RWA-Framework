import * as crypto from "crypto";

/**
 * Cleanverse AES request-body encryption.
 *
 * Spec (from the integration guide):
 *  - Algorithm:   AES
 *  - Cipher mode: AES/CBC/PKCS5Padding  (Node: aes-(128|192|256)-cbc + PKCS#7)
 *  - IV:          fixed 16 zero bytes
 *  - Key:         Base64-decoded `api-key` provided by Cleanverse
 *  - Encoding:    Base64
 *  - Charset:     UTF-8
 *
 * Encrypted endpoints send the ciphertext as `{ "data": "<Base64>" }`.
 */

const ZERO_IV = Buffer.alloc(16, 0);

function cipherName(keyLen: number): string {
  switch (keyLen) {
    case 16:
      return "aes-128-cbc";
    case 24:
      return "aes-192-cbc";
    case 32:
      return "aes-256-cbc";
    default:
      throw new Error(
        `Cleanverse api-key must decode to 16/24/32 bytes (got ${keyLen})`
      );
  }
}

/** Encrypt a plaintext JSON string and return Base64 ciphertext. */
export function encrypt(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  const cipher = crypto.createCipheriv(cipherName(key.length), key, ZERO_IV);
  // Node enables PKCS#7 padding by default, equivalent to PKCS5Padding here.
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return enc.toString("base64");
}

/** Decrypt Base64 ciphertext back to a plaintext string. */
export function decrypt(base64Ciphertext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  const decipher = crypto.createDecipheriv(cipherName(key.length), key, ZERO_IV);
  const dec = Buffer.concat([
    decipher.update(Buffer.from(base64Ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Wrap a request object into the encrypted `{ data }` envelope. */
export function encryptBody(body: unknown, base64Key: string): { data: string } {
  return { data: encrypt(JSON.stringify(body), base64Key) };
}
