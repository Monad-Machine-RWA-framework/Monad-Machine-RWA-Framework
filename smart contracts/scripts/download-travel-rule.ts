/**
 * Download a Travel Rule / Transaction report for a completed transfer.
 * Reads tx hash + participant info from deployments.monad.json by default.
 *
 * Usage:
 *   npx hardhat run scripts/download-travel-rule.ts
 *   TX_HASH=0x... WALLET_ADDRESS=0x... npx hardhat run scripts/download-travel-rule.ts
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

import { CleanverseClient } from "../src/cleanverse/client";
import { getChain } from "../src/cleanverse/mode";

const MONAD_STATE = path.join(__dirname, "..", "deployments.monad.json");

async function main() {
  const baseUrl =
    process.env.CLEANVERSE_BASE_URL ||
    "https://uatapi.cleanverse.com/api/cooperate";
  const apiId = process.env.CLEANVERSE_API_ID;
  const apiKey = process.env.CLEANVERSE_API_KEY;
  if (!apiId || !apiKey) {
    throw new Error("CLEANVERSE_API_ID and CLEANVERSE_API_KEY required");
  }

  const chain = getChain();
  let txHash = process.env.TX_HASH;
  let walletAddress = process.env.WALLET_ADDRESS;
  let customerId = process.env.CUSTOMER_ID;
  let cvRecordId = process.env.CV_RECORD_ID;

  if (fs.existsSync(MONAD_STATE)) {
    const state = JSON.parse(fs.readFileSync(MONAD_STATE, "utf8"));
    txHash = txHash || state.lastTransferTxHash;
    customerId = customerId || state.customers?.alice;
    console.log(`MRWA token: ${state.addresses?.securityToken ?? "n/a"}`);
  }

  if (!walletAddress) {
    // Alice sent the transfer in the reference workflow.
    walletAddress = "0xD37b28E02f3f7d5D4f23F2b6671AA36aC0F66871";
  }

  if (!txHash) {
    throw new Error("No TX_HASH and no lastTransferTxHash in deployments.monad.json");
  }

  console.log("download_travel_rule request:");
  console.log(JSON.stringify({ chain, txHash, walletAddress, customerId, cvRecordId }, null, 2));

  const client = new CleanverseClient({ baseUrl, apiId, apiKey });
  const res = await client.downloadTravelRule({
    txHash,
    wallet: { chain, address: walletAddress },
    customerId,
    cvRecordId,
  });

  console.log("\nResponse:");
  console.log(JSON.stringify(res, null, 2));

  if (res.code === "0000" && res.data?.downloadUrl) {
    console.log("\nDownload URL (time-limited):");
    console.log(res.data.downloadUrl);
    console.log("File:", res.data.fileName);
  } else {
    console.error(`\nReport not available: code=${res.code} message=${res.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
