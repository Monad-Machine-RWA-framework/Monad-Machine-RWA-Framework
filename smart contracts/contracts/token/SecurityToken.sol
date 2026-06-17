// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ComplianceModule} from "../identity/ComplianceModule.sol";

/// @title SecurityToken
/// @notice ERC-3643-style, compliance-gated security token. It is the
///         Cleanverse-native analog of an A-Token: every transfer is gated by a
///         ComplianceModule (the on-chain Validator pool mirror), it can be
///         paused (mirrors `atoken/set_paused`), and minting is restricted to
///         MINTER_ROLE (granted to the RWAVault, mirroring how a minter is
///         granted MINTER_ROLE after an A-Token is ISSUED).
contract SecurityToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    ComplianceModule public compliance;
    bool public paused;
    uint8 private immutable _decimals;

    event Paused(bool paused);
    event ComplianceUpdated(address compliance);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);

    error TransfersPaused();
    error NotCompliant(address from, address to);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin,
        ComplianceModule compliance_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        compliance = compliance_;
        paused = true; // A-Tokens start paused until explicitly unpaused.
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CONTROLLER_ROLE, admin);
        emit Paused(true);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setPaused(bool paused_) external onlyRole(PAUSER_ROLE) {
        paused = paused_;
        emit Paused(paused_);
    }

    function setCompliance(ComplianceModule compliance_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        compliance = compliance_;
        emit ComplianceUpdated(address(compliance_));
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
    {
        _burn(from, amount);
    }

    /// @notice Controller-forced transfer for recovery / enforcement actions,
    ///         analogous to the controller capability in regulated tokens.
    function forcedTransfer(
        address from,
        address to,
        uint256 amount
    ) external onlyRole(CONTROLLER_ROLE) {
        _update(from, to, amount);
        emit ForcedTransfer(from, to, amount);
    }

    /// @dev Single chokepoint for compliance enforcement on mint/transfer/burn.
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        // Minting (from == 0) is allowed while paused so the vault can issue
        // against deposited collateral; peer transfers require unpause.
        if (paused && from != address(0) && to != address(0)) {
            revert TransfersPaused();
        }
        if (!compliance.isAllowed(from, to)) {
            revert NotCompliant(from, to);
        }
        super._update(from, to, value);
    }
}
