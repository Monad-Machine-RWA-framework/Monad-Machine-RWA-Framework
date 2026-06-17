// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @title IdentityRegistry
/// @notice On-chain projection of Cleanverse A-Pass records. The off-chain
///         ComplianceOracle (holding REGISTRAR_ROLE) calls `generate_apass` /
///         `query_apass` against the Cleanverse gateway and syncs the resulting
///         attributes here. The SecurityToken / ComplianceModule then enforce
///         transfer rules using this data without a network round-trip.
///
///         This is the Cleanverse-native equivalent of an ERC-3643
///         IdentityRegistry: instead of resolving ONCHAINID claims, it stores
///         the verified A-Pass attributes that drive compliance.
contract IdentityRegistry is AccessControl, IIdentityRegistry {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    mapping(address => Identity) private _identities;
    address[] private _wallets;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    /// @notice Register or overwrite the A-Pass projection for `wallet`.
    /// @dev Called by the oracle after a successful Cleanverse generate/query.
    function registerIdentity(
        address wallet,
        string calldata cvRecordId,
        uint16 tier,
        uint16 subTier,
        bytes2 group,
        bytes2 subGroup,
        uint64 expirationTime,
        bytes32 kycHash
    ) external onlyRole(REGISTRAR_ROLE) {
        require(wallet != address(0), "IdentityRegistry: zero wallet");
        Identity storage id = _identities[wallet];
        if (!id.exists) {
            _wallets.push(wallet);
            emit IdentityRegistered(wallet, cvRecordId, tier);
        } else {
            emit IdentityUpdated(wallet, tier, id.frozen);
        }
        id.exists = true;
        id.tier = tier;
        id.subTier = subTier;
        id.group = group;
        id.subGroup = subGroup;
        id.expirationTime = expirationTime;
        id.kycHash = kycHash;
        id.cvRecordId = cvRecordId;
    }

    /// @notice Freeze / unfreeze a wallet. Mirrors Cleanverse `update_status`
    ///         (status 2 = Freeze, status 1 = Activate).
    function setFrozen(
        address wallet,
        bool frozen,
        string calldata reason
    ) external onlyRole(REGISTRAR_ROLE) {
        require(_identities[wallet].exists, "IdentityRegistry: unknown wallet");
        _identities[wallet].frozen = frozen;
        emit IdentityFrozen(wallet, frozen, reason);
    }

    /// @inheritdoc IIdentityRegistry
    function isVerified(address wallet) public view returns (bool) {
        Identity storage id = _identities[wallet];
        if (!id.exists || id.frozen) return false;
        if (id.expirationTime != 0 && id.expirationTime <= block.timestamp) {
            return false;
        }
        return true;
    }

    /// @inheritdoc IIdentityRegistry
    function getIdentity(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }

    function walletCount() external view returns (uint256) {
        return _wallets.length;
    }

    function walletAt(uint256 index) external view returns (address) {
        return _wallets[index];
    }
}
