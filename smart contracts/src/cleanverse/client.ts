import { encryptBody } from "./crypto";
import {
  CleanverseEnvelope,
  GenerateApassRequest,
  GenerateApassData,
  QueryApassData,
  VerifyApassData,
  UpdateStatusRequest,
  ValidatorRule,
  ValidatorVerifyData,
  Chain,
  WalletRef,
} from "./types";

export interface CleanverseConfig {
  baseUrl: string; // e.g. https://uatapi.cleanverse.com/api/cooperate
  apiId: string;
  apiKey: string; // Base64 AES key (used locally only)
}

function randomRequestId(): string {
  // Lightweight UUID v4 for the optional X-Request-ID header.
  const b = require("crypto").randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20
  )}-${h.slice(20)}`;
}

/**
 * Thin client over the Cleanverse Cooperate API. Handles the `api-id` header,
 * AES encryption for the encrypted endpoints, and the standard `{code,message,
 * data}` envelope. Only the endpoints this project uses are wrapped.
 */
export class CleanverseClient {
  constructor(private readonly cfg: CleanverseConfig) {}

  private async post<T>(
    path: string,
    body: unknown,
    encrypted: boolean
  ): Promise<CleanverseEnvelope<T>> {
    const payload = encrypted ? encryptBody(body, this.cfg.apiKey) : body;
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-id": this.cfg.apiId,
        "X-Request-ID": randomRequestId(),
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as CleanverseEnvelope<T>;
    return json;
  }

  private async get<T>(path: string): Promise<CleanverseEnvelope<T>> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "api-id": this.cfg.apiId,
        "X-Request-ID": randomRequestId(),
      },
    });
    return (await res.json()) as CleanverseEnvelope<T>;
  }

  // --- A-Pass management (encrypted) ---

  generateApass(req: GenerateApassRequest) {
    return this.post<GenerateApassData>("/generate_apass", req, true);
  }

  updateStatus(req: UpdateStatusRequest) {
    return this.post<{ txHash: string }>("/update_status", req, true);
  }

  // --- Common queries (plain JSON) ---

  queryApass(wallet: WalletRef) {
    return this.post<QueryApassData>("/query_apass", wallet, false);
  }

  verifyApass(chain: Chain, atoken: string, address: string) {
    return this.post<VerifyApassData>(
      "/verify_apass",
      { chain, atoken, address },
      false
    );
  }

  queryDepositAddress(wallet: WalletRef) {
    return this.post<Record<string, unknown>>(
      "/query_deposit_address",
      wallet,
      false
    );
  }

  faucet(chain: Chain, symbol: string, depositAddress: string, amount: string) {
    return this.post<Record<string, unknown>>(
      "/faucet",
      { chain, symbol, depositAddress, amount },
      false
    );
  }

  downloadTravelRule(req: {
    txHash: string;
    wallet: WalletRef;
    customerId?: string;
    cvRecordId?: string;
  }) {
    return this.post<{ downloadUrl: string; fileName: string }>(
      "/download_travel_rule",
      req,
      false
    );
  }

  queryTxs(req: {
    chain: Chain;
    address: string;
    symbol?: string;
    txHash?: string;
    page?: number;
    pageSize?: number;
  }) {
    return this.post<{ total_count: number; txs: unknown[] }>(
      "/query_txs",
      req,
      false
    );
  }

  addWhitelistForInstitutional(req: {
    entityName: string;
    serviceName: string;
    category: string;
    license: string;
    logoUrl: string;
    addressList: Array<{
      chain: Chain;
      symbol: string;
      assetAddress: string;
      walletAddresses: string[];
    }>;
  }) {
    return this.post("/atoken/add_whitelist_for_institutional", req, true);
  }

  // --- Validator compliance ---

  validatorGrant(chain: Chain, address: string, ownerSignature: string) {
    return this.post<{ chain: Chain; address: string; tx_hash: string }>(
      "/validator/grant",
      { chain, address, owner_signature: ownerSignature },
      true
    );
  }

  validatorRegister(
    chain: Chain,
    contractAddress: string,
    rule: ValidatorRule,
    ownerSignature: string
  ) {
    return this.post<{ chain: Chain; contract_address: string; tx_hash: string }>(
      "/validator/register",
      {
        chain,
        contract_address: contractAddress,
        rule,
        owner_signature: ownerSignature,
      },
      true
    );
  }

  validatorAddRule(chain: Chain, contractAddress: string, rule: ValidatorRule) {
    return this.post("/validator/add_rule", {
      chain,
      contract_address: contractAddress,
      rule,
    }, true);
  }

  validatorSetPaused(chain: Chain, contractAddress: string, paused: boolean) {
    return this.post("/validator/set_paused", {
      chain,
      contract_address: contractAddress,
      paused,
    }, true);
  }

  validatorIsRegister(chain: Chain, contractAddress: string) {
    return this.post<{ registered: boolean }>(
      "/validator/is_register",
      { chain, contract_address: contractAddress },
      false
    );
  }

  validatorVerify(chain: Chain, contractAddress: string, userAddress: string) {
    return this.post<ValidatorVerifyData>(
      "/validator/verify",
      { chain, contract_address: contractAddress, user_address: userAddress },
      false
    );
  }

  // --- A-Token (encrypted launch; query is GET) ---

  atokenLaunch(req: {
    chain: Chain;
    token_name: string;
    token_symbol: string;
    decimals: number;
    admin_address: string;
    rule: ValidatorRule;
    icon: string;
  }) {
    return this.post<{ requestId: string; issueAssetId: number }>(
      "/atoken/launch",
      req,
      true
    );
  }

  atokenSetPaused(chain: Chain, atokenAddress: string, paused: boolean) {
    return this.post("/atoken/set_paused", {
      chain,
      atoken_address: atokenAddress,
      paused,
    }, true);
  }

  queryApplyStatus(requestId: string) {
    return this.get<Record<string, unknown>>(
      `/atoken/query_apply_status/${requestId}`
    );
  }
}
