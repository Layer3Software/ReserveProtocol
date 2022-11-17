import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { ORACLE_TIMEOUT } from '../../fixtures'

import { bn, fp } from '../../../common/numbers'
import {
  IRETH,
  IRETH__factory,
  ERC20,
  ERC20__factory,
  RETHCollateral,
  OracleLib,
  OracleLib__factory,
  AggregatorV3Interface,
  MockV3Aggregator,
  AggregatorV3Interface__factory,
  RETHMock,
} from '../../../typechain'

import { forkToMainnet, encodeSlot } from '../../integration/fork-helpers'

// Maple Pool Mainnet Addresses
const RETH = '0xae78736Cd615f374D3085123A210448E74Fc6393' // RETH
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // WETH
const ETH_CHAINLINK_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // ETH-USD chainlink feed

const FORK_BLOCK = 15919210
// expected CONSTANTS at block 15919210
const REF_PER_TOK = BigNumber.from('1045037188849020959') 
const STRICT_PRICE = BigNumber.from('1661933091798490000000')
const TARGET_PER_REF = BigNumber.from('1000000000000000000')

// from fixtures File
const rTokenMaxTradeVolume = fp('1e6') // $1M
const defaultThreshold = fp('0.05') // 5%
const refPerTokThreshold = fp('1.01')
const delayUntilDefault = bn('86400') // 24h

// deploy mock and update getExchangeRate

