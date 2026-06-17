// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MachineNFT
/// @notice Tokenised real-world machine. Minted by an authorised Machine Issuer
///         (MACHINE_ISSUER_ROLE) to an owner (e.g. Alice). Carries on-chain
///         metadata describing the underlying machine and a declared value used
///         by the vault to size the security-token mint.
contract MachineNFT is ERC721, AccessControl {
    bytes32 public constant MACHINE_ISSUER_ROLE =
        keccak256("MACHINE_ISSUER_ROLE");

    struct Machine {
        string serial;
        string model;
        uint256 valuation; // declared value, in MockUSDC base units
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Machine) public machines;

    event MachineMinted(
        uint256 indexed tokenId,
        address indexed to,
        string serial,
        uint256 valuation
    );

    constructor(address admin) ERC721("Cleanverse Machine", "MACHINE") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MACHINE_ISSUER_ROLE, admin);
    }

    function mintMachine(
        address to,
        string calldata serial,
        string calldata model,
        uint256 valuation
    ) external onlyRole(MACHINE_ISSUER_ROLE) returns (uint256 tokenId) {
        tokenId = _nextId++;
        machines[tokenId] = Machine({
            serial: serial,
            model: model,
            valuation: valuation
        });
        _safeMint(to, tokenId);
        emit MachineMinted(tokenId, to, serial, valuation);
    }

    function valuationOf(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return machines[tokenId].valuation;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
