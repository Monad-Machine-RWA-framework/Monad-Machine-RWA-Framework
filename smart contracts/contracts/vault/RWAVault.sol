// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SecurityToken} from "../token/SecurityToken.sol";
import {MachineNFT} from "../assets/MachineNFT.sol";
import {ContractNFT} from "../assets/ContractNFT.sol";
import {IIdentityRegistry} from "../identity/IIdentityRegistry.sol";

/// @title RWAVault
/// @notice Collateralisation + issuance + yield engine for the Machine RWA flow.
///         A controller (Alice) deposits Machine NFTs and a Contract NFT as
///         collateral, then mints compliance-gated SecurityTokens against the
///         declared machine valuations. Yield (in MockUSDC) deposited by the
///         controller is distributed pro-rata to SecurityToken holders, who pull
///         their share. `claimYieldFor` lets one holder trigger a payout to
///         another (e.g. Bob claiming on Charlie's behalf).
///
///         Yield accounting uses the standard accumulator pattern and assumes
///         token distribution is settled before each yield deposit (which is the
///         case in the reference workflow: transfers happen, then yield).
contract RWAVault is AccessControl, ReentrancyGuard, IERC721Receiver {
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    uint256 private constant ACC_PRECISION = 1e18;

    SecurityToken public immutable securityToken;
    MachineNFT public immutable machineNFT;
    ContractNFT public immutable contractNFT;
    IERC20 public immutable yieldToken;
    IIdentityRegistry public immutable registry;

    uint256[] public depositedMachines;
    uint256 public depositedContractId;
    bool public hasContractCollateral;
    uint256 public totalCollateralValue;
    uint256 public totalMinted;

    // Yield accounting.
    uint256 public accYieldPerShare; // scaled by ACC_PRECISION
    uint256 public totalYieldDeposited;
    mapping(address => uint256) public yieldSnapshot; // last accPerShare seen
    mapping(address => uint256) public yieldCredited; // accrued-but-unclaimed

    event CollateralDeposited(uint256[] machineIds, uint256 contractId, uint256 value);
    event Minted(address indexed to, uint256 amount);
    event YieldDeposited(address indexed from, uint256 amount, uint256 accPerShare);
    event YieldClaimed(address indexed holder, address indexed to, uint256 amount);

    constructor(
        address admin,
        address controller,
        SecurityToken securityToken_,
        MachineNFT machineNFT_,
        ContractNFT contractNFT_,
        IERC20 yieldToken_,
        IIdentityRegistry registry_
    ) {
        securityToken = securityToken_;
        machineNFT = machineNFT_;
        contractNFT = contractNFT_;
        yieldToken = yieldToken_;
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONTROLLER_ROLE, controller);
    }

    /// @notice Admin can (re)assign the controller (e.g. set Alice as controller).
    function setController(address controller)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _grantRole(CONTROLLER_ROLE, controller);
    }

    // --------------------------------------------------------------------
    // Collateralise & mint
    // --------------------------------------------------------------------

    /// @notice Pull Machine NFTs and a Contract NFT into the vault as collateral.
    ///         Requires prior `approve` / `setApprovalForAll` from the controller.
    function depositCollateral(uint256[] calldata machineIds, uint256 contractId)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        uint256 addedValue;
        for (uint256 i = 0; i < machineIds.length; i++) {
            uint256 id = machineIds[i];
            addedValue += machineNFT.valuationOf(id);
            machineNFT.safeTransferFrom(msg.sender, address(this), id);
            depositedMachines.push(id);
        }

        contractNFT.safeTransferFrom(msg.sender, address(this), contractId);
        depositedContractId = contractId;
        hasContractCollateral = true;

        totalCollateralValue += addedValue;
        emit CollateralDeposited(machineIds, contractId, addedValue);
    }

    /// @notice Mint SecurityTokens against collateral. Cannot exceed the total
    ///         declared collateral value (1:1 valuation-to-token for the demo).
    function mint(address to, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        require(amount > 0, "RWAVault: zero amount");
        require(
            totalMinted + amount <= totalCollateralValue,
            "RWAVault: exceeds collateral"
        );
        _accrue(to);
        totalMinted += amount;
        securityToken.mint(to, amount);
        emit Minted(to, amount);
    }

    // --------------------------------------------------------------------
    // Yield
    // --------------------------------------------------------------------

    /// @notice Controller deposits yield (MockUSDC) for pro-rata distribution.
    ///         Requires prior `approve` on the yield token.
    function depositYield(uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        require(amount > 0, "RWAVault: zero yield");
        uint256 supply = securityToken.totalSupply();
        require(supply > 0, "RWAVault: no holders");

        yieldToken.transferFrom(msg.sender, address(this), amount);
        accYieldPerShare += (amount * ACC_PRECISION) / supply;
        totalYieldDeposited += amount;
        emit YieldDeposited(msg.sender, amount, accYieldPerShare);
    }

    /// @notice Pending (claimable) yield for a holder at the current accumulator.
    function pendingYield(address holder) public view returns (uint256) {
        uint256 bal = securityToken.balanceOf(holder);
        uint256 accrued = (bal * (accYieldPerShare - yieldSnapshot[holder])) /
            ACC_PRECISION;
        return yieldCredited[holder] + accrued;
    }

    /// @notice Claim caller's own yield.
    function claimYield() external nonReentrant returns (uint256) {
        return _claim(msg.sender, msg.sender);
    }

    /// @notice Claim `beneficiary`'s yield and pay it to the beneficiary. Lets a
    ///         holder (e.g. Bob) settle another holder's (Charlie's) payout.
    function claimYieldFor(address beneficiary)
        external
        nonReentrant
        returns (uint256)
    {
        return _claim(beneficiary, beneficiary);
    }

    function _claim(address holder, address to) private returns (uint256 amount) {
        _accrue(holder);
        amount = yieldCredited[holder];
        require(amount > 0, "RWAVault: nothing to claim");
        yieldCredited[holder] = 0;
        yieldToken.transfer(to, amount);
        emit YieldClaimed(holder, to, amount);
    }

    /// @dev Fold accrued yield into the credited balance and advance the snapshot.
    function _accrue(address holder) private {
        uint256 bal = securityToken.balanceOf(holder);
        if (bal > 0) {
            yieldCredited[holder] +=
                (bal * (accYieldPerShare - yieldSnapshot[holder])) /
                ACC_PRECISION;
        }
        yieldSnapshot[holder] = accYieldPerShare;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
