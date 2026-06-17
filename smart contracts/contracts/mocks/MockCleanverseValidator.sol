// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MockCleanverseValidator
/// @notice Local stand-in for the on-chain Cleanverse APass Compliance
///         Validator contract. It lets integration tests / scripts exercise the
///         same `register` / `setPaused` / `verify` surface the real Validator
///         pool exposes (mirrored from the `/validator/*` gateway endpoints)
///         without live credentials or a Monad connection.
///
///         The production system would instead point at the real Validator
///         deployed on Monad; this contract is intentionally simple and is NOT
///         used by the SecurityToken transfer path (that uses ComplianceModule).
contract MockCleanverseValidator {
    struct PoolRule {
        bytes2 allowedGroup;
        bytes2 allowedSubGroup;
        uint16 minTier;
        uint16 minSubTier;
    }

    mapping(address => bool) public registered; // pool => registered
    mapping(address => bool) public poolPaused; // pool => paused
    mapping(address => PoolRule[]) private _poolRules; // pool => rules
    // pool => user => synced A-Pass attributes
    mapping(address => mapping(address => uint16)) public userTier;
    mapping(address => mapping(address => bytes2)) public userGroup;
    mapping(address => mapping(address => bool)) public userHasApass;

    event PoolRegistered(address indexed pool);
    event PoolPaused(address indexed pool, bool paused);
    event RuleAdded(address indexed pool, uint16 minTier);

    function register(address pool, PoolRule calldata rule) external {
        registered[pool] = true;
        _poolRules[pool].push(rule);
        emit PoolRegistered(pool);
        emit RuleAdded(pool, rule.minTier);
    }

    function addRule(address pool, PoolRule calldata rule) external {
        require(registered[pool], "validator: not registered");
        _poolRules[pool].push(rule);
        emit RuleAdded(pool, rule.minTier);
    }

    function setPaused(address pool, bool paused_) external {
        poolPaused[pool] = paused_;
        emit PoolPaused(pool, paused_);
    }

    function syncUser(
        address pool,
        address user,
        uint16 tier,
        bytes2 group
    ) external {
        userHasApass[pool][user] = true;
        userTier[pool][user] = tier;
        userGroup[pool][user] = group;
    }

    function isRegister(address pool) external view returns (bool) {
        return registered[pool];
    }

    function isPaused(address pool) external view returns (bool) {
        return poolPaused[pool];
    }

    function ruleCount(address pool) external view returns (uint256) {
        return _poolRules[pool].length;
    }

    /// @notice Mirrors /validator/verify. Reverts when paused (code 12027).
    function verify(address pool, address user) external view returns (bool) {
        require(!poolPaused[pool], "validator: pool paused");
        if (!userHasApass[pool][user]) return false;
        PoolRule[] storage rules = _poolRules[pool];
        if (rules.length == 0) return true;
        for (uint256 i = 0; i < rules.length; i++) {
            PoolRule storage r = rules[i];
            bool groupOk = r.allowedGroup == bytes2(0) ||
                r.allowedGroup == userGroup[pool][user];
            bool tierOk = userTier[pool][user] > r.minTier;
            if (groupOk && tierOk) return true;
        }
        return false;
    }
}
