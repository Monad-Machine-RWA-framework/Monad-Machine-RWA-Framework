import { ethers } from "ethers";
import { ApassProjection, CleanverseService, OnboardParams } from "./mode";

/**
 * The ComplianceOracle bridges Cleanverse A-Pass data onto Monad. Holding
 * REGISTRAR_ROLE on the IdentityRegistry, it onboards users via the Cleanverse
 * gateway (or mock) and writes the resulting A-Pass projection on-chain so the
 * SecurityToken / ComplianceModule can enforce transfers without a round-trip.
 */
export class ComplianceOracle {
  constructor(
    private readonly service: CleanverseService,
    /** ethers Contract instance for IdentityRegistry, connected to the oracle signer. */
    private readonly registry: ethers.Contract
  ) {}

  /** Encode a (max 2-char) group string into a bytes2 value for on-chain storage. */
  static encodeGroup(group: string): string {
    const bytes = ethers.toUtf8Bytes(group ?? "");
    if (bytes.length > 2) throw new Error(`group too long: ${group}`);
    const padded = new Uint8Array(2);
    padded.set(bytes);
    return ethers.hexlify(padded);
  }

  /** Onboard a participant: create the A-Pass, then sync it on-chain. */
  async onboard(params: OnboardParams): Promise<ApassProjection> {
    const proj = await this.service.generateApass(params);
    await this.sync(params.address, proj);
    return proj;
  }

  /** Write (or refresh) an A-Pass projection into the on-chain registry. */
  async sync(address: string, proj: ApassProjection): Promise<void> {
    const tx = await this.registry.registerIdentity(
      address,
      proj.cvRecordId,
      proj.tier,
      proj.subTier,
      ComplianceOracle.encodeGroup(proj.group),
      ComplianceOracle.encodeGroup(proj.subGroup),
      proj.expirationTime,
      proj.kycHash
    );
    await tx.wait();
  }

  /** Re-query Cleanverse for a wallet and push the latest attributes on-chain. */
  async refresh(chain: any, address: string): Promise<ApassProjection> {
    const proj = await this.service.queryApass(chain, address);
    await this.sync(address, proj);
    return proj;
  }

  /** Freeze / unfreeze a wallet (mirrors update_status). */
  async setFrozen(address: string, frozen: boolean, reason: string) {
    const tx = await this.registry.setFrozen(address, frozen, reason);
    await tx.wait();
  }
}