describe('RETH Collateral mainnet fork tests', () => {
  let owner: SignerWithAddress

  // Tokens
  let reth: IRETH
  let weth: ERC20
  let feed: AggregatorV3Interface

  // Factories
  let RETHCollateralFactory: ContractFactory

  // Assets
  let rethCollateral: RETHCollateral

  beforeEach(async () => {
    await forkToMainnet(FORK_BLOCK)
    ;[owner] = await ethers.getSigners()

    reth = IRETH__factory.connect(RETH, owner)
    weth = ERC20__factory.connect(WETH, owner)
    feed = AggregatorV3Interface__factory.connect(ETH_CHAINLINK_FEED, owner)

    // Deploy OracleLib external library
    const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
    const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()

    // Factories
    RETHCollateralFactory = await ethers.getContractFactory('RETHCollateral')

    // deploy collateral contract
    // ERROR ON DEPLOYMENT
    rethCollateral = <RETHCollateral>(
      await RETHCollateralFactory.deploy(
        fp('1'),
        ETH_CHAINLINK_FEED,
        reth.address,
        ZERO_ADDRESS,
        rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )
    )
  })

  describe('constants', () => {
    let getExchangeRate: BigNumber
    let price: BigNumber
    let refPerToken: BigNumber

    beforeEach(async () => {
      getExchangeRate = await reth.getExchangeRate()
      price = (await feed.latestRoundData())[1]
      refPerToken = await rethCollateral.refPerTok()

      // assert pool is sound and refPerTok is above 1 before testing
      expect(await rethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await rethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('Do the console logs here', async () => {
      console.log('getExchangeRate', getExchangeRate)
      console.log('refPerToken', refPerToken)
      console.log('price', price)
      
    })
  })

  describe('#constructor', () => {
    it('reverts if refPerTokThreshold is less than 1e18', async () => {
      await expect(
        RETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          reth.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn('0'),
          delayUntilDefault
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })
  })

  describe('Prices', () => {
    // ERROR: Units or block number likely off
    it('strictPrice calculation correct', async () => {
      expect(await rethCollateral.strictPrice()).to.be.equal(STRICT_PRICE)
    })

    it('targetPerRef calculation correct', async () => {
      expect(await rethCollateral.targetPerRef()).to.be.equal(TARGET_PER_REF)
    })

    it('refPerTok calculation correct', async () => {
      expect(await rethCollateral.refPerTok()).to.be.equal(REF_PER_TOK)
    })
  })

  // describe('#refresh', () => {

  //   let rethCollateral1: RETHCollateral
  //   let rethMock: RETHMock
  //   let getExchangeRate: BigNumber

  //   beforeEach(async () => {

  //     // Deploy RETH Mock 
  //     const RETHMockFactory: ContractFactory = await ethers.getContractFactory('RETHMock')

  //     rethMock = <RETHMock>(await RETHMockFactory.deploy(WETH))

  //     rethCollateral1 = <RETHCollateral>(
  //       await RETHCollateralFactory.deploy(
  //         fp('1'),
  //         ETH_CHAINLINK_FEED,
  //         rethMock.address,
  //         ZERO_ADDRESS,
  //         rTokenMaxTradeVolume,
  //         ORACLE_TIMEOUT,
  //         ethers.utils.formatBytes32String('USD'),
  //         defaultThreshold,
  //         delayUntilDefault
  //       )
  //     )

  //     getExchangeRate = await rethMock.getExchangeRate()

  //     // assert pool is sound and refPerTok is above 1 before testing
  //     // expect(await rethCollateral1.status()).to.be.equal(CollateralStatus.SOUND)
  //     // expect(await rethCollateral1.refPerTok()).to.be.equal(fp('1'))
  //   })

  //   it('status DISABLE if refPerTok is below prevRefPerTok', async () => {

  //     // await rethCollateral1.refresh()

  //     // await rethMock.setExchangeRate(1000000000000000000)

  //     // refPerTok must be below ratio of 1
  //     const refPerTok = await rethCollateral1.refPerTok()
  //     console.log('refPerTok', refPerTok)
  //     // expect(refPerTok).to.be.above(fp('1'))

  //     // await rethCollateral1.refresh()

  //     // expect(await rethCollateral1.status()).to.be.eq(CollateralStatus.DISABLED)
  //   })

    // it('status DISABLED if pool losses are greater than the pool profits', async () => {
    //   /**
    //    * the refPerTok ratio will be less than 1.0 if the pool concurs a loss
    //    * greater than the profits it has earned till now
    //    * in such a case we want the collateral status to be disabled
    //    */
    //   // simulate maple pool loss
    //   const simulatedLoss = interestSum.add('1')
    //   expect(prevPrincipalOut).to.be.above(simulatedLoss)

    //   await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
    //   await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

    //   // refPerTok must be below ratio of 1
    //   expect(await mapleCollateral.refPerTok()).to.be.below(fp('1'))

    //   await mapleCollateral.refresh()

    //   expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.DISABLED)
    // })

  //   it('status IFFY if refPerTok is below refPerTok threshold', async () => {
  //     // refPerTok Threshold is the minimum refPerTok (above 1e18) below which
  //     // the maple pool will start looking IFFY
  //     // this is the case specially when the pool suffers a loss but the losses
  //     // are not enough to take the refPerTok below 1e18 but are enough to make us
  //     // feel a little scared of our investments
  //     const simulatedLoss = interestSum.sub('10000000000')

  //     await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
  //     await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

  //     // refPerTok must be below ratio of 1
  //     const refPerTok = await mapleCollateral.refPerTok()
  //     expect(refPerTok).to.be.above(fp('1'))
  //     expect(refPerTok).to.be.below(refPerTokThreshold)

  //     await mapleCollateral.refresh()

  //     expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.IFFY)
  //   })

  //   it('status SOUND if refPerTok goes back above threshold after an IFFY state', async () => {
  //     const simulatedLoss = interestSum.sub('10000000000')

  //     await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
  //     await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

  //     expect(await mapleCollateral.refPerTok()).to.be.below(refPerTokThreshold)

  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.IFFY)

  //     prevPrincipalOut = await pool.principalOut()
  //     // simulate equal profits to the pool
  //     // though interestSum is not taken into account in our refPerTok calculation, I still simulated it here
  //     // to stay true to the maple pool accounting logic
  //     await updateSlot(interestSumSlot, interestSum.add(simulatedLoss))
  //     await updateSlot(principalOutSlot, prevPrincipalOut.add(simulatedLoss))

  //     expect(await mapleCollateral.refPerTok()).to.be.above(refPerTokThreshold)
  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.SOUND)
  //   })

  //   it('status IFFY if usdc(ref) peg falls below or above threshold', async () => {
  //     // since its pretty difficult to manipulate oracle prices in an oracle contract
  //     // on a forked environment so I deploy the mapleCollateral again with a
  //     // mock oracle just for this test

  //     // Deploy mock usdc chainlink feed
  //     const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
  //       'MockV3Aggregator'
  //     )
  //     const mockUsdcFeed: MockV3Aggregator = <MockV3Aggregator>(
  //       await MockV3AggregatorFactory.deploy(6, bn('1e6'))
  //     )

  //     mapleCollateral = <MaplePoolCollateral>(
  //       await MaplePoolCollateralFactory.deploy(
  //         fp('1'),
  //         mockUsdcFeed.address,
  //         pool.address,
  //         ZERO_ADDRESS,
  //         rTokenMaxTradeVolume,
  //         ORACLE_TIMEOUT,
  //         ethers.utils.formatBytes32String('USD'),
  //         delayUntilDefault,
  //         refPerTokThreshold,
  //         defaultThreshold
  //       )
  //     )

  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)

  //     // update usdc price to decrease by 6%
  //     await mockUsdcFeed.updateAnswer(bn('94e4'))
  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.IFFY)

  //     // update usdc price back to peg
  //     await mockUsdcFeed.updateAnswer(bn('1e6'))
  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)

  //     // update usdc price to increase by 6%
  //     await mockUsdcFeed.updateAnswer(bn('16e5'))
  //     await mapleCollateral.refresh()
  //     expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.IFFY)

  //     // also test it emits DefaultStatusChanged Event
  //     await mockUsdcFeed.updateAnswer(bn('1e6'))
  //     await expect(mapleCollateral.refresh())
  //       .to.emit(mapleCollateral, 'DefaultStatusChanged')
  //       .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
  //   })
  })

  const updateSlot = async (slot: string, val: BigNumber | number) => {
    await ethers.provider.send('hardhat_setStorageAt', [
      reth.address,
      slot,
      encodeSlot(['uint256'], [val]),
    ])
  }
})