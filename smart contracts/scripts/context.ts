import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { id, Signer } from "ethers";
import { getCleanverseService, getChain, CleanverseService } from "../src/cleanverse/mode";
import { ComplianceOracle } from "../src/cleanverse/complianceOracle";

const STATE_FILE = path.join(__dirname, "..", "deployments.local.json");
const MONAD_STATE_FILE = path.join(__dirname, "..", "deployments.monad.json");

export interface DeployedAddresses {
  mockUSDC: string;
  identityRegistry: string;
  compliance: string;
  securityToken: string;
  machineNFT: string;
  contractNFT: string;
  vault: string;
}

export interface FlowState {
  addresses: DeployedAddresses;
  customers: Record<string, string>; // role -> customerId
  machineIds: string[];
  contractProposalId?: string;
  contractTokenId?: string;
  lastTransferTxHash?: string;
}

export interface Participants {
  deployer: Signer; // admin + oracle + machine issuer
  alice: Signer; // asset owner + vault controller
  bob: Signer;
  charlie: Signer;
  dave: Signer; // intentionally NOT onboarded (compliance negative case)
}

export interface Ctx {
  chain: ReturnType<typeof getChain>;
  service: CleanverseService;
  participants: Participants;
  addresses: DeployedAddresses;
  state: FlowState;
  // contract handles (connected to deployer unless reconnected)
  mockUSDC: any;
  identityRegistry: any;
  compliance: any;
  securityToken: any;
  machineNFT: any;
  contractNFT: any;
  vault: any;
  oracle: ComplianceOracle;
}

const MACHINE_ISSUER_ROLE = id("MACHINE_ISSUER_ROLE");
const REGISTRAR_ROLE = id("REGISTRAR_ROLE");
const MINTER_ROLE = id("MINTER_ROLE");

export async function getParticipants(): Promise<Participants> {
  const signers = await ethers.getSigners();
  if (signers.length >= 5) {
    return {
      deployer: signers[0],
      alice: signers[1],
      bob: signers[2],
      charlie: signers[3],
      dave: signers[4],
    };
  }
  return getMonadParticipants();
}

/**
 * On Monad testnet only the deployer key is configured in Hardhat. Derive
 * deterministic participant wallets from PRIVATE_KEY (or use optional env keys)
 * and fund them with MON for gas.
 */
export async function getMonadParticipants(): Promise<Participants> {
  const deployer = (await ethers.getSigners())[0];
  const provider = deployer.provider!;
  const deployerAddr = await deployer.getAddress();

  const connect = (role: "alice" | "bob" | "charlie" | "dave") => {
    const envKey = process.env[`${role.toUpperCase()}_PRIVATE_KEY`];
    if (envKey) {
      return new ethers.Wallet(envKey, provider);
    }
    const idx = { alice: 1, bob: 2, charlie: 3, dave: 4 }[role];
    const derived = ethers.keccak256(
      ethers.toUtf8Bytes(`monad-rwa-${role}-${process.env.PRIVATE_KEY}`)
    );
    return new ethers.Wallet(derived, provider);
  };

  const alice = connect("alice");
  const bob = connect("bob");
  const charlie = connect("charlie");
  const dave = connect("dave");

  const fundAmount = ethers.parseEther("0.5");
  for (const w of [alice, bob, charlie, dave]) {
    const addr = await w.getAddress();
    const bal = await provider.getBalance(addr);
    if (bal < fundAmount / 2n) {
      const tx = await deployer.sendTransaction({ to: addr, value: fundAmount });
      await tx.wait();
      console.log(`  Funded ${addr} with 0.5 MON (from ${deployerAddr})`);
    }
  }

  return { deployer, alice, bob, charlie, dave };
}

