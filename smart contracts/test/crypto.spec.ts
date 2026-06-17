import { expect } from "chai";
import { encrypt, decrypt, encryptBody } from "../src/cleanverse/crypto";

describe("Cleanverse AES crypto", () => {
  // 32-byte key, Base64-encoded (mirrors the Base64 api-key from Cleanverse).
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round-trips a JSON payload", () => {
    const payload = JSON.stringify({ customerId: "1234561234567892", tier: 30 });
    const ct = encrypt(payload, key);
    expect(ct).to.match(/^[A-Za-z0-9+/=]+$/); // Base64
    expect(decrypt(ct, key)).to.equal(payload);
  });

  it("wraps bodies into the { data } envelope", () => {
    const env = encryptBody({ chain: "monad" }, key);
    expect(env).to.have.property("data");
    expect(JSON.parse(decrypt(env.data, key))).to.deep.equal({ chain: "monad" });
  });

  it("supports 16/24/32 byte keys and rejects others", () => {
    for (const len of [16, 24, 32]) {
      const k = Buffer.alloc(len, 1).toString("base64");
      expect(decrypt(encrypt("x", k), k)).to.equal("x");
    }
    const bad = Buffer.alloc(20, 1).toString("base64");
    expect(() => encrypt("x", bad)).to.throw();
  });
});
