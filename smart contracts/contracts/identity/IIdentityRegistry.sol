// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IIdentityRegistry
/// @notice On-chain mirror of a Cleanverse A-Pass record. Each wallet maps to an
///         identity that carries the compliance-relevant A-Pass attributes
///         (tier / subTier / group / subGroup / KYC hash / expiration / frozen).
///         The registry is the source the ComplianceModule reads when gating a
///         transfer, mirroring how the Cleanverse Validator pool evaluates
///         `verify` against A-Pass attributes.
interface IIdentityRegistry {
    /// @dev Mirrors the flat fields returned by Cleanverse `query_apass`.
    struct Identity {
        bool exists; // an A-Pass record has been synced for this wallet
        bool frozen; // mirrors A-Pass status 2 (Freeze) via update_status
        uint16 tier; // A-Pass tier
        uint16 subTier; // A-Pass subTier
        bytes2 group; // A-Pass group (2-char, case-sensitive); 0x0000 = none
        bytes2 subGroup; // A-Pass subGroup; 0x0000 = none
        uint64 expirationTime; // Unix seconds; 0 = no expiry
        bytes32 kycHash; // currentKycHash
        string cvRecordId; // Cleanverse record id (audit linkage)
    }

    event IdentityRegistered(address indexed wallet, string cvRecordId, uint16 tier);
    event IdentityUpdated(address indexed wallet, uint16 tier, bool frozen);
    event IdentityFrozen(address indexed wallet, bool frozen, string reason);

    function isVerified(address wallet) external view returns (bool);

    function getIdentity(address wallet) external view returns (Identity memory);
}