/** Deploy the entire stack with ethers and wire roles. Used by run-all / tests. */
export async function deployAll(): Promise<DeployedAddresses> {
  const [deployer] = await ethers.getSigners();
  const adminAddr = await deployer.getAddress();

  const mockUSDC = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await mockUSDC.waitForDeployment();

  const identityRegistry = await (
    await ethers.getContractFactory("IdentityRegistry")
  ).deploy(adminAddr);
  await identityRegistry.waitForDeployment();

  const compliance = await (
    await ethers.getContractFactory("ComplianceModule")
  ).deploy(adminAddr, await identityRegistry.getAddress());
  await compliance.waitForDeployment();

  const securityToken = await (
    await ethers.getContractFactory("SecurityToken")
  ).deploy(
    "Machine RWA Security Token",
    "MRWA",
    6,
    adminAddr,
    await compliance.getAddress()
  );
  await securityToken.waitForDeployment();

  const machineNFT = await (
    await ethers.getContractFactory("MachineNFT")
  ).deploy(adminAddr);
  await machineNFT.waitForDeployment();

  const contractNFT = await (
    await ethers.getContractFactory("ContractNFT")
  ).deploy();
  await contractNFT.waitForDeployment();

  const vault = await (
    await ethers.getContractFactory("RWAVault")
  ).deploy(
    adminAddr,
    adminAddr,
    await securityToken.getAddress(),
    await machineNFT.getAddress(),
    await contractNFT.getAddress(),
    await mockUSDC.getAddress(),
    await identityRegistry.getAddress()
  );
  await vault.waitForDeployment();

  await (
    await securityToken.grantRole(MINTER_ROLE, await vault.getAddress())
  ).wait();

  return {
    mockUSDC: await mockUSDC.getAddress(),
    identityRegistry: await identityRegistry.getAddress(),
    compliance: await compliance.getAddress(),
    securityToken: await securityToken.getAddress(),
    machineNFT: await machineNFT.getAddress(),
    contractNFT: await contractNFT.getAddress(),
    vault: await vault.getAddress(),
  };
}

export function saveState(state: FlowState, file = STATE_FILE): void {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

export function saveMonadState(state: FlowState): void {
  saveState(state, MONAD_STATE_FILE);
}

export function loadState(): FlowState {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      `No flow state at ${STATE_FILE}. Run the earlier stage(s) first (e.g. npm run flow:all).`
    );
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FlowState;
}

/** Build a Ctx from already-deployed addresses + persisted state. */
export async function buildCtx(
  state: FlowState,
  participants?: Participants
): Promise<Ctx> {
  const p = participants ?? (await getParticipants());
  const a = state.addresses;
  const ctx: Ctx = {
    chain: getChain(),
    service: getCleanverseService(),
    participants: p,
    addresses: a,
    state,
    mockUSDC: await ethers.getContractAt("MockUSDC", a.mockUSDC),
    identityRegistry: await ethers.getContractAt("IdentityRegistry", a.identityRegistry),
    compliance: await ethers.getContractAt("ComplianceModule", a.compliance),
    securityToken: await ethers.getContractAt("SecurityToken", a.securityToken),
    machineNFT: await ethers.getContractAt("MachineNFT", a.machineNFT),
    contractNFT: await ethers.getContractAt("ContractNFT", a.contractNFT),
    vault: await ethers.getContractAt("RWAVault", a.vault),
    oracle: undefined as any,
  };
  ctx.oracle = new ComplianceOracle(
    ctx.service,
    ctx.identityRegistry.connect(p.deployer) as any
  );
  return ctx;
}

/** Fresh deployment + empty state, for run-all / tests. */
export async function freshCtx(saveFile = STATE_FILE): Promise<Ctx> {
  const participants = await getParticipants();
  const addresses = await deployAll();
  const state: FlowState = {
    addresses,
    customers: {},
    machineIds: [],
  };
  saveState(state, saveFile);
  return buildCtx(state, participants);
}

/** Deploy on Monad testnet, fund participants, persist to deployments.monad.json. */
export async function freshMonadCtx(): Promise<Ctx> {
  console.log("Preparing Monad testnet participants...");
  const participants = await getMonadParticipants();
  console.log("Deploying contracts to Monad testnet...");
  const addresses = await deployAll();
  const state: FlowState = {
    addresses,
    customers: {},
    machineIds: [],
  };
  saveMonadState(state);
  return buildCtx(state, participants);
}

/** Load existing deployment + state (for individual stage scripts). */
export async function existingCtx(): Promise<Ctx> {
  return buildCtx(loadState());
}

export function fmt(amount: bigint, decimals = 6): string {
  return ethers.formatUnits(amount, decimals);
}

export const ROLES = { MACHINE_ISSUER_ROLE, REGISTRAR_ROLE, MINTER_ROLE };
