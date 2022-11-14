// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/maple/IMaplePool.sol";

/**
 * @title MaplePoolCollateral
 * @notice tok = PoolFDT, ref = USDC, tgt = USD, UoA = USD
 */
contract MaplePoolCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IERC20Metadata public constant USDC =
        IERC20Metadata(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // this is the reference erc20
    uint192 public constant peg = FIX_ONE; // ahhh benefits of working with a stablecoin as ref

    IMaplePool public immutable maplePool;
    address public immutable liquidityLocker;
    uint192 public immutable refPerTokThreshold;
    uint192 public immutable refDelta;

    /// @param erc20_ address of the tok
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @param refPerTokThreshold_ minimum refPerTok (above 1e18) (for example, 1.01 * 1e18) below which the pool will start looking IFFY
    /// @param refThreshold_ A value like 0.05 that represents a deviation tolerance for the ref(usdc) price
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint192 refPerTokThreshold_,
        uint192 refThreshold_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(refPerTokThreshold_ > 1e18, "refPerTokThreshold minimum 1e18");

        maplePool = IMaplePool(address(erc20_));
        liquidityLocker = maplePool.liquidityLocker();
        refPerTokThreshold = refPerTokThreshold_;
        refDelta = (peg * refThreshold_) / FIX_ONE;
    }

    /// update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        uint192 refPerTok = refPerTok();

        CollateralStatus refPriceStatus = CollateralStatus.SOUND;
        // checking for the defaulting of the ref as compared to the tgt
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (p < peg - refDelta || p > peg + refDelta) {
                refPriceStatus = CollateralStatus.IFFY;
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            refPriceStatus = CollateralStatus.IFFY;
        }

        // Checking for the defaulting of the maple pool (tok as compared to ref)
        if (refPerTok < 1e18) {
            markStatus(CollateralStatus.DISABLED);
        } else if (refPerTok < refPerTokThreshold) {
            markStatus(CollateralStatus.IFFY);
        } else {
            // if the refPriceStatus is IFFY already then we dont want the status to be SOUND
            // even if the refPerTok is functioning perfectly
            if (refPriceStatus != CollateralStatus.IFFY) {
                markStatus(CollateralStatus.SOUND);
            } else {
                markStatus(refPriceStatus);
            }
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 refBalance = USDC.balanceOf(liquidityLocker) + maplePool.principalOut();
        uint256 exchangeRate = (refBalance * 1e30) / maplePool.totalSupply();
        if (type(uint192).max < exchangeRate) revert UIntOutOfBounds();
        return uint192(exchangeRate);
    }

    function targetPerRef() public view override returns (uint192) {
        // target == UoA
        // so {tgt/Ref} = {UoA/Ref}
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }
}