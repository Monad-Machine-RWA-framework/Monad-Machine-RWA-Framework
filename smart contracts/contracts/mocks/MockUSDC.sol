// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Minimal 6-decimal stablecoin used locally as the yield / origin
///         token. In live mode this stands in for native USDC routed through a
///         whitelisted Cleanverse institution. Anyone can `faucet` on the local
///         network, mirroring the Cleanverse `/faucet` sandbox endpoint.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
