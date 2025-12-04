pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeSciEthicsDAOFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60; // Default 1 minute cooldown

    bool public paused;
    uint256 public currentBatchId;
    bool public batchOpen;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted data storage
    mapping(uint256 => euint32) public encryptedProjectId;
    mapping(uint256 => euint32) public encryptedVoteCount;
    mapping(uint256 => euint32) public encryptedApprovalCount;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidBatchId();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    // Events
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedSet(bool paused);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event VoteSubmitted(address indexed provider, uint256 indexed batchId, uint256 projectId, bool isApproval);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 projectId, uint256 voteCount, uint256 approvalCount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        delete isProvider[provider];
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitVote(
        uint256 projectId,
        bool isApproval
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();

        lastSubmissionTime[msg.sender] = block.timestamp;

        euint32 encryptedProjectIdLocal = FHE.asEuint32(projectId);
        euint32 encryptedVoteCountLocal = FHE.asEuint32(1);
        euint32 encryptedApprovalCountLocal = FHE.asEuint32(isApproval ? 1 : 0);

        // Initialize encrypted state for the batch if not already done
        if (!FHE.isInitialized(encryptedProjectId[currentBatchId])) {
            encryptedProjectId[currentBatchId] = encryptedProjectIdLocal;
            encryptedVoteCount[currentBatchId] = encryptedVoteCountLocal;
            encryptedApprovalCount[currentBatchId] = encryptedApprovalCountLocal;
        } else {
            encryptedVoteCount[currentBatchId] = encryptedVoteCount[currentBatchId].add(encryptedVoteCountLocal);
            encryptedApprovalCount[currentBatchId] = encryptedApprovalCount[currentBatchId].add(encryptedApprovalCountLocal);
        }
        emit VoteSubmitted(msg.sender, currentBatchId, projectId, isApproval);
    }

    function requestBatchDecryption(uint256 batchId) external onlyOwner whenNotPaused checkDecryptionCooldown {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (!FHE.isInitialized(encryptedProjectId[batchId])) revert NotInitialized();

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32[] memory cts = new euint32[](3);
        cts[0] = encryptedProjectId[batchId];
        cts[1] = encryptedVoteCount[batchId];
        cts[2] = encryptedApprovalCount[batchId];

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay guard ensures this callback is processed only once.

        uint256 batchId = decryptionContexts[requestId].batchId;

        euint32[] memory cts = new euint32[](3);
        cts[0] = encryptedProjectId[batchId];
        cts[1] = encryptedVoteCount[batchId];
        cts[2] = encryptedApprovalCount[batchId];

        bytes32 currentHash = _hashCiphertexts(cts);
        // Security: State verification ensures that the ciphertexts being decrypted
        // are the same as when the decryption was requested, preventing certain attacks.
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        // Security: Proof verification ensures the decryption was performed correctly
        // by the FHEVM network according to the FHE program.
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        uint256 projectId = abi.decode(cleartexts[0:32], (uint256));
        uint256 voteCount = abi.decode(cleartexts[32:64], (uint256));
        uint256 approvalCount = abi.decode(cleartexts[64:96], (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, projectId, voteCount, approvalCount);
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[3] memory ctsAsBytes32;
        for (uint i = 0; i < cts.length; i++) {
            ctsAsBytes32[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(ctsAsBytes32, address(this)));
    }

    function _requireInitialized(euint32 cipher) internal view {
        if (!FHE.isInitialized(cipher)) revert NotInitialized();
    }
}