// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IMaplePool is IERC20Metadata {
    /// @dev The sum of all outstanding principal on Loans.
    function principalOut() external view returns (uint256);

    /// @dev Sum of all withdrawable interest.
    function interestSum() external view returns (uint256);

    /// @dev Sum of all unrecognized losses.
    function poolLosses() external view returns (uint256);

    /// @dev Withdraws all claimable interest from the LiquidityLocker for an account
    /// using `interestSum` accounting.
    function withdrawFunds() external;

    /// @dev returns the liquidityLocker address for this pool
    function liquidityLocker() external view returns (address);
}