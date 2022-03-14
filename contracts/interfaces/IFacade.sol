// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IRToken.sol";

/**
 * @title IFacade
 * @notice A read-only layer on top of the protocol for use from an off-chain explorer.
 */
interface IFacade {
    function runAuctionsForAllTraders() external;

    function claimRewards() external;

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external returns (uint256);

    function currentAssets() external returns (address[] memory tokens, uint256[] memory amounts);

    function stRSRExchangeRate() external returns (Fix);

    function totalAssetValue() external returns (Fix total);
}