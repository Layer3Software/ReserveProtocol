import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { ORACLE_TIMEOUT } from '../../fixtures'

import { bn, fp } from '../../../common/numbers'
import {
  IMaplePool,
  IMaplePool__factory,
  ERC20,
  ERC20__factory,
  MaplePoolCollateral,
  OracleLib,
  MockV3Aggregator,
} from '../../../typechain'

import { forkToMainnet, encodeSlot } from '../../integration/fork-helpers'

// Maple Pool Mainnet Addresses
const POOL = '0x6F6c8013f639979C84b756C7FC1500eB5aF18Dc4'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_CHAINLINK_FEED = '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6'

const FORK_BLOCK = 15919210
// expected CONSTANTS at block 15919210
const REF_PER_TOK = BigNumber.from('1013213518328275053')
const STRICT_PRICE = BigNumber.from('1013295396112691161')
const TARGET_PER_REF = BigNumber.from('1000080810000000000')

// from fixtures File
const rTokenMaxTradeVolume = fp('1e6') // $1M
const defaultThreshold = fp('0.05') // 5%
const refPerTokThreshold = fp('1.01')
const delayUntilDefault = bn('86400') // 24h

// slot addresses for changing storage varialbes in maple pool contract
const principalOutSlot = '0x11'
const interestSumSlot = '0xc'
const poolLossesSlot = '0xd'

