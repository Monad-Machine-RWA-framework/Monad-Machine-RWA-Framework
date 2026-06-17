import { existingCtx } from "./context";
import { stage03VaultToken } from "./stages";

async function main() {
  const ctx = await existingCtx();
  await stage03VaultToken(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
