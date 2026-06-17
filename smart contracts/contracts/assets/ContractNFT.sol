// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title ContractNFT
/// @notice A multi-party agreement represented as an NFT. A proposer opens an
///         agreement listing all parties (e.g. Alice, Bob, Charlie) and a terms
///         string. Each party must `accept()`; once every party has accepted,
///         the NFT is minted to the proposer and can be used as vault collateral
///         alongside the Machine NFTs.
contract ContractNFT is ERC721 {
    struct Agreement {
        address proposer;
        address[] parties;
        string terms;
        uint256 acceptedCount;
        bool finalized;
    }

    uint256 private _nextProposalId = 1;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => Agreement) private _agreements; // proposalId => agreement
    mapping(uint256 => mapping(address => bool)) public hasAccepted; // proposalId => party => accepted
    mapping(uint256 => mapping(address => bool)) public isParty;
    mapping(uint256 => uint256) public tokenIdOfProposal; // proposalId => minted tokenId (0 until finalized)

    event AgreementProposed(
        uint256 indexed proposalId,
        address indexed proposer,
        address[] parties
    );
    event AgreementAccepted(uint256 indexed proposalId, address indexed party);
    event AgreementFinalized(uint256 indexed proposalId, uint256 indexed tokenId);

    constructor() ERC721("Cleanverse Contract", "CONTRACT") {}

    /// @notice Open a new multi-party agreement. The proposer is implicitly a
    ///         party and is auto-counted as having accepted.
    function propose(address[] calldata parties, string calldata terms)
        external
        returns (uint256 proposalId)
    {
        require(parties.length >= 2, "ContractNFT: need >= 2 parties");
        proposalId = _nextProposalId++;
        Agreement storage ag = _agreements[proposalId];
        ag.proposer = msg.sender;
        ag.terms = terms;

        bool proposerIncluded;
        for (uint256 i = 0; i < parties.length; i++) {
            address p = parties[i];
            require(p != address(0), "ContractNFT: zero party");
            require(!isParty[proposalId][p], "ContractNFT: dup party");
            isParty[proposalId][p] = true;
            ag.parties.push(p);
            if (p == msg.sender) proposerIncluded = true;
        }
        require(proposerIncluded, "ContractNFT: proposer not a party");

        // Proposer auto-accepts.
        hasAccepted[proposalId][msg.sender] = true;
        ag.acceptedCount = 1;

        emit AgreementProposed(proposalId, msg.sender, ag.parties);
        emit AgreementAccepted(proposalId, msg.sender);
    }

    /// @notice A listed party accepts the agreement. When the final party
    ///         accepts, the NFT is minted to the proposer.
    function accept(uint256 proposalId) external {
        Agreement storage ag = _agreements[proposalId];
        require(ag.proposer != address(0), "ContractNFT: unknown proposal");
        require(!ag.finalized, "ContractNFT: finalized");
        require(isParty[proposalId][msg.sender], "ContractNFT: not a party");
        require(!hasAccepted[proposalId][msg.sender], "ContractNFT: already accepted");

        hasAccepted[proposalId][msg.sender] = true;
        ag.acceptedCount += 1;
        emit AgreementAccepted(proposalId, msg.sender);

        if (ag.acceptedCount == ag.parties.length) {
            ag.finalized = true;
            uint256 tokenId = _nextTokenId++;
            tokenIdOfProposal[proposalId] = tokenId;
            _safeMint(ag.proposer, tokenId);
            emit AgreementFinalized(proposalId, tokenId);
        }
    }

    function getAgreement(uint256 proposalId)
        external
        view
        returns (
            address proposer,
            address[] memory parties,
            string memory terms,
            uint256 acceptedCount,
            bool finalized
        )
    {
        Agreement storage ag = _agreements[proposalId];
        return (ag.proposer, ag.parties, ag.terms, ag.acceptedCount, ag.finalized);
    }
}
