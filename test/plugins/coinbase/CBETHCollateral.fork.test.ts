import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { ORACLE_TIMEOUT } from '../../fixtures'

import { bn, fp } from '../../../common/numbers'
import {
  ICBETH,
  ICBETH__factory,
  ERC20,
  ERC20__factory,
  CBETHCollateral,
  OracleLib,
  OracleLib__factory,
  AggregatorV3Interface,
  MockV3Aggregator,
  AggregatorV3Interface__factory,
  CBETHMock,
} from '../../../typechain'

import { forkToMainnet, encodeSlot } from '../../integration/fork-helpers'

// Rocket Pool Mainnet Addresses
const CBETH = '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ETH_CHAINLINK_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // ETH-USD chainlink feed

const FORK_BLOCK = 15919210
// expected CONSTANTS at block 15919210
const REF_PER_TOK = BigNumber.from('1003837480196486129') 
const STRICT_PRICE = BigNumber.from('1596412783131273855810')
const TARGET_PER_REF = BigNumber.from('1000000000000000000')

// from fixtures File
const rTokenMaxTradeVolume = fp('1e6') // $1M
const defaultThreshold = fp('0.05') // 5%
const refPerTokThreshold = fp('1.01')
const delayUntilDefault = bn('86400') // 24h

// deploy mock and update getExchangeRate

describe('CBETH Collateral mainnet fork tests', () => {
  let owner: SignerWithAddress

  // Tokens
  let cbeth: ICBETH
  let weth: ERC20
  let feed: AggregatorV3Interface
  let cbethMock: CBETHMock

  // Factories
  let CBETHCollateralFactory: ContractFactory
  let CBETHMockFactory: ContractFactory

  // Assets
  let cbethCollateral: CBETHCollateral

  beforeEach(async () => {
    await forkToMainnet(FORK_BLOCK)
    ;[owner] = await ethers.getSigners()

    cbeth = ICBETH__factory.connect(CBETH, owner)
    weth = ERC20__factory.connect(WETH, owner)
    feed = AggregatorV3Interface__factory.connect(ETH_CHAINLINK_FEED, owner)

    // Factories
    CBETHCollateralFactory = await ethers.getContractFactory('CBETHCollateral')

    // deploy collateral contract
    // ERROR ON DEPLOYMENT
    cbethCollateral = <CBETHCollateral>(
      await CBETHCollateralFactory.deploy(
        fp('1'),
        ETH_CHAINLINK_FEED,
        cbeth.address,
        ZERO_ADDRESS,
        rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
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
      getExchangeRate = await cbeth.exchangeRate()
      price = (await feed.latestRoundData())[1]
      refPerToken = await cbethCollateral.refPerTok()

      // assert pool is sound and refPerTok is above 1 before testing
      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
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
        CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbeth.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          bn('0'),
          delayUntilDefault
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })
  })

  describe('Prices', () => {
    // ERROR: Units or block number likely off
    it('strictPrice calculation correct', async () => {
      expect(await cbethCollateral.strictPrice()).to.be.equal(STRICT_PRICE)
    })

    it('targetPerRef calculation correct', async () => {
      expect(await cbethCollateral.targetPerRef()).to.be.equal(TARGET_PER_REF)
    })

    it('refPerTok calculation correct', async () => {
      expect(await cbethCollateral.refPerTok()).to.be.equal(REF_PER_TOK)
    })
  })

  describe('CBETHMock testing: case #0', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber


    beforeEach(async () => {
      CBETHMockFactory = await ethers.getContractFactory('CBETHMock')
      cbethMock = <CBETHMock>(await CBETHMockFactory.deploy(weth.address))

      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status SOUND if refPerTok >= prevRefPerTok', async () => {

      cbethCollateral = <CBETHCollateral>(
        await CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await cbethCollateral.refPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await cbethMock.setExchangeRate('1000000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate stays the same')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await cbethMock.setExchangeRate('1100000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T2 - exchange rate goes up')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
    })   
    
  })

  describe('CBETHMock testing: case #1', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      CBETHMockFactory = await ethers.getContractFactory('CBETHMock')
      cbethMock = <CBETHMock>(await CBETHMockFactory.deploy(weth.address))

      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status SOUND if refPerTok < prevRefPerTok && actualRefPerTok >= prevRefPerTok', async () => {

      cbethCollateral = <CBETHCollateral>(
        await CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await cbethMock.setExchangeRate('999000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down 0.1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await cbethMock.setExchangeRate('990000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
    })   
    
  })

  describe('CBETHMock testing: case #2', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      CBETHMockFactory = await ethers.getContractFactory('CBETHMock')
      cbethMock = <CBETHMock>(await CBETHMockFactory.deploy(weth.address))

      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status DISABLED if refPerTok < prevRefPerTok && actualRefPerTok < prevRefPerTok', async () => {

      cbethCollateral = <CBETHCollateral>(
        await CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await cbethMock.setExchangeRate('890000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

  describe('CBETHMock testing: case #3', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      CBETHMockFactory = await ethers.getContractFactory('CBETHMock')
      cbethMock = <CBETHMock>(await CBETHMockFactory.deploy(weth.address))

      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status stays DISABLED if DISABLED before', async () => {

      cbethCollateral = <CBETHCollateral>(
        await CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await cbethMock.setExchangeRate('890000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

      await cbethMock.setExchangeRate('1000000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - back above prevReferencePrice')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

  describe('CBETHMock testing: case #4', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      CBETHMockFactory = await ethers.getContractFactory('CBETHMock')
      cbethMock = <CBETHMock>(await CBETHMockFactory.deploy(weth.address))

      expect(await cbethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status becomes DISABLED after referencePrice has gone up overtime but drops 1% from there', async () => {

      cbethCollateral = <CBETHCollateral>(
        await CBETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          cbethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await cbethMock.setExchangeRate('1100000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await cbethMock.setExchangeRate('1200000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
      await cbethMock.setExchangeRate('2000000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await cbethMock.setExchangeRate('1800000000000000000')
      await cbethCollateral.refresh()

      refPerToken = await cbethCollateral.refPerTok()
      actRefPerToken = await cbethCollateral.actualRefPerTok()
      prevRefPerToken = await cbethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice down more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await cbethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

})