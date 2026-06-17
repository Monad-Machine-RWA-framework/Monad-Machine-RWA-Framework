import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id } from "ethers";

const MINTER_ROLE = id("MINTER_ROLE");

/**
 * Deploys the full Cleanverse-native Machine RWA stack and wires roles:
 *  - MockUSDC               : yield / origin token
 *  - IdentityRegistry       : on-chain A-Pass projection (deployer = registrar)
 *  - ComplianceModule       : Validator pool mirror, reads the registry
 *  - SecurityToken          : ERC-3643-style A-Token analog (starts paused)
 *  - MachineNFT / ContractNFT : tokenised collateral
 *  - RWAVault               : collateralise + mint + yield (granted MINTER_ROLE)
 *  - MockCleanverseValidator: local stand-in for the on-chain Validator
 *
 * The deployer holds admin/registrar/controller roles initially; the workflow
 * scripts reassign the vault controller to Alice in stage 3.
 */
export default buildModule("RWAPlatform", (m) => {
  const admin = m.getAccount(0);

  const mockUSDC = m.contract("MockUSDC", []);
  const identityRegistry = m.contract("IdentityRegistry", [admin]);
  const compliance = m.contract("ComplianceModule", [admin, identityRegistry]);

  const securityToken = m.contract("SecurityToken", [
    "Machine RWA Security Token",
    "MRWA",
    6,
    admin,
    compliance,
  ]);

  const machineNFT = m.contract("MachineNFT", [admin]);
  const contractNFT = m.contract("ContractNFT", []);

  const vault = m.contract("RWAVault", [
    admin,
    admin, // initial controller; reassigned to Alice in stage 3
    securityToken,
    machineNFT,
    contractNFT,
    mockUSDC,
    identityRegistry,
  ]);

  const validator = m.contract("MockCleanverseValidator", []);

  // The vault must be able to mint SecurityTokens against collateral.
  m.call(securityToken, "grantRole", [MINTER_ROLE, vault]);

  return {
    mockUSDC,
    identityRegistry,
    compliance,
    securityToken,
    machineNFT,
    contractNFT,
    vault,
    validator,
  };
});
