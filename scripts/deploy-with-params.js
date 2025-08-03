const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // Get command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: node scripts/deploy-with-params.js <chainId> <privateKey> [daiTokenAddress]");
    console.error("Example: node scripts/deploy-with-params.js 1337 your_private_key_here");
    console.error("Note: If daiTokenAddress is not provided, MockDAI will be deployed and used for non-mainnet chains");
    process.exit(1);
  }

  const chainId = parseInt(args[0]);
  const privateKey = args[1];
  const providedDaiAddress = args[2]; // Optional third argument

  if (!chainId || !privateKey) {
    console.error("Invalid chainId or privateKey provided");
    process.exit(1);
  }

  // Validate private key format (should start with 0x and be 64 hex chars)
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error("Private key must be in format 0x followed by 64 hex characters");
    process.exit(1);
  }

  console.log(`Deploying contracts with:`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Private Key: ${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 4)}`);

  // Create a provider and wallet
  let rpcUrl;
  let networkName;
  
  // Determine RPC URL and DAI strategy based on chain ID
  let isMainnet = false;
  switch (chainId) {
    case 1337:
      rpcUrl = "http://127.0.0.1:8545";
      networkName = "localhost";
      break;
    case 84532:
      rpcUrl = "https://sepolia.base.org";
      networkName = "base-sepolia";
      break;
    case 8453:
      rpcUrl = "https://mainnet.base.org";
      networkName = "base";
      isMainnet = true;
      break;
    default:
      console.error(`Unsupported chain ID: ${chainId}`);
      console.error("Supported chain IDs: 1337 (localhost), 84532 (base-sepolia), 8453 (base)");
      process.exit(1);
  }

  // Determine DAI token address strategy
  let daiTokenAddress;
  let shouldDeployMockDAI = false;

  if (providedDaiAddress) {
    // Use provided DAI address
    daiTokenAddress = providedDaiAddress;
    console.log(`Using provided DAI token address: ${daiTokenAddress}`);
  } else if (isMainnet) {
    // Use real DAI address for mainnet
    daiTokenAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"; // Base mainnet DAI
    console.log(`Using Base mainnet DAI address: ${daiTokenAddress}`);
  } else {
    // Deploy MockDAI for testnets and localhost
    shouldDeployMockDAI = true;
    console.log(`Will deploy MockDAI for testing on ${networkName}`);
  }

  // Create deployer based on network type
  let deployer;
  
  if (chainId === 1337) {
    // For localhost, use Hardhat's built-in network and signers
    const signers = await hre.ethers.getSigners();
    // Find the signer that matches our private key
    const wallet = new hre.ethers.Wallet(privateKey);
    const targetAddress = wallet.address;
    
    // Check if the address matches any of the default Hardhat accounts
    deployer = signers.find(signer => signer.address.toLowerCase() === targetAddress.toLowerCase());
    
    if (!deployer) {
      // If not found in default accounts, create a custom wallet with Hardhat provider
      deployer = wallet.connect(hre.ethers.provider);
    }
  } else {
    // For other networks, create custom provider and wallet
    const provider = new hre.ethers.providers.JsonRpcProvider(rpcUrl);
    deployer = new hre.ethers.Wallet(privateKey, provider);
  }
  console.log("Deploying with account:", deployer.address);
  
  const balance = await deployer.getBalance();
  console.log("Account balance:", hre.ethers.utils.formatEther(balance), "ETH");

  if (balance.eq(0)) {
    console.error("Deployer account has no balance. Please fund the account before deployment.");
    process.exit(1);
  }

  let mockDAI = null;
  
  // Deploy MockDAI if needed
  if (shouldDeployMockDAI) {
    console.log("\n=== Deploying MockDAI Contract ===");
    
    const MockDAI = await hre.ethers.getContractFactory("MockDAI", deployer);
    console.log("Deploying MockDAI...");
    mockDAI = await MockDAI.deploy();
    await mockDAI.deployed();
    
    daiTokenAddress = mockDAI.address;
    console.log("MockDAI deployed to:", mockDAI.address);
    
    // Wait a bit for the contract to be properly deployed before calling methods
    console.log("Waiting for MockDAI deployment to be confirmed...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const deployerDAIBalance = await mockDAI.balanceOf(deployer.address);
      console.log("MockDAI deployer balance:", hre.ethers.utils.formatEther(deployerDAIBalance), "DAI");
    } catch (error) {
      console.log("Note: Could not fetch MockDAI balance immediately after deployment (this is normal)");
    }
  }

  console.log("\n=== Deploying PaymentEscrow Contract ===");
  
  // Deploy PaymentEscrow with DAI token address
  const PaymentEscrow = await hre.ethers.getContractFactory("PaymentEscrow", deployer);
  console.log(`Deploying PaymentEscrow with DAI token: ${daiTokenAddress}`);
  
  let paymentEscrow;
  
  // Estimate gas for deployment
  try {
    const deployData = PaymentEscrow.getDeployTransaction(daiTokenAddress);
    const estimatedGas = await deployer.estimateGas(deployData);
    console.log(`Estimated gas for deployment: ${estimatedGas.toString()}`);
    
    // Set gas parameters for Base mainnet
    let deployOptions = {};
    if (isMainnet) {
      // Add 50% buffer to estimated gas
      const gasLimit = estimatedGas.mul(150).div(100);
      
      // Try to get current gas price from network
      let gasPrice;
      try {
        const feeData = await deployer.provider.getFeeData();
        gasPrice = feeData.gasPrice || hre.ethers.utils.parseUnits('0.01', 'gwei');
        console.log(`Network suggested gas price: ${hre.ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
      } catch (e) {
        gasPrice = hre.ethers.utils.parseUnits('0.01', 'gwei');
        console.log(`Using fallback gas price: ${hre.ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
      }
      
      deployOptions = {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      };
      console.log(`Using mainnet gas settings: gasLimit=${gasLimit.toString()}, gasPrice=${hre.ethers.utils.formatUnits(deployOptions.gasPrice, 'gwei')} gwei`);
    }
    
    paymentEscrow = await PaymentEscrow.deploy(daiTokenAddress, deployOptions);
    await paymentEscrow.deployed();
  } catch (gasEstimationError) {
    console.log("Gas estimation failed, using default settings:", gasEstimationError.message);
    
    // Fallback to higher gas limit if estimation fails
    let deployOptions = {};
    if (isMainnet) {
      deployOptions = {
        gasLimit: 8000000, // Higher fallback gas limit
        gasPrice: hre.ethers.utils.parseUnits('0.1', 'gwei') // Higher fallback gas price for Base
      };
      console.log(`Using fallback gas settings: gasLimit=${deployOptions.gasLimit}, gasPrice=${hre.ethers.utils.formatUnits(deployOptions.gasPrice, 'gwei')} gwei`);
    }
    
    paymentEscrow = await PaymentEscrow.deploy(daiTokenAddress, deployOptions);
    await paymentEscrow.deployed();
  }
  
  console.log("PaymentEscrow deployed to:", paymentEscrow.address);
  console.log("PaymentEscrow owner:", deployer.address);
  
  // Wait a bit for the contract to be properly deployed before calling methods
  console.log("Waiting for PaymentEscrow deployment to be confirmed...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    const daiTokenFromContract = await paymentEscrow.DAI_TOKEN();
    console.log("PaymentEscrow DAI token:", daiTokenFromContract);
  } catch (error) {
    console.log("Note: Could not fetch DAI token address immediately after deployment (this is normal)");
  }

  // Create deployment info object
  const deploymentInfo = {
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    daiTokenAddress: daiTokenAddress,
    mockDAIDeployed: shouldDeployMockDAI,
    contracts: {
      PaymentEscrow: {
        address: paymentEscrow.address,
        transactionHash: paymentEscrow.deployTransaction.hash,
        daiToken: daiTokenAddress
      }
    }
  };

  // Add MockDAI info if it was deployed
  if (mockDAI) {
    deploymentInfo.contracts.MockDAI = {
      address: mockDAI.address,
      transactionHash: mockDAI.deployTransaction.hash
    };
  }

  // Save deployment info to file
  const deploymentInfoPath = path.join(__dirname, '..', `deployment-${chainId}-${Date.now()}.json`);
  fs.writeFileSync(deploymentInfoPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${deploymentInfoPath}`);

  // Contract verification for supported networks
  if (networkName === "base" || networkName === "base-sepolia") {
    console.log("\n=== Contract Verification ===");
    console.log("Waiting for block confirmations...");
    
    try {
      // Wait for confirmations
      if (mockDAI) {
        await mockDAI.deployTransaction.wait(6);
      }
      await paymentEscrow.deployTransaction.wait(6);
      
      // Verify MockDAI if deployed
      if (mockDAI) {
        console.log("Attempting to verify MockDAI...");
        try {
          await hre.run("verify:verify", {
            address: mockDAI.address,
            constructorArguments: []
          });
          console.log("MockDAI verified successfully");
        } catch (error) {
          console.log("MockDAI verification failed:", error.message);
        }
      }

      console.log("Attempting to verify PaymentEscrow...");
      try {
        await hre.run("verify:verify", {
          address: paymentEscrow.address,
          constructorArguments: [daiTokenAddress]
        });
        console.log("PaymentEscrow verified successfully");
      } catch (error) {
        console.log("PaymentEscrow verification failed:", error.message);
      }
      
    } catch (error) {
      console.log("Verification process failed:", error.message);
    }
  }

  console.log("\n=== Deployment Summary ===");
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`DAI Token Address: ${daiTokenAddress}`);
  if (mockDAI) {
    console.log(`MockDAI Address: ${mockDAI.address} (deployed for testing)`);
  } else {
    console.log(`Using existing DAI token: ${daiTokenAddress}`);
  }
  console.log(`PaymentEscrow Address: ${paymentEscrow.address}`);
  console.log(`Deployment completed successfully!`);

  // Final balance check
  const finalBalance = await deployer.getBalance();
  const gasUsed = balance.sub(finalBalance);
  console.log(`Gas used: ${hre.ethers.utils.formatEther(gasUsed)} ETH`);
  console.log(`Final balance: ${hre.ethers.utils.formatEther(finalBalance)} ETH`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });