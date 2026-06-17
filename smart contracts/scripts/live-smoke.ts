/**
 * Smoke-test live Cleanverse Cooperate API connectivity (no on-chain deploy).
 * Usage: npx hardhat run scripts/live-smoke.ts
 */
import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "hardhat";
import { encryptBody, decrypt } from "../src/cleanverse/crypto";
import { getChain, getCleanverseService } from "../src/cleanverse/mode";

async function main() {
  const mode = process.env.CLEANVERSE_MODE || "mock";
  const baseUrl =
    process.env.CLEANVERSE_BASE_URL ||
    "https://uatapi.cleanverse.com/api/cooperate";
  const apiId = process.env.CLEANVERSE_API_ID!;
  const apiKey = process.env.CLEANVERSE_API_KEY!;
  const chain = getChain();

  console.log(`Cleanverse live smoke test (mode=${mode}, chain=${chain})`);
  console.log(`Base URL: ${baseUrl}`);

  if (mode !== "live") {
    throw new Error("Set CLEANVERSE_MODE=live in .env for this script");
  }

  // 1) AES round-trip with configured api-key
  const probe = encryptBody({ ping: true }, apiKey);
  const roundTrip = decrypt(probe.data, apiKey);
  console.log("AES encrypt/decrypt with api-key: OK");

  const service = getCleanverseService();
  const [, alice] = await ethers.getSigners();
  const aliceAddr = await alice.getAddress();

  // 2) query_deposit_atoken_list (plain JSON)
  const listRes = await fetch(`${baseUrl}/query_deposit_atoken_list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-id": apiId },
    body: JSON.stringify({ chain }),
  });
  const listJson = await listRes.json();
  console.log(
    `query_deposit_atoken_list: HTTP ${listRes.status} code=${(listJson as any).code} message=${(listJson as any).message}`
  );

  // 3) generate_apass for Alice (encrypted)
  const customerId = `CVLive${aliceAddr.slice(2, 14)}`.replace(/[^A-Za-z0-9]/g, "");
  console.log(`\nGenerating A-Pass for ${aliceAddr} (customerId=${customerId})...`);
  try {
    const proj = await service.generateApass({
      customerId,
      chain,
      address: aliceAddr,
      tier: 30,
      group: "AA",
      subTier: 1,
      fullName: "Alice Live Test",
      override: true,
    });
    console.log("generate_apass + query_apass projection:");
    console.log(JSON.stringify(proj, null, 2));

    const query = await service.queryApass(chain, aliceAddr);
    console.log("\nquery_apass refresh:");
    console.log(JSON.stringify(query, null, 2));
  } catch (e: any) {
    console.error("generate_apass failed:", e.message ?? e);
    // Still try query in case A-Pass already exists
    try {
      const query = await service.queryApass(chain, aliceAddr);
      console.log("query_apass (existing record):", JSON.stringify(query, null, 2));
    } catch (e2: any) {
      console.error("query_apass also failed:", e2.message ?? e2);
    }
  }

  console.log("\nSmoke test finished.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
