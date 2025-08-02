// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PaymentEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    enum PaymentStatus {
        PENDING,
        COMMITTED,
        FULFILLED, 
        CANCELLED,
        EXPIRED
    }
    
    struct PaymentRequest {
        uint256 requestId;          // Numeric identifier linking to MongoDB
        address requester;          // Who created the payment request
        address payer;              // Who will fulfill the payment (set when committed)
        uint256 amountINR;          // Amount in INR (wei equivalent for precision)
        address tokenAddress;       // Always DAI token address
        uint256 daiAmount;          // Amount of DAI deposited
        uint256 payerFee;           // ETH payer fee (excluding platform fee)
        PaymentStatus status;       // Current status
        uint256 createdAt;          // Timestamp when request was created
        uint256 committedAt;        // Timestamp when request was committed
        uint256 expiresAt;          // When the request expires
        string transactionNumber;   // 12-digit UPI transaction number
    }
    
    mapping(uint256 => PaymentRequest) public paymentRequests;
    mapping(address => uint256[]) public userRequests; // Track user's requests
    
    uint256[] public allRequestIds; // Track all requests for enumeration
    uint256 public nextRequestId = 1; // Auto-incrementing request ID counter
    
    // Platform fee configuration
    uint256 public constant PLATFORM_FEE = 10000; // Flat 10,000 wei platform fee
    // Fee recipient is always the contract owner (creator)
    
    event PaymentRequestCreated(
        uint256 indexed requestId,
        address indexed requester,
        uint256 amountINR,
        address tokenAddress,
        uint256 tokenAmount,
        uint256 payerFee,
        uint256 expiresAt
    );
    
    event PaymentCommitted(
        uint256 indexed requestId,
        address indexed payer,
        uint256 commitmentExpiry
    );
    
    event PaymentFulfilled(
        uint256 indexed requestId,
        address indexed payer,
        address tokenAddress,
        uint256 tokenAmount,
        string transactionNumber
    );
    
    event PaymentCancelled(
        uint256 indexed requestId,
        address indexed requester,
        address tokenAddress,
        uint256 tokenRefund,
        uint256 ethRefund
    );
    
    event PaymentExpired(
        uint256 indexed requestId,
        address tokenAddress,
        uint256 tokenRefund,
        uint256 ethRefund
    );
    
    
    // Duration for payment request expiry (24 hours)
    uint256 public constant REQUEST_EXPIRY_DURATION = 24 hours;
    
    // Duration for commitment timeout (5 minutes)
    uint256 public constant COMMITMENT_TIMEOUT = 5 minutes;
    
    // DAI token address (configurable during deployment)
    address public immutable DAI_TOKEN;
    
    constructor(address _daiToken) Ownable() {
        require(_daiToken != address(0), "DAI token address cannot be zero");
        DAI_TOKEN = _daiToken;
        // Contract creator becomes the owner and fee recipient
    }
    
    /**
     * @dev Create a payment request with DAI deposit + ETH fee
     * @param _amountINR Amount in INR (with precision handling)
     * @param _daiAmount Amount of DAI to deposit
     * @return requestId The auto-generated request ID
     */
    function createPaymentRequest(
        uint256 _amountINR,
        uint256 _daiAmount
    ) external payable nonReentrant returns (uint256) {
        require(_amountINR > 0, "Amount must be greater than 0");
        require(_daiAmount > 0, "DAI amount must be greater than 0");
        require(msg.value >= PLATFORM_FEE, "Must pay atleast equal to platform fee");
        
        uint256 requestId = nextRequestId;
        nextRequestId++;
        
        // Calculate payer fee (total ETH sent minus platform fee)
        uint256 payerFee = msg.value - PLATFORM_FEE;
        
        // Transfer platform fee immediately to contract owner
        (bool success, ) = payable(owner()).call{value: PLATFORM_FEE}("");
        require(success, "Platform fee transfer failed");
        
        // Transfer DAI tokens to contract
        IERC20(DAI_TOKEN).safeTransferFrom(msg.sender, address(this), _daiAmount);
        
        uint256 expiresAt = block.timestamp + REQUEST_EXPIRY_DURATION;
        
        PaymentRequest memory newRequest = PaymentRequest({
            requestId: requestId,
            requester: msg.sender,
            payer: address(0),
            amountINR: _amountINR,
            tokenAddress: DAI_TOKEN,
            daiAmount: _daiAmount,
            payerFee: payerFee,
            status: PaymentStatus.PENDING,
            createdAt: block.timestamp,
            committedAt: 0,
            expiresAt: expiresAt,
            transactionNumber: ""
        });
        
        paymentRequests[requestId] = newRequest;
        userRequests[msg.sender].push(requestId);
        allRequestIds.push(requestId);
        
        emit PaymentRequestCreated(
            requestId,
            msg.sender,
            _amountINR,
            DAI_TOKEN,
            _daiAmount,
            payerFee,
            expiresAt
        );
        
        return requestId;
    }
    
    /**
     * @dev Commit to pay for a payment request (prevents double payments)
     * @param _requestId The request to commit to
     */
    function commitToPay(uint256 _requestId) external nonReentrant {
        PaymentRequest storage request = paymentRequests[_requestId];
        
        require(request.requestId != 0, "Request does not exist");
        require(block.timestamp <= request.expiresAt, "Request expired");
        require(msg.sender != request.requester, "Cannot commit to own request");
        
        // Check if request is available for commitment
        if (request.status == PaymentStatus.PENDING) {
            // Fresh request, can be committed
        } else if (request.status == PaymentStatus.COMMITTED) {
            // Check if commitment has timed out (5 minutes)
            require(block.timestamp > request.committedAt + COMMITMENT_TIMEOUT, "Commitment still active");
            require(msg.sender != request.payer, "Already committed by this payer");
        } else {
            revert("Request not available for commitment");
        }
        
        uint256 commitmentExpiry = block.timestamp + COMMITMENT_TIMEOUT;
        
        request.status = PaymentStatus.COMMITTED;
        request.payer = msg.sender;
        request.committedAt = block.timestamp;
        
        emit PaymentCommitted(_requestId, msg.sender, commitmentExpiry);
    }
    
    /**
     * @dev Fulfill a payment request by transferring crypto to payer
     * @param _requestId The request to fulfill
     * @param _transactionNumber 12-digit UPI transaction number
     */
    function fulfillPayment(uint256 _requestId, string memory _transactionNumber) external nonReentrant {
        PaymentRequest storage request = paymentRequests[_requestId];
        
        require(request.requestId != 0, "Request does not exist");
        require(request.status == PaymentStatus.COMMITTED, "Request not committed");
        require(block.timestamp <= request.expiresAt, "Request expired");
        require(msg.sender == request.payer, "Only committed payer can fulfill");
        require(block.timestamp <= request.committedAt + COMMITMENT_TIMEOUT, "Commitment timed out");

        // Mocking the UPI transaction status validation because it requires Payment Gateway license
        require(bytes(_transactionNumber).length == 12, "Transaction number must be exactly 12 digits");
        require(isNumericString(_transactionNumber), "Transaction number must contain only digits");
        
        request.status = PaymentStatus.FULFILLED;
        request.transactionNumber = _transactionNumber;
        
        // Transfer full DAI amount to payer (no platform fee deducted from DAI)
        IERC20(DAI_TOKEN).safeTransfer(msg.sender, request.daiAmount);
        
        // Transfer payer fee to payer (platform fee was already transferred during creation)
        if (request.payerFee > 0) {
            (bool success, ) = payable(msg.sender).call{value: request.payerFee}("");
            require(success, "Payer fee transfer failed");
        }
        
        emit PaymentFulfilled(_requestId, msg.sender, DAI_TOKEN, request.daiAmount, _transactionNumber);
    }
    
    /**
     * @dev Cancel a payment request and refund crypto
     * @param _requestId The request to cancel
     */
    function cancelPaymentRequest(uint256 _requestId) external nonReentrant {
        PaymentRequest storage request = paymentRequests[_requestId];
        
        require(request.requestId != 0, "Request does not exist");
        require(request.requester == msg.sender, "Only requester can cancel");
        require(request.status == PaymentStatus.PENDING || request.status == PaymentStatus.COMMITTED, "Request not cancellable");
        
        request.status = PaymentStatus.CANCELLED;
        
        // Refund DAI to requester
        IERC20(DAI_TOKEN).safeTransfer(request.requester, request.daiAmount);
        
        // Refund payer fee to requester (platform fee was already taken during creation)
        if (request.payerFee > 0) {
            (bool success, ) = payable(request.requester).call{value: request.payerFee}("");
            require(success, "Payer fee refund failed");
        }
        
        emit PaymentCancelled(_requestId, request.requester, DAI_TOKEN, request.daiAmount, request.payerFee);
    }
    
    /**
     * @dev Expire an old payment request and refund crypto
     * @param _requestId The request to expire
     */
    function expirePaymentRequest(uint256 _requestId) external nonReentrant {
        PaymentRequest storage request = paymentRequests[_requestId];
        
        require(request.requestId != 0, "Request does not exist");
        require(request.status == PaymentStatus.PENDING || request.status == PaymentStatus.COMMITTED, "Request not expirable");
        require(block.timestamp > request.expiresAt, "Request not yet expired");
        
        request.status = PaymentStatus.EXPIRED;
        
        // Refund DAI to requester
        IERC20(DAI_TOKEN).safeTransfer(request.requester, request.daiAmount);
        
        // Refund payer fee for expired requests (platform fee was already taken during creation)
        if (request.payerFee > 0) {
            (bool success, ) = payable(request.requester).call{value: request.payerFee}("");
            require(success, "Payer fee refund failed");
        }
        
        emit PaymentExpired(_requestId, DAI_TOKEN, request.daiAmount, request.payerFee);
    }
    
    /**
     * @dev Get payment request details
     * @param _requestId The request ID to query
     */
    function getPaymentRequest(uint256 _requestId) 
        external 
        view 
        returns (PaymentRequest memory) 
    {
        require(paymentRequests[_requestId].requestId != 0, "Request does not exist");
        return paymentRequests[_requestId];
    }
    
    /**
     * @dev Get all available payment requests (pending and timed-out commitments)
     */
    function getAvailableRequests() 
        external 
        view 
        returns (PaymentRequest[] memory) 
    {
        uint256 availableCount = 0;
        
        // Count available requests (PENDING or COMMITTED with timeout)
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            bool isAvailable = false;
            
            if (block.timestamp <= request.expiresAt) {
                if (request.status == PaymentStatus.PENDING) {
                    isAvailable = true;
                } else if (request.status == PaymentStatus.COMMITTED && 
                          block.timestamp > request.committedAt + COMMITMENT_TIMEOUT) {
                    isAvailable = true;
                }
            }
            
            if (isAvailable) {
                availableCount++;
            }
        }
        
        // Create array of available requests
        PaymentRequest[] memory available = new PaymentRequest[](availableCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            bool isAvailable = false;
            
            if (block.timestamp <= request.expiresAt) {
                if (request.status == PaymentStatus.PENDING) {
                    isAvailable = true;
                } else if (request.status == PaymentStatus.COMMITTED && 
                          block.timestamp > request.committedAt + COMMITMENT_TIMEOUT) {
                    isAvailable = true;
                }
            }
            
            if (isAvailable) {
                available[index] = request;
                index++;
            }
        }
        
        return available;
    }
    
    /**
     * @dev Get all committed payment requests (active commitments only)
     */
    function getCommittedRequests() 
        external 
        view 
        returns (PaymentRequest[] memory) 
    {
        uint256 committedCount = 0;
        
        // Count active committed requests
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            if (request.status == PaymentStatus.COMMITTED && 
                block.timestamp <= request.expiresAt &&
                block.timestamp <= request.committedAt + COMMITMENT_TIMEOUT) {
                committedCount++;
            }
        }
        
        // Create array of committed requests
        PaymentRequest[] memory committed = new PaymentRequest[](committedCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            if (request.status == PaymentStatus.COMMITTED && 
                block.timestamp <= request.expiresAt &&
                block.timestamp <= request.committedAt + COMMITMENT_TIMEOUT) {
                committed[index] = request;
                index++;
            }
        }
        
        return committed;
    }
    
    /**
     * @dev Get user's payment requests
     * @param _user The user address to query
     */
    function getUserRequests(address _user) 
        external 
        view 
        returns (PaymentRequest[] memory) 
    {
        uint256[] memory userRequestIds = userRequests[_user];
        PaymentRequest[] memory requests = new PaymentRequest[](userRequestIds.length);
        
        for (uint256 i = 0; i < userRequestIds.length; i++) {
            requests[i] = paymentRequests[userRequestIds[i]];
        }
        
        return requests;
    }
    
    /**
     * @dev Get requests committed by a specific payer
     * @param _payer The payer address to query
     */
    function getPayerCommittedRequests(address _payer) 
        external 
        view 
        returns (PaymentRequest[] memory) 
    {
        uint256 payerCommittedCount = 0;
        
        // Count committed requests by this payer
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            if (request.status == PaymentStatus.COMMITTED && request.payer == _payer) {
                payerCommittedCount++;
            }
        }
        
        // Create array of payer's committed requests
        PaymentRequest[] memory payerCommitted = new PaymentRequest[](payerCommittedCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allRequestIds.length; i++) {
            PaymentRequest memory request = paymentRequests[allRequestIds[i]];
            if (request.status == PaymentStatus.COMMITTED && request.payer == _payer) {
                payerCommitted[index] = request;
                index++;
            }
        }
        
        return payerCommitted;
    }
    
    /**
     * @dev Get total number of requests
     */
    function getTotalRequests() external view returns (uint256) {
        return allRequestIds.length;
    }
    
    /**
     * @dev Check if request has expired
     * @param _requestId The request ID to check
     */
    function isRequestExpired(uint256 _requestId) external view returns (bool) {
        PaymentRequest memory request = paymentRequests[_requestId];
        require(request.requestId != 0, "Request does not exist");
        return block.timestamp > request.expiresAt;
    }
    
    /**
     * @dev Check if commitment has timed out
     * @param _requestId The request ID to check
     */
    function isCommitmentTimedOut(uint256 _requestId) external view returns (bool) {
        PaymentRequest memory request = paymentRequests[_requestId];
        require(request.requestId != 0, "Request does not exist");
        
        if (request.status != PaymentStatus.COMMITTED) {
            return false;
        }
        
        return block.timestamp > request.committedAt + COMMITMENT_TIMEOUT;
    }
    
    /**
     * @dev Get commitment expiry time
     * @param _requestId The request ID to check
     */
    function getCommitmentExpiry(uint256 _requestId) external view returns (uint256) {
        PaymentRequest memory request = paymentRequests[_requestId];
        require(request.requestId != 0, "Request does not exist");
        require(request.status == PaymentStatus.COMMITTED, "Request not committed");
        
        return request.committedAt + COMMITMENT_TIMEOUT;
    }
    
    /**
     * @dev Get platform fee amount (constant 10,000 wei)
     */
    function getPlatformFee() external pure returns (uint256) {
        return PLATFORM_FEE;
    }
    
    /**
     * @dev Get the next request ID that will be assigned
     */
    function getNextRequestId() external view returns (uint256) {
        return nextRequestId;
    }
    
    /**
     * @dev Check if a string contains only numeric characters
     * @param _str The string to check
     */
    function isNumericString(string memory _str) internal pure returns (bool) {
        bytes memory strBytes = bytes(_str);
        for (uint i = 0; i < strBytes.length; i++) {
            if (strBytes[i] < 0x30 || strBytes[i] > 0x39) {
                return false; // Not a digit (0-9)
            }
        }
        return true;
    }
    
}