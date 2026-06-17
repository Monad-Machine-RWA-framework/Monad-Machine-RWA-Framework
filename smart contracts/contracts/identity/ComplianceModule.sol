// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @title ComplianceModule
/// @notice On-chain mirror of a Cleanverse Validator compliance pool. Holds a
///         set of Rule objects identical in shape to the Cleanverse Rule
///         (`allowed_group`, `allowed_sub_group`, `min_tier`, `min_sub_tier`)
///         and evaluates them against IdentityRegistry data, reproducing the
///         semantics of `POST /validator/verify`.
///
///         A wallet satisfies the pool if it satisfies AT LEAST ONE configured
///         rule (rules are additive, matching how Cleanverse pools accumulate
///         rules via add_rule). With zero rules configured, only verified
///         (A-Pass present, not frozen, not expired) wallets pass.
contract ComplianceModule is AccessControl {
    bytes32 public constant RULE_MANAGER_ROLE = keccak256("RULE_MANAGER_ROLE");

    /// @dev Field names mirror the Cleanverse Rule object exactly.
    struct Rule {
        bytes2 allowedGroup; // 0x0000 = no group restriction
        bytes2 allowedSubGroup; // 0x0000 = no subGroup restriction
        uint16 minTier; // user allowed if tier > minTier
        uint16 minSubTier; // user allowed if subTier > minSubTier
    }

    IIdentityRegistry public immutable registry;
    bool public paused; // mirrors Validator pool pause state
    Rule[] private _rules;

    event RuleAdded(uint256 index, bytes2 allowedGroup, uint16 minTier);
    event RuleRemoved(uint256 index);
    event RulesReplaced(uint256 count);
    event PausedSet(bool paused);

    constructor(address admin, IIdentityRegistry registry_) {
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RULE_MANAGER_ROLE, admin);
    }

    // --------------------------------------------------------------------
    // Rule management (mirrors /validator/add_rule, remove_rule, set_rule)
    // --------------------------------------------------------------------

    function addRule(Rule calldata rule) external onlyRole(RULE_MANAGER_ROLE) {
        _rules.push(rule);
        emit RuleAdded(_rules.length - 1, rule.allowedGroup, rule.minTier);
    }

    function removeRule(uint256 index) external onlyRole(RULE_MANAGER_ROLE) {
        require(index < _rules.length, "ComplianceModule: bad index");
        // Order is preserved to keep indices aligned with off-chain views.
        for (uint256 i = index; i + 1 < _rules.length; i++) {
            _rules[i] = _rules[i + 1];
        }
        _rules.pop();
        emit RuleRemoved(index);
    }

    /// @notice Replace all rules with a single rule (mirrors set_rule).
    function setRule(Rule calldata rule) external onlyRole(RULE_MANAGER_ROLE) {
        delete _rules;
        _rules.push(rule);
        emit RulesReplaced(1);
    }

    function setPaused(bool paused_) external onlyRole(RULE_MANAGER_ROLE) {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function ruleCount() external view returns (uint256) {
        return _rules.length;
    }

    function ruleAt(uint256 index) external view returns (Rule memory) {
        return _rules[index];
    }

    // --------------------------------------------------------------------
    // Verification (mirrors /validator/verify and verify_apass)
    // --------------------------------------------------------------------

    /// @notice Returns true if `wallet` satisfies the pool. Reverts if paused,
    ///         matching the Cleanverse note that verify on a paused pool fails
    ///         (response code 12027).
    function verify(address wallet) public view returns (bool) {
        require(!paused, "ComplianceModule: pool paused");
        if (!registry.isVerified(wallet)) return false;

        if (_rules.length == 0) return true;

        IIdentityRegistry.Identity memory id = registry.getIdentity(wallet);
        for (uint256 i = 0; i < _rules.length; i++) {
            if (_satisfies(_rules[i], id)) return true;
        }
        return false;
    }

    /// @notice Convenience used by the token transfer hook.
    function isAllowed(address from, address to) external view returns (bool) {
        // Mints (from == 0) only require the receiver to be compliant; burns
        // (to == 0) only require the sender to be compliant.
        if (from != address(0) && !verify(from)) return false;
        if (to != address(0) && !verify(to)) return false;
        return true;
    }

    function _satisfies(
        Rule storage rule,
        IIdentityRegistry.Identity memory id
    ) private view returns (bool) {
        if (rule.allowedGroup != bytes2(0) && rule.allowedGroup != id.group) {
            return false;
        }
        if (
            rule.allowedSubGroup != bytes2(0) &&
            rule.allowedSubGroup != id.subGroup
        ) {
            return false;
        }
        // Cleanverse semantics: allowed if tier strictly greater than minTier.
        if (id.tier <= rule.minTier) return false;
        if (rule.minSubTier != 0 && id.subTier <= rule.minSubTier) return false;
        return true;
    }
}
