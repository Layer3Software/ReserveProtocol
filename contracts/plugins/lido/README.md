# rETH Collateral Plugin - Layer3 Hackathon Submission



## Author

We would like to acknowledge that this was a collaborative effort by  the web3 research and development team at [Layer3 Software](https://www.layer3.software/) 

- Twitter: [Layer3 Software](https://twitter.com/Layer3Software)
- Linkedin: [Layer3](https://www.linkedin.com/company/layer-3/) 
- Email: [Contact Layer3](contact@layer3.software) 
- Org GitHub: [@Layer3 Software](https://github.com/Layer3-Software)

## Introduction

stETH is a ERC20 token that represents ether staked with Lido. Unlike staked ether, it is liquid and can be transferred, traded, or used in DeFi applications. Total supply of stETH reflects amount of ether deposited into protocol combined with staking rewards, minus potential validator penalties. stETH tokens are minted upon ether deposit at 1:1 ratio. When withdrawals from the Beacon chain will be introduced, it will also be possible to redeem ether by burning stETH at the same 1:1 ratio.

stETH is a rebasable ERC-20 token. Normally, the stETH token balances get recalculated daily when the Lido oracle reports Beacon chain ether balance update. The stETH balance update happens automatically on all the addresses holding stETH at the moment of rebase

There are two versions of Lido's stTokens, namely stETH and wstETH. Both tokens are ERC-20 tokens, but they reflect the accrued staking rewards in different ways. stETH implements rebasing mechanics which means the stETH balance increases periodically. In contrary, wstETH balance is constant, while the token increases in value eventually (denominated in stETH). At any moment, any amount of stETH can be converted to wstETH via trustless wrapper and vice versa, thus tokens effectively share liquidity. For instance, undercollateralized wstETH positions on Maker can be liquidated by unwrapping wstETH and swapping it for ether on Curve.

This receipt token (wstETH) is our {tok} for this particular plugin. 

## Units
| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | wstETH | ETH  | ETH | USD   |


This plugin assumes that stETH is equal to ETH, the target. So it does not insure the stETH peg with ETH. Once ETH2 withdrawals are live this should be the case. 

The wstETH value increases over time in proportion to the amount of value the pool has accrued from staking rewards. This is to say an initial deposit of 1 ETH converted to 1 wstETH will be worth 1.0448 ETH within an annualized period (based on the current APY of 4.48%). Over time, the wstETH exchange rate to stETH should consistently go up from staking reward, although it could potentially go down if there is a large slashing event for Lido node operators. Depositors can then redeem and exchange this wstETH for stETH at any point and in the future stETH will be able to be exchanged for ETH at any point.

The only situation that stETH / wstETH would decrease (disparity) is in the event that mass validator slashings occur. 


To ensure the status becomes DISABLED, in such a scenario, we have built in a revenue hiding mechanism that tracks the stability of the price. This involves the tracking of three different reference prices. Firstly we will define these reference prices. 

## refPRICE Definitions: 

**actRefPRICE** = The exchange rate between stETH/wstETH

**refPRICE** = The discounted rate (exchange rate of stETH/wstETH*.99) at the current time of the refresh call

**prevRefPRICE** = Discounted exchange rate at the last time refresh was called 

When using this mechanism to track price stability the refPRICE is always the basis for the tracking. The prevRefPRICE can only ever go up or remain neutral (that is unchanged from the prevRefPrice). The reason for this is, that the hidden revenue (1%) is built into the refPRICE allowing for a trigger point against the instability of value and the plugin's ability to service any loss of value. If the ability to service loss of value falls outside of its service zone (refPrice < prevRefPrice and actualRefPrice < prevRefPrice), the collateral will be DISABLED. Think of the prevRefPrice as a trailing stop-loss. 

Below we have designed flow charts of scenarios to demonstrate this mechanism working as intended. 

## Scenario instance


**Scenario #1: refPrice > prevRefPrice ** 


When this happens, the prevRefPrice moves up, so we are essentially moving up our “stop loss”.

![graph](https://i.imgur.com/BZlHdju.png)