describe('Maple Collateral mainnet fork tests', () => {
  let owner: SignerWithAddress

  // Tokens
  let pool: IMaplePool
  let usdc: ERC20

  // Factories
  let MaplePoolCollateralFactory: ContractFactory

  // Assets
  let mapleCollateral: MaplePoolCollateral

  beforeEach(async () => {
    await forkToMainnet(FORK_BLOCK)
    ;[owner] = await ethers.getSigners()

    pool = IMaplePool__factory.connect(POOL, owner)
    usdc = ERC20__factory.connect(USDC, owner)

    // Deploy OracleLib external library
    const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
    const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()

    // Factories
    MaplePoolCollateralFactory = await ethers.getContractFactory('MaplePoolCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    // deploy collateral contract
    mapleCollateral = <MaplePoolCollateral>(
      await MaplePoolCollateralFactory.deploy(
        fp('1'),
        USDC_CHAINLINK_FEED,
        pool.address,
        ZERO_ADDRESS,
        rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        refPerTokThreshold,
        defaultThreshold
      )
    )
  })

  describe('#constructor', () => {
    it('reverts if refPerTokThreshold is less than 1e18', async () => {
      await expect(
        MaplePoolCollateralFactory.deploy(
          fp('1'),
          USDC_CHAINLINK_FEED,
          pool.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          bn('9e17'),
          defaultThreshold
        )
      ).to.be.revertedWith('refPerTokThreshold minimum 1e18')
    })
  })

  describe('Prices', () => {
    it('strictPrice calculation correct', async () => {
      expect(await mapleCollateral.strictPrice()).to.be.equal(STRICT_PRICE)
    })

    it('targetPerRef calculation correct', async () => {
      expect(await mapleCollateral.targetPerRef()).to.be.equal(TARGET_PER_REF)
    })

    it('refPerTok calculation correct', async () => {
      expect(await mapleCollateral.refPerTok()).to.be.equal(REF_PER_TOK)
    })
  })

  describe('constants', () => {
    let prevPrincipalOut: BigNumber
    let interestSum: BigNumber
    let prevPoolLoss: BigNumber

    beforeEach(async () => {
      prevPrincipalOut = await pool.principalOut()
      interestSum = await pool.interestSum()
      prevPoolLoss = await pool.poolLosses()
      // assert pool is sound and refPerTok is above 1 before testing
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await mapleCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('Do the console logs here', async () => {
      console.log('prevPrincipalOut', prevPrincipalOut)
      console.log('interestSum', interestSum)
      console.log('prevPoolLoss', prevPoolLoss)
    })
   
  })

  describe('#refresh', () => {
    let prevPrincipalOut: BigNumber
    let interestSum: BigNumber
    let prevPoolLoss: BigNumber

    beforeEach(async () => {
      prevPrincipalOut = await pool.principalOut()
      interestSum = await pool.interestSum()
      prevPoolLoss = await pool.poolLosses()
      // assert pool is sound and refPerTok is above 1 before testing
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await mapleCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status DISABLED if pool losses are greater than the pool profits', async () => {
      /**
       * the refPerTok ratio will be less than 1.0 if the pool concurs a loss
       * greater than the profits it has earned till now
       * in such a case we want the collateral status to be disabled
       */
      // simulate maple pool loss
      const simulatedLoss = interestSum.add('1')
      expect(prevPrincipalOut).to.be.above(simulatedLoss)

      await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
      await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

      // refPerTok must be below ratio of 1
      expect(await mapleCollateral.refPerTok()).to.be.below(fp('1'))

      await mapleCollateral.refresh()

      expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.DISABLED)
    })

    it('status IFFY if refPerTok is below refPerTok threshold', async () => {
      // refPerTok Threshold is the minimum refPerTok (above 1e18) below which
      // the maple pool will start looking IFFY
      // this is the case specially when the pool suffers a loss but the losses
      // are not enough to take the refPerTok below 1e18 but are enough to make us
      // feel a little scared of our investments
      const simulatedLoss = interestSum.sub('10000000000')

      await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
      await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

      // refPerTok must be below ratio of 1
      const refPerTok = await mapleCollateral.refPerTok()
      expect(refPerTok).to.be.above(fp('1'))
      expect(refPerTok).to.be.below(refPerTokThreshold)

      await mapleCollateral.refresh()

      expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.IFFY)
    })

    it('status SOUND if refPerTok goes back above threshold after an IFFY state', async () => {
      const simulatedLoss = interestSum.sub('10000000000')

      await updateSlot(poolLossesSlot, prevPoolLoss.add(simulatedLoss))
      await updateSlot(principalOutSlot, prevPrincipalOut.sub(simulatedLoss))

      expect(await mapleCollateral.refPerTok()).to.be.below(refPerTokThreshold)

      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.IFFY)

      prevPrincipalOut = await pool.principalOut()
      // simulate equal profits to the pool
      // though interestSum is not taken into account in our refPerTok calculation, I still simulated it here
      // to stay true to the maple pool accounting logic
      await updateSlot(interestSumSlot, interestSum.add(simulatedLoss))
      await updateSlot(principalOutSlot, prevPrincipalOut.add(simulatedLoss))

      expect(await mapleCollateral.refPerTok()).to.be.above(refPerTokThreshold)
      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.eq(CollateralStatus.SOUND)
    })

    it('status IFFY if usdc(ref) peg falls below or above threshold', async () => {
      // since its pretty difficult to manipulate oracle prices in an oracle contract
      // on a forked environment so I deploy the mapleCollateral again with a
      // mock oracle just for this test

      // Deploy mock usdc chainlink feed
      const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
        'MockV3Aggregator'
      )
      const mockUsdcFeed: MockV3Aggregator = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(6, bn('1e6'))
      )

      mapleCollateral = <MaplePoolCollateral>(
        await MaplePoolCollateralFactory.deploy(
          fp('1'),
          mockUsdcFeed.address,
          pool.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          refPerTokThreshold,
          defaultThreshold
        )
      )

      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)

      // update usdc price to decrease by 6%
      await mockUsdcFeed.updateAnswer(bn('94e4'))
      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.IFFY)

      // update usdc price back to peg
      await mockUsdcFeed.updateAnswer(bn('1e6'))
      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.SOUND)

      // update usdc price to increase by 6%
      await mockUsdcFeed.updateAnswer(bn('16e5'))
      await mapleCollateral.refresh()
      expect(await mapleCollateral.status()).to.be.equal(CollateralStatus.IFFY)

      // also test it emits DefaultStatusChanged Event
      await mockUsdcFeed.updateAnswer(bn('1e6'))
      await expect(mapleCollateral.refresh())
        .to.emit(mapleCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
    })
  })

  const updateSlot = async (slot: string, val: BigNumber | number) => {
    await ethers.provider.send('hardhat_setStorageAt', [
      pool.address,
      slot,
      encodeSlot(['uint256'], [val]),
    ])
  }
})