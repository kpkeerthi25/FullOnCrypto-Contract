const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentEscrow", function () {
  let paymentEscrow;
  let mockDAI;
  let owner;
  let requester;
  let payer;
  let addrs;

  beforeEach(async function () {
    [owner, requester, payer, ...addrs] = await ethers.getSigners();

    // Deploy MockDAI
    const MockDAI = await ethers.getContractFactory("MockDAI");
    mockDAI = await MockDAI.deploy();
    await mockDAI.deployed();

    // Deploy PaymentEscrow with MockDAI address
    const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
    paymentEscrow = await PaymentEscrow.deploy(mockDAI.address);
    await paymentEscrow.deployed();

    // Give users some DAI for testing
    await mockDAI.connect(requester).faucet(); // 1000 DAI
    await mockDAI.connect(payer).faucet(); // 1000 DAI
  });

  describe("Payment Request Creation", function () {
    it("Should create a payment request with crypto deposit", async function () {
      const amountINR = 1000; // ₹1000
      const daiAmount = ethers.utils.parseUnits("100", 18); // 100 DAI
      const ethFee = ethers.utils.parseEther("0.1"); // 0.1 ETH (includes platform fee)

      // Approve DAI spending
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);

      await expect(
        paymentEscrow.connect(requester).createPaymentRequest(
          amountINR,
          daiAmount,
          { value: ethFee }
        )
      )
        .to.emit(paymentEscrow, "PaymentRequestCreated");

      const request = await paymentEscrow.getPaymentRequest(1);
      expect(request.requester).to.equal(requester.address);
      expect(request.amountINR).to.equal(amountINR);
      expect(request.daiAmount).to.equal(daiAmount);
      expect(request.status).to.equal(0); // PENDING
    });

    it("Should fail to create request with zero crypto deposit", async function () {
      const amountINR = 1000;
      const daiAmount = ethers.utils.parseUnits("100", 18);

      // Approve DAI spending
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);

      await expect(
        paymentEscrow.connect(requester).createPaymentRequest(
          amountINR,
          daiAmount,
          { value: 0 }
        )
      ).to.be.revertedWith("Must pay atleast equal to platform fee");
    });

    it("Should auto-increment request IDs", async function () {
      const amountINR = 1000;
      const daiAmount = ethers.utils.parseUnits("100", 18);
      const ethFee = ethers.utils.parseEther("0.1");

      // First request
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );

      // Second request
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );

      const request1 = await paymentEscrow.getPaymentRequest(1);
      const request2 = await paymentEscrow.getPaymentRequest(2);

      expect(request1.requestId).to.equal(1);
      expect(request2.requestId).to.equal(2);
      expect(await paymentEscrow.getNextRequestId()).to.equal(3);
    });
  });

  describe("Payment Fulfillment", function () {
    let requestId = 1;
    let amountINR;
    let daiAmount;
    let ethFee;

    beforeEach(async function () {
      amountINR = 1000;
      daiAmount = ethers.utils.parseUnits("100", 18);
      ethFee = ethers.utils.parseEther("0.1");

      // Create a payment request
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );
    });

    it("Should commit and fulfill payment", async function () {
      // Commit to payment
      await paymentEscrow.connect(payer).commitToPay(requestId);

      const payerDAIBalanceBefore = await mockDAI.balanceOf(payer.address);
      const payerETHBalanceBefore = await payer.getBalance();

      // Fulfill payment with transaction number
      const transactionNumber = "123456789012"; // 12-digit transaction number
      await expect(paymentEscrow.connect(payer).fulfillPayment(requestId, transactionNumber))
        .to.emit(paymentEscrow, "PaymentFulfilled");

      // Check that DAI was transferred to payer
      const payerDAIBalanceAfter = await mockDAI.balanceOf(payer.address);
      expect(payerDAIBalanceAfter.sub(payerDAIBalanceBefore)).to.equal(daiAmount);

      // Check request status
      const request = await paymentEscrow.getPaymentRequest(requestId);
      expect(request.status).to.equal(2); // FULFILLED
      expect(request.payer).to.equal(payer.address);
    });

    it("Should fail if requester tries to commit to own request", async function () {
      await expect(
        paymentEscrow.connect(requester).commitToPay(requestId)
      ).to.be.revertedWith("Cannot commit to own request");
    });

    it("Should fail to fulfill non-existent request", async function () {
      const transactionNumber = "123456789012";
      await expect(
        paymentEscrow.connect(payer).fulfillPayment(999, transactionNumber)
      ).to.be.revertedWith("Request does not exist");
    });

    it("Should fail with invalid transaction number length", async function () {
      await paymentEscrow.connect(payer).commitToPay(requestId);
      
      // Test short transaction number
      await expect(
        paymentEscrow.connect(payer).fulfillPayment(requestId, "12345")
      ).to.be.revertedWith("Transaction number must be exactly 12 digits");
      
      // Test long transaction number
      await expect(
        paymentEscrow.connect(payer).fulfillPayment(requestId, "1234567890123")
      ).to.be.revertedWith("Transaction number must be exactly 12 digits");
    });

    it("Should fail with non-numeric transaction number", async function () {
      await paymentEscrow.connect(payer).commitToPay(requestId);
      
      await expect(
        paymentEscrow.connect(payer).fulfillPayment(requestId, "12345678901a")
      ).to.be.revertedWith("Transaction number must contain only digits");
    });
  });

  describe("Payment Cancellation", function () {
    let requestId = 1;
    let amountINR;
    let daiAmount;
    let ethFee;

    beforeEach(async function () {
      amountINR = 1000;
      daiAmount = ethers.utils.parseUnits("100", 18);
      ethFee = ethers.utils.parseEther("0.1");

      // Create a payment request
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );
    });

    it("Should cancel request and refund crypto to requester", async function () {
      const requesterDAIBalanceBefore = await mockDAI.balanceOf(requester.address);

      await expect(paymentEscrow.connect(requester).cancelPaymentRequest(requestId))
        .to.emit(paymentEscrow, "PaymentCancelled");

      // Check that DAI was refunded to requester
      const requesterDAIBalanceAfter = await mockDAI.balanceOf(requester.address);
      expect(requesterDAIBalanceAfter.sub(requesterDAIBalanceBefore)).to.equal(daiAmount);

      // Check request status
      const request = await paymentEscrow.getPaymentRequest(requestId);
      expect(request.status).to.equal(3); // CANCELLED
    });

    it("Should fail if non-requester tries to cancel", async function () {
      await expect(
        paymentEscrow.connect(payer).cancelPaymentRequest(requestId)
      ).to.be.revertedWith("Only requester can cancel");
    });
  });

  describe("Request Queries", function () {
    it("Should get available requests correctly", async function () {
      const amountINR = 1000;
      const daiAmount = ethers.utils.parseUnits("100", 18);
      const ethFee = ethers.utils.parseEther("0.1");

      // Create multiple requests
      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount.mul(2));
      
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );
      
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );

      const availableRequests = await paymentEscrow.getAvailableRequests();
      expect(availableRequests.length).to.equal(2);
      expect(availableRequests[0].requestId).to.equal(1);
      expect(availableRequests[1].requestId).to.equal(2);
    });

    it("Should get user requests correctly", async function () {
      const amountINR = 1000;
      const daiAmount = ethers.utils.parseUnits("100", 18);
      const ethFee = ethers.utils.parseEther("0.1");

      await mockDAI.connect(requester).approve(paymentEscrow.address, daiAmount);
      await paymentEscrow.connect(requester).createPaymentRequest(
        amountINR,
        daiAmount,
        { value: ethFee }
      );

      const userRequests = await paymentEscrow.getUserRequests(requester.address);
      expect(userRequests.length).to.equal(1);
      expect(userRequests[0].requestId).to.equal(1);
    });
  });
});