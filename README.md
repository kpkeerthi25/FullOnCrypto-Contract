# FullOnCrypto Smart Contracts

Smart contracts for the FullOnCrypto payment escrow system on Base L2.

## Overview

The `PaymentEscrow` contract manages crypto-to-rupee payment requests with the following flow:

1. **User creates payment request**: Deposits DAI equivalent to INR amount + ETH fee
2. **Request tracked on-chain**: Contract stores request with unique ID linking to MongoDB
3. **Payer commits to request**: Reserves the request for 5 minutes (prevents double payments)
4. **UPI details shown**: Only committed payer sees UPI QR code from MongoDB to make INR payment
5. **Payer fulfills request**: Must complete within 5 minutes to receive DAI
6. **Commitment timeout**: After 5 minutes, other payers can commit to the request
7. **Automatic expiry**: Unfulfilled requests expire after 24 hours with full refund (DAI + ETH)

## Contract Features

### Core Functions
- `createPaymentRequest()` - Create request with DAI deposit + ETH fee
- `commitToPay()` - Commit to pay for a request (5-minute timeout, allows payer switching)
- `fulfillPayment()` - Fulfill committed request within 5 minutes and receive DAI
- `cancelPaymentRequest()` - Cancel request and get DAI refund (ETH fee non-refundable)
- `expirePaymentRequest()` - Expire old requests (full refund including ETH fee)

### Query Functions  
- `getAvailableRequests()` - Get all uncommitted requests (including timed-out commitments)
- `getCommittedRequests()` - Get all actively committed requests (within 5-minute window)
- `getPayerCommittedRequests()` - Get requests committed by specific payer
- `getUserRequests()` - Get user's requests
- `getPaymentRequest()` - Get specific request details
- `isCommitmentTimedOut()` - Check if commitment has expired
- `getCommitmentExpiry()` - Get commitment expiry timestamp

### Payment Statuses
- `PENDING` - Active request awaiting commitment
- `COMMITTED` - Request committed by payer, awaiting fulfillment
- `FULFILLED` - Completed payment
- `CANCELLED` - Cancelled by requester  
- `EXPIRED` - Expired after 24 hours

## Setup & Installation

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm run test

# Deploy to Base Sepolia testnet
npm run deploy:base-testnet

# Deploy to Base mainnet
npm run deploy:base
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add your private key for deployment
3. Optionally add RPC URLs and Etherscan API key

## Fee Structure

- **Settlement Token**: DAI only (Base L2: `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb`)
- **Platform Fee**: Flat 10,000 wei ETH (taken immediately during request creation, sent to contract owner)
- **Payer Fee**: Remaining ETH amount (stored in contract, transferred to payer on fulfillment)
- **Fee Recipient**: Always the contract creator/owner (no configuration needed)
- **Cancellation**: DAI + payer fee refunded (platform fee non-refundable)
- **Expiry**: DAI + payer fee refunded (platform fee non-refundable)
- **Commitment Timeout**: 5 minutes (after timeout, other payers can commit)

## Integration with Backend

The contract uses `uint256` numeric request IDs that link to MongoDB records:
## Deployment

The contract is designed for Base L2:
- **Base Sepolia (Testnet)**: Chain ID 84532
- **Base Mainnet**: Chain ID 8453

Deploy with: `npm run deploy:base` or `npm run deploy:base-testnet`