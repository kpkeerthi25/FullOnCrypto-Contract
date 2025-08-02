const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentEscrow", function () {
  let PaymentEscrow;
  let paymentEscrow;
  let owner;
  let requester;
  let payer;
  let addrs;

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
    [owner, requester, payer, ...addrs] = await ethers.getSigners();

    // Deploy a fresh contract for each test
    paymentEscrow = await PaymentEscrow.deploy(owner.address);
    await paymentEscrow.deployed();
  });

  describe("Payment Request Creation", function () {
    it("Should create a payment request with crypto deposit", async function () {
      const requestId = ethers.utils.hexZeroPad("0x12345678901234567890123456789012", 16); // 16 bytes UUID
      const amountINR = ethers.utils.parseEther("1000"); // 1000 INR  
      const tokenAmount = ethers.utils.parseEther("0.01"); // 0.01 ETH
      const ethFee = ethers.utils.parseEther("0.001"); // 0.001 ETH fee

      await expect(
        paymentEscrow.connect(requester).createPaymentRequest(
          requestId, 
          amountINR, 
          ethers.constants.AddressZero, // ETH deposit
          tokenAmount,
          {
            value: tokenAmount.add(ethFee) // Total ETH sent
          }
        )
      )
        .to.emit(paymentEscrow, "PaymentRequestCreated")
        .withArgs(requestId, requester.address, amountINR, ethers.constants.AddressZero, tokenAmount, tokenAmount.add(ethFee), await getExpectedExpiryTime());

      const request = await paymentEscrow.getPaymentRequest(requestId);
      expect(request.requester).to.equal(requester.address);
      expect(request.amountINR).to.equal(amountINR);
      expect(request.tokenAmount).to.equal(tokenAmount);
      expect(request.ethFee).to.equal(tokenAmount.add(ethFee));
      expect(request.status).to.equal(0); // PENDING
    });

    it("Should fail to create request with zero crypto deposit", async function () {
      const requestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-request-2"));
      const amountINR = ethers.utils.parseEther("1000");

      await expect(
        paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
          value: 0
        })
      ).to.be.revertedWith("Must deposit crypto");
    });

    it("Should fail to create request with duplicate request ID", async function () {
      const requestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-request-3"));
      const amountINR = ethers.utils.parseEther("1000");
      const cryptoDeposit = ethers.utils.parseEther("0.01");

      // Create first request
      await paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
        value: cryptoDeposit
      });

      // Try to create duplicate
      await expect(
        paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
          value: cryptoDeposit
        })
      ).to.be.revertedWith("Request ID already exists");
    });
  });

  describe("Payment Fulfillment", function () {
    let requestId;
    let amountINR;
    let cryptoDeposit;

    beforeEach(async function () {
      requestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-fulfill"));
      amountINR = ethers.utils.parseEther("1000");
      cryptoDeposit = ethers.utils.parseEther("0.01");

      await paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
        value: cryptoDeposit
      });
    });

    it("Should fulfill payment and transfer crypto to payer", async function () {
      const payerBalanceBefore = await payer.getBalance();

      await expect(paymentEscrow.connect(payer).fulfillPayment(requestId))
        .to.emit(paymentEscrow, "PaymentFulfilled")
        .withArgs(requestId, payer.address, cryptoDeposit);

      // Check that crypto was transferred to payer
      const payerBalanceAfter = await payer.getBalance();
      expect(payerBalanceAfter.sub(payerBalanceBefore)).to.be.closeTo(
        cryptoDeposit,
        ethers.utils.parseEther("0.001") // Allow for gas costs
      );

      // Check request status
      const request = await paymentEscrow.getPaymentRequest(requestId);
      expect(request.status).to.equal(1); // FULFILLED
      expect(request.payer).to.equal(payer.address);
    });

    it("Should fail if requester tries to fulfill own request", async function () {
      await expect(
        paymentEscrow.connect(requester).fulfillPayment(requestId)
      ).to.be.revertedWith("Cannot fulfill own request");
    });

    it("Should fail to fulfill non-existent request", async function () {
      const fakeRequestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fake-request"));
      
      await expect(
        paymentEscrow.connect(payer).fulfillPayment(fakeRequestId)
      ).to.be.revertedWith("Request does not exist");
    });
  });

  describe("Payment Cancellation", function () {
    let requestId;
    let amountINR;
    let cryptoDeposit;

    beforeEach(async function () {
      requestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-cancel"));
      amountINR = ethers.utils.parseEther("1000");
      cryptoDeposit = ethers.utils.parseEther("0.01");

      await paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
        value: cryptoDeposit
      });
    });

    it("Should cancel request and refund crypto to requester", async function () {
      const requesterBalanceBefore = await requester.getBalance();

      await expect(paymentEscrow.connect(requester).cancelPaymentRequest(requestId))
        .to.emit(paymentEscrow, "PaymentCancelled")
        .withArgs(requestId, requester.address, cryptoDeposit);

      // Check that crypto was refunded to requester
      const requesterBalanceAfter = await requester.getBalance();
      expect(requesterBalanceAfter.sub(requesterBalanceBefore)).to.be.closeTo(
        cryptoDeposit,
        ethers.utils.parseEther("0.001") // Allow for gas costs
      );

      // Check request status
      const request = await paymentEscrow.getPaymentRequest(requestId);
      expect(request.status).to.equal(2); // CANCELLED
    });

    it("Should fail if non-requester tries to cancel", async function () {
      await expect(
        paymentEscrow.connect(payer).cancelPaymentRequest(requestId)
      ).to.be.revertedWith("Only requester can cancel");
    });
  });

  describe("Request Queries", function () {
    it("Should get pending requests correctly", async function () {
      // Create multiple requests
      const requestId1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("pending-1"));
      const requestId2 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("pending-2"));
      const amountINR = ethers.utils.parseEther("1000");
      const cryptoDeposit = ethers.utils.parseEther("0.01");

      await paymentEscrow.connect(requester).createPaymentRequest(requestId1, amountINR, {
        value: cryptoDeposit
      });
      await paymentEscrow.connect(requester).createPaymentRequest(requestId2, amountINR, {
        value: cryptoDeposit
      });

      const pendingRequests = await paymentEscrow.getPendingRequests();
      expect(pendingRequests.length).to.equal(2);
      expect(pendingRequests[0].requestId).to.equal(requestId1);
      expect(pendingRequests[1].requestId).to.equal(requestId2);
    });

    it("Should get user requests correctly", async function () {
      const requestId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("user-request"));
      const amountINR = ethers.utils.parseEther("1000");
      const cryptoDeposit = ethers.utils.parseEther("0.01");

      await paymentEscrow.connect(requester).createPaymentRequest(requestId, amountINR, {
        value: cryptoDeposit
      });

      const userRequests = await paymentEscrow.getUserRequests(requester.address);
      expect(userRequests.length).to.equal(1);
      expect(userRequests[0].requestId).to.equal(requestId);
    });
  });

  // Helper function to calculate expected expiry time
  async function getExpectedExpiryTime() {
    const latestBlock = await ethers.provider.getBlock("latest");
    return latestBlock.timestamp + (24 * 60 * 60); // 24 hours
  }
});