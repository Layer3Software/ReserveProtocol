// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/lido/ISTETH.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

// {tok}    = wstETH // collateral
// {ref}    = stETH // 1.1 stETH = wstETH ---> 1.3 stETH = wstETH
// {target} = ETH --> 1 stETH == 1 ETH
// {UoA}    = USD

/**
 * @title STETH Pegged Collateral. stETH-ETH peg not insured.
 * @notice Collateral plugin for wstETH collateral that requires default checks.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */

contract STETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// Should not use Collateral.chainlinkFeed, since naming is ambiguous

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            targetUnitUSDChainlinkFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(
            address(targetUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        defaultThreshold = defaultThreshold_;
        targetUnitChainlinkFeed = targetUnitUSDChainlinkFeed_;
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok} = {USD/wstETH}
        return
            targetUnitChainlinkFeed
            .price(oracleTimeout) // {USD/ETH}
            .mul(chainlinkFeed.price(oracleTimeout)).mul(refPerTok()); // {ETH/stETH} // {stETH/wstETH}
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();
        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            uint192 actualReferencePrice = actualRefPerTok();
            if (actualReferencePrice < prevReferencePrice) {
                markStatus(CollateralStatus.DISABLED);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } else {
            prevReferencePrice = referencePrice;
            markStatus(CollateralStatus.SOUND);
        }
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ISTETH(address(erc20)).stEthPerToken() * 99 / 100;
        return shiftl_toFix(rate, 18);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view returns (uint192) {
        uint256 rate = ISTETH(address(erc20)).stEthPerToken();
        return shiftl_toFix(rate, -18);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }
}