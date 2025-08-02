#!/bin/bash

# Deployment script for MockDAI and PaymentEscrow contracts
# Usage: ./deploy.sh <chainId> <privateKey> [daiTokenAddress]

set -e  # Exit on any error

# Check if arguments are provided
if [ $# -lt 2 ]; then
    echo "Usage: ./deploy.sh <chainId> <privateKey> [daiTokenAddress]"
    echo ""
    echo "Supported Chain IDs:"
    echo "  1337    - Localhost (Hardhat network) - deploys MockDAI"
    echo "  84532   - Base Sepolia Testnet - deploys MockDAI"
    echo "  8453    - Base Mainnet - uses real DAI (0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb)"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh 1337 0x123...def                    # Uses MockDAI on localhost"
    echo "  ./deploy.sh 8453 0x123...def                    # Uses real DAI on Base mainnet"
    echo "  ./deploy.sh 1337 0x123...def 0xCustomDAIAddress # Uses custom DAI address"
    exit 1
fi

CHAIN_ID=$1
PRIVATE_KEY=$2
DAI_ADDRESS=$3

echo "🚀 Starting deployment process..."
echo "📋 Chain ID: $CHAIN_ID"
echo "🔑 Private Key: ${PRIVATE_KEY:0:10}...${PRIVATE_KEY: -4}"
if [ -n "$DAI_ADDRESS" ]; then
    echo "💰 DAI Address: $DAI_ADDRESS"
else
    if [ "$CHAIN_ID" = "8453" ]; then
        echo "💰 DAI Strategy: Using Base mainnet DAI"
    else
        echo "💰 DAI Strategy: Deploy MockDAI for testing"
    fi
fi
echo ""

# Change to the contract directory
cd "$(dirname "$0")"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Compile contracts
echo "🔨 Compiling contracts..."
npx hardhat compile

# Run deployment
echo "🚀 Deploying contracts..."
if [ -n "$DAI_ADDRESS" ]; then
    node scripts/deploy-with-params.js "$CHAIN_ID" "$PRIVATE_KEY" "$DAI_ADDRESS"
else
    node scripts/deploy-with-params.js "$CHAIN_ID" "$PRIVATE_KEY"
fi

echo "✅ Deployment process completed!"