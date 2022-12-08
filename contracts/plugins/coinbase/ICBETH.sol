// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for cbETH
// See: https://www.coinbase.com/cbeth/whitepaper
interface ICBETH {
    /**
     * @notice Get amount of ETH for a one cbETH
     * @return Amount of ETH for 1 cbETH
     */
    function exchangeRate() external view returns (uint256);
}