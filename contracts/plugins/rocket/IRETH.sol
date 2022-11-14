// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for rETH
// See: https://github.com/rocket-pool/rocketpool/blob/master/contracts/contract/token/RocketTokenRETH.sol
interface IRETH {
    // From RocketPool Docs:
    // Get the current ETH : rETH exchange rate
    // Returns the amount of ETH backing 1 rETH
    function getExchangeRate() external view returns (uint256);
}