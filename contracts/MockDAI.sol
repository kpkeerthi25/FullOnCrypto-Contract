// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockDAI is ERC20 {
    constructor() ERC20("Mock DAI", "DAI") {
        // Mint 1 million DAI to the deployer for testing
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    // Allow anyone to mint DAI for testing purposes
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    // Faucet function - gives 1000 DAI to anyone who calls it
    function faucet() external {
        _mint(msg.sender, 1000 * 10**18);
    }
}