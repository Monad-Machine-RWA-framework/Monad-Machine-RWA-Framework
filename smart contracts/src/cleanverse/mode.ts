import * as crypto from "crypto";
import { CleanverseClient } from "./client";
import { Chain } from "./types";

/**
 * A normalised A-Pass projection used to populate the on-chain IdentityRegistry,
 * regardless of whether it came from the live gateway or the mock.
 */
export interface ApassProjection {
  cvRecordId: string;
  tier: number;
  subTier: number;
  group: string; // up to 2 chars, "" = none
  subGroup: string; // up to 2 chars, "" = none
  expirationTime: number; // unix seconds, 0 = none
  kycHash: string; // 0x-prefixed 32-byte hex
}

export interface OnboardParams {
  customerId: string;
  chain: Chain;
  address: string;
  tier: number;
  subTier?: number;
  group?: string;
  subGroup?: string;
  expirationTime?: number;
  fullName?: string;
}

/**
 * Abstraction the ComplianceOracle and scripts depend on. Two implementations:
 *  - MockCleanverseService: deterministic, offline, no credentials.
 *  - LiveCleanverseService: calls the real Cleanverse gateway.
 */
export interface CleanverseService {
  readonly mode: "mock" | "live";
  generateApass(params: OnboardParams): Promise<ApassProjection>;
  queryApass(chain: Chain, address: string): Promise<ApassProjection>;
  verify(
    chain: Chain,
    contractOrAtoken: string,
    userAddress: string
  ): Promise<boolean>;
}

const DEFAULT_EXPIRY = 1863690034; // 2029-01-21 per the docs' example.

function kycHashFor(seed: string): string {
  return "0x" + crypto.createHash("sha256").update(seed).digest("hex");
}

/** Offline implementation: derives a stable A-Pass from the inputs. */
export class MockCleanverseService implements CleanverseService {
  readonly mode = "mock" as const;
  private store = new Map<string, ApassProjection>();

  async generateApass(p: OnboardParams): Promise<ApassProjection> {
    const proj: ApassProjection = {
      cvRecordId: "MOCK-" + p.customerId.slice(0, 8),
      tier: p.tier,
      subTier: p.subTier ?? 0,
      group: p.group ?? "",
      subGroup: p.subGroup ?? "",
      expirationTime: p.expirationTime ?? DEFAULT_EXPIRY,
      kycHash: kycHashFor(p.customerId + ":" + p.address),
    };
    this.store.set(p.address.toLowerCase(), proj);
    return proj;
  }

  async queryApass(_chain: Chain, address: string): Promise<ApassProjection> {
    const p = this.store.get(address.toLowerCase());
    if (!p) throw new Error(`Mock A-Pass not found for ${address}`);
    return p;
  }

  async verify(
    _chain: Chain,
    _contract: string,
    userAddress: string
  ): Promise<boolean> {
    return this.store.has(userAddress.toLowerCase());
  }
}

/** Live implementation backed by the Cleanverse Cooperate API. */
export class LiveCleanverseService implements CleanverseService {
  readonly mode = "live" as const;
  constructor(private readonly client: CleanverseClient) {}

  async generateApass(p: OnboardParams): Promise<ApassProjection> {
    const res = await this.client.generateApass({
      customerId: p.customerId,
      subTier: p.subTier,
      subGroup: p.subGroup,
      expirationTime: p.expirationTime ?? DEFAULT_EXPIRY,
      wallet: { chain: p.chain, address: p.address },
      identityDataList: p.fullName
        ? [
            {
              idType: "PASSPORT",
              fullName: p.fullName,
              issuingCountryISO2: "US",
            },
          ]
        : undefined,
    });
    if (res.code !== "0000") {
      throw new Error(`generate_apass failed: ${res.code} ${res.message}`);
    }
    // Re-query to obtain the full flat attribute set.
    return this.queryApass(p.chain, p.address);
  }

  async queryApass(chain: Chain, address: string): Promise<ApassProjection> {
    const res = await this.client.queryApass({ chain, address });
    if (res.code !== "0000") {
      throw new Error(`query_apass failed: ${res.code} ${res.message}`);
    }
    const d = res.data;
    return {
      cvRecordId: d.cvRecordId,
      tier: Number(d.tier),
      subTier: d.subTier ?? 0,
      group: d.group ?? "",
      subGroup: d.subGroup ?? "",
      expirationTime: d.expirationTime ?? 0,
      kycHash: d.currentKycHash?.startsWith("0x")
        ? d.currentKycHash
        : "0x" + (d.currentKycHash ?? "").padStart(64, "0"),
    };
  }

  async verify(
    chain: Chain,
    contract: string,
    userAddress: string
  ): Promise<boolean> {
    const res = await this.client.validatorVerify(chain, contract, userAddress);
    if (res.code !== "0000") return false;
    return res.data.valid === true;
  }
}

/** Build the service from environment configuration. */
export function getCleanverseService(): CleanverseService {
  const mode = (process.env.CLEANVERSE_MODE || "mock").toLowerCase();
  if (mode === "live") {
    const baseUrl =
      process.env.CLEANVERSE_BASE_URL ||
      "https://uatapi.cleanverse.com/api/cooperate";
    const apiId = process.env.CLEANVERSE_API_ID;
    const apiKey = process.env.CLEANVERSE_API_KEY;
    if (!apiId || !apiKey) {
      throw new Error(
        "CLEANVERSE_MODE=live requires CLEANVERSE_API_ID and CLEANVERSE_API_KEY"
      );
    }
    return new LiveCleanverseService(
      new CleanverseClient({ baseUrl, apiId, apiKey })
    );
  }
  return new MockCleanverseService();
}

export function getChain(): Chain {
  return (process.env.CLEANVERSE_CHAIN as Chain) || "monad";
}
