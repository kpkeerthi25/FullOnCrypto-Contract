const hre = require("hardhat");

async function main() {
  console.log("Deploying PaymentEscrow contract...");

  // Get the signer (deployer)
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", hre.ethers.utils.formatEther(await deployer.getBalance()));

  // Get the ContractFactory and Signers here.
  const PaymentEscrow = await hre.ethers.getContractFactory("PaymentEscrow");
  
  // Deploy the contract (deployer automatically becomes owner and fee recipient)
  const paymentEscrow = await PaymentEscrow.deploy();

  await paymentEscrow.deployed();

  console.log("PaymentEscrow deployed to:", paymentEscrow.address);
  console.log("Contract owner and fee recipient:", deployer.address);

  // Verify contract on Basescan if deploying to Base mainnet
  if (hre.network.name === "base") {
    console.log("Waiting for block confirmations...");
    await paymentEscrow.deployTransaction.wait(6);
    
    console.log("Verifying contract...");
    try {
      await hre.run("verify:verify", {
        address: paymentEscrow.address,
        constructorArguments: []
      });
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }

  console.log("Deployment completed!");
  console.log("Contract Address:", paymentEscrow.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", hre.network.config.chainId);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });