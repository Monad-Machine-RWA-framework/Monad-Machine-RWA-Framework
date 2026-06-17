/**
 * Type definitions mirroring the Cleanverse Cooperate API (v5.2) request/response
 * shapes used by this project. Only the fields the workflow needs are typed.
 */

export type Chain =
  | "solana"
  | "base"
  | "avalanche"
  | "arbitrum"
  | "ethereum"
  | "polygon"
  | "bsc"
  | "monad"
  | "hashkey"
  | "platon";

export interface CleanverseEnvelope<T = unknown> {
  code: string; // "0000" on success
  message: string;
  data: T;
}

export interface WalletRef {
  chain: Chain;
  address: string;
}

export interface IdentityData {
  idType:
    | "ID_CARD"
    | "PASSPORT"
    | "DRIVER_LICENSE"
    | "HK_MACAO_TAIWAN_PASS"
    | "RESIDENCE_PERMIT";
  fullName: string;
  idNumber?: string;
  validUntil?: string;
  issuingCountryISO2: string;
}

export interface BankAccount {
  bankCountry: string;
  bankName: string;
  bankAccount?: string;
  bankAccountType?: "C" | "D" | "A";
  balance?: number;
  currency?: string;
}

export interface GenerateApassRequest {
  customerId: string; // >=12 chars, [A-Za-z0-9]
  kycSource?: string;
  kycId?: string;
  subTier?: number;
  subGroup?: string;
  override?: boolean;
  expirationTime: number; // unix seconds
  wallet: WalletRef;
  identityDataList?: IdentityData[];
  bankAccountList?: BankAccount[];
}

export interface GenerateApassData {
  customerId: string;
  cvRecordId: string;
  tier: string;
  wallet: {
    operate: string;
    address: string;
    chain: Chain;
    txHash: string;
    depositUSDCWallet?: string;
    depositUSDTWallet?: string;
    apassAddress?: string;
  };
}

export interface QueryApassData {
  cvRecordId: string;
  subTier: number;
  status: number; // 1 = active, 2 = frozen
  tier: string;
  expirationTime: number; // unix seconds
  subGroup: string;
  currentKycHash: string;
  group: string;
}

export interface VerifyApassData {
  chain: Chain;
  atoken: string;
  address: string;
  code: number; // 1 not found, 2 no apass, 3 cannot transfer, 4 success
  message: string;
  magickLink?: string;
}

export interface ValidatorRule {
  allowed_group: string;
  allowed_sub_group: string;
  min_tier: number;
  min_sub_tier: number;
}

export interface ValidatorVerifyData {
  chain: Chain;
  contract_address: string;
  user_address: string;
  valid: boolean;
}

export interface UpdateStatusRequest {
  customerId?: string;
  cvRecordId?: string;
  status: "1" | "2"; // 1 activate, 2 freeze
  blacklistReason?: string;
  wallet: WalletRef;
}
