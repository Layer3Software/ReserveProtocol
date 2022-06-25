// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/plugins/assets/OracleLib.sol";

// TODO this might be unneeded now? to-return-to
contract StakedAaveAsset is Asset {
    using OracleLib for AggregatorV3Interface;

    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) Asset(chainlinkFeed_, erc20_, maxTradeVolume_) {
        StakedAaveAsset_init();
    }

    // solhint-disable no-empty-blocks
    // solhint-disable-next-line func-name-mixedcase
    function StakedAaveAsset_init() public initializer {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return chainlinkFeed.price();
    }
}
