// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for stETH
// See: https://github.com/lidofinance/lido-dao/blob/master/contracts/0.6.12/WstETH.sol
interface ISTETH {
    /**
     * @notice Get amount of stETH for a one wstETH
     * @return Amount of stETH for 1 wstETH
     */
    function stEthPerToken() external view returns (uint256);
}