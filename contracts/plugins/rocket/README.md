
# rETH Collateral Plugin - Layer3 Hackathon Submission



## Author

We would like to acknowledge that this was a collaborative effort by  the web3 research and development team at [Layer3 Software](https://www.layer3.software/) 

- Twitter: [Layer3 Software](https://twitter.com/Layer3Software)
- Linkedin: [Layer3](https://www.linkedin.com/company/layer-3/) 
- Email: [Contact Layer3](contact@layer3.software) 
- Org GitHub: [@Layer3 Software](https://github.com/Layer3-Software)

## Introduction 


Rocket Pool’s staked ETH (rETH) as collateral.
RocketPool Documents
RocketPool Technical Docs

Rocket Pool is an Ethereum 2.0 staking pool. The protocol aims to reduce the barrier of entry for retail to support ETH staking by lowering both the capital outlay and hardware requirements for supporting the ETH network. In short, Rocket Pool achieves this by allowing users to stake trustlessly towards a network of node operators.

Users of Rocket Pool can deposit as little as 0.1 ETH and receive the rETH liquid staking token in return. rETH accrues staking rewards over time.

This receipt token (rETH) is our Tok for this particular plugin. 
## Units
| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | rETH | ETH  | ETH | USD   |

## Implementation
The rETH value increases over time in proportion to the amount of value the pool has accrued from staking rewards. This is to say an initial deposit of 1 ETH converted to 1 rETH will be worth 1.0448 ETH within an annualized period (based on the current APY of 4.48%). Over time, the rETH exchange rate to ETH should consistently go up from staking rewards. Depositors can then redeem and exchange this rETH for ETH at any point in the process (once ETH2 withdrawals are live).
## Deflating conditions 

**Backdrop**

The only situation that ETH / rETH would decrease (disparity) is in the event that mass validator slashings occur. This is mostly covered with several protection mechanisms built into the Rocket Pool system. 

The first backstop is the use of validator bonds as collateral to cover any losses; this protects rETH holders/ stakers (reference documentation below). 

![Graph](https://i.imgur.com/CponwyQ.png)





The second backstop is that validator collateral (RPL) is used as collateral to cover any further losses should validator bonds not offer enough solvency to cover losses (referral documentation below).

![graph](https://i.imgur.com/y4y3ATv.png)

If the validator bond and RPL deposit cannot secure losses, the loss is recognized and shared socially among the RocketPool community. It is in this exceptional circumstance that the value would decrease, resulting in the ETH/rETH ratio being upset. 


To ensure the status becomes DISABLED, in such a scenario, we use revenue hiding, which is a mechanism that tracks the stability of the price. This involves the tracking of three different reference prices. Firstly we will define these reference prices. 


## refPRICE Definitions: 

**actRefPRICE** = The exchange rate between ETH/rETH

**refPRICE** = The discounted rate (exchange rate of ETH/rETH*.99) at the current time of the refresh call

**prevRefPRICE** = Discounted exchange rate at the last time refresh was called 

When using this mechanism to track price stability the refPRICE is always the basis for the tracking. The prevRefPRICE can only ever go up or remain neutral (that is unchanged from the prevRefPrice). The reason for this is, that the hidden revenue (1%) is built into the refPRICE allowing for a trigger point against the instability of value and the plugin's ability to service any loss of value. If the ability to service loss of value falls outside of its service zone (refPrice < prevRefPrice and actualRefPrice < prevRefPrice), the collateral will be DISABLED. Think of the prevRefPrice as a trailing stop-loss. 

Below we have designed flow charts of scenarios to demonstrate this mechanism working as intended. 


## Scenario instance

**#Scenario #1: refPrice > prevRefPrice** 

When this happens, the prevRefPrice moves up, so we are essentially moving up our “stop loss”.

![graph](https://i.imgur.com/ljyXpYI.png)




**Scenario #2: refPrice < prevRefPrice but actualRefPrice > prevRefPrice** 

When this happens, it means the exchange rate has dropped, but it has not dropped more than 1%, so the collateral is SOUND but it is getting close to its default threshold. In this case, prevRefPrice does not get updated but stays the same. As mentioned previously, When prevRefPrice gets updated, it can only stay the same or go up, never can go down.

![graph](https://i.imgur.com/48nmwrz.png)



**Scenario #3: refPrice < prevRefPrice and actualRefPrice < prevRefPrice**

When this happens, the exchange rate has dropped more than 1%, and something is off with the protocol functionality. This is where collateral will become DISABLED and can never become SOUND again.

![graph](https://i.imgur.com/fnBJ6gg.png)


## The rationale for threshold

We chose 1% as the basis of exchange rate deviation based on RocketPools historical dune analytics. While having a higher threshold allows for a bigger “buffer” before this particular rTOKEN is marked as DISABLED and becomes defunct, it also assumes a higher amount of risk exposure to a greater volume of bad debt, should a black swan event ever occur. Based on the [RocketPool data](https://dune.com/domothy/RocketPool) available to us, the largest downward deviation in ETH/rETH exchange rate occurred on the 25th of October, with a 0.08% deviation occurring. This provides a significant cover of the 1% basis we have elected for. Given that the risk of bad debt is heightened by increasing the variation basis, we see widening the basis as delivering more risk than reward, given the above data. Evidence of this data can be found below: 

![image](https://i.imgur.com/PPxlgsE.png)


## Deployment 

An example deployment can be found in the testfile: [RETHCollateral.fork.test.ts](ReserveProtocol/test/plugins/rocket/RETHCollateral.fork.test.ts)

Constructor Arguments

```bash
uint192 fallbackPrice_ 
fp('1')

AggregatorV3Interface targetUnitUSDChainlinkFeed_
Chainlink price feed for ETH price in terms of USD (USD/ETH)
https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd

IERC20Metadata erc20_
rETH contract address

IERC20Metadata rewardERC20_
0x0000000000000000000000000000000000000000 since there are no claimable rewards

uint192 maxTradeVolume_
The max trade volume, in UoA (USD)

uint48 oracleTimeout_
The number of seconds until a oracle value becomes invalid 
ORACLE_TIMEOUT from import { ORACLE_TIMEOUT } from '../../fixtures'

bytes32 targetName_
Name of the target unit: “ETH”

uint192 defaultThreshold_
A value like 0.05 that represents a deviation tolerance. In this plugin we will use 0 because we assume that staked ETH will not deviate from ETH
bn('0')

uint256 delayUntilDefault_
bn('86400')

The pricefeed should be in {UoA} / {target} which is: USD/ETH
```

## Testing
`package.json` must have:
`test:rocket` hardhat test [RETHCollateral.fork.test.ts](test/plugins/rocket/RETHCollateral.fork.test.ts)

Then input in the console:
`yarn test:rocket`

## Ref Docs
[RocketPool Documents](https://docs.rocketpool.net/guides/)

[RocketPool Technical Docs](https://github.com/rocket-pool/docs.rocketpool.net)
