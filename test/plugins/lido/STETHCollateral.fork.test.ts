import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { ORACLE_TIMEOUT } from '../../fixtures'

import { bn, fp } from '../../../common/numbers'
import {
  ISTETH,
  ISTETH__factory,
  ERC20,
  ERC20__factory,
  STETHCollateral,
  OracleLib,
  OracleLib__factory,
  AggregatorV3Interface,
  MockV3Aggregator,
  AggregatorV3Interface__factory,
  STETHMock,
} from '../../../typechain'

import { forkToMainnet, encodeSlot } from '../../integration/fork-helpers'

// Lido Mainnet Addresses
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0' 
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' 
const ETH_CHAINLINK_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // ETH-USD chainlink feed

const FORK_BLOCK = 15919210
// expected CONSTANTS at block 15919210
const REF_PER_TOK = BigNumber.from('1083242257583022253') 
const STRICT_PRICE = BigNumber.from('2739612715712744854874746')
const TARGET_PER_REF = BigNumber.from('1000000000000000000')

// from fixtures File
const rTokenMaxTradeVolume = fp('1e6') // $1M
const defaultThreshold = fp('0.05') // 5%
const refPerTokThreshold = fp('1.01')
const delayUntilDefault = bn('86400') // 24h

// deploy mock and update getExchangeRate

describe('WSTETH Collateral mainnet fork tests', () => {
  let owner: SignerWithAddress

  // Tokens
  let wsteth: ISTETH
  let weth: ERC20
  let feed: AggregatorV3Interface
  let wstethMock: STETHMock

  // Factories
  let STETHCollateralFactory: ContractFactory
  let STETHMockFactory: ContractFactory

  // Assets
  let wstethCollateral: STETHCollateral

  beforeEach(async () => {
    await forkToMainnet(FORK_BLOCK)
    ;[owner] = await ethers.getSigners()

    wsteth = ISTETH__factory.connect(WSTETH, owner)
    weth = ERC20__factory.connect(WETH, owner)
    feed = AggregatorV3Interface__factory.connect(ETH_CHAINLINK_FEED, owner)

    // Factories
    STETHCollateralFactory = await ethers.getContractFactory('STETHCollateral')

    // deploy collateral contract
    // ERROR ON DEPLOYMENT
    wstethCollateral = <STETHCollateral>(
      await STETHCollateralFactory.deploy(
        fp('1'),
        ETH_CHAINLINK_FEED,
        wsteth.address,
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
      getExchangeRate = await wsteth.stEthPerToken()
      price = (await feed.latestRoundData())[1]
      refPerToken = await wstethCollateral.refPerTok()

      // assert pool is sound and refPerTok is above 1 before testing
      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
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
        STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wsteth.address,
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
      expect(await wstethCollateral.strictPrice()).to.be.equal(STRICT_PRICE)
    })

    it('targetPerRef calculation correct', async () => {
      expect(await wstethCollateral.targetPerRef()).to.be.equal(TARGET_PER_REF)
    })

    it('refPerTok calculation correct', async () => {
      expect(await wstethCollateral.refPerTok()).to.be.equal(REF_PER_TOK)
    })
  })

  describe('WSTETHMock testing: case #0', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber

    beforeEach(async () => {
      STETHMockFactory = await ethers.getContractFactory('STETHMock')
      wstethMock = <STETHMock>(await STETHMockFactory.deploy(weth.address))

      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status SOUND if refPerTok >= prevRefPerTok', async () => {

      wstethCollateral = <STETHCollateral>(
        await STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wstethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await wstethCollateral.refPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await wstethMock.setExchangeRate('1000000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate stays the same')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await wstethMock.setExchangeRate('1100000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T2 - exchange rate goes up')
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
    })   
    
  })

  describe('WSTETHMock testing: case #1', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      STETHMockFactory = await ethers.getContractFactory('STETHMock')
      wstethMock = <STETHMock>(await STETHMockFactory.deploy(weth.address))

      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status SOUND if refPerTok < prevRefPerTok && actualRefPerTok >= prevRefPerTok', async () => {

      wstethCollateral = <STETHCollateral>(
        await STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wstethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await wstethMock.setExchangeRate('999000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down 0.1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await wstethMock.setExchangeRate('990000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
    })   
    
  })


  describe('WSTETHMock testing: case #2', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      STETHMockFactory = await ethers.getContractFactory('STETHMock')
      wstethMock = <STETHMock>(await STETHMockFactory.deploy(weth.address))

      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status DISABLED if refPerTok < prevRefPerTok && actualRefPerTok < prevRefPerTok', async () => {

        wstethCollateral = <STETHCollateral>(
        await STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wstethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await wstethMock.setExchangeRate('890000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - exchange rate goes down more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

  describe('WSTETHMock testing: case #3', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      STETHMockFactory = await ethers.getContractFactory('STETHMock')
      wstethMock = <STETHMock>(await STETHMockFactory.deploy(weth.address))

      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status stays DISABLED if DISABLED before', async () => {

      wstethCollateral = <STETHCollateral>(
        await STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wstethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await wstethMock.setExchangeRate('890000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

      await wstethMock.setExchangeRate('1000000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - back above prevReferencePrice')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

  describe('WSTETHMock testing: case #4', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber
    let actRefPerToken: BigNumber

    beforeEach(async () => {
      STETHMockFactory = await ethers.getContractFactory('STETHMock')
      wstethMock = <STETHMock>(await STETHMockFactory.deploy(weth.address))

      expect(await wstethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status becomes DISABLED after referencePrice has gone up overtime but drops 1% from there', async () => {

      wstethCollateral = <STETHCollateral>(
        await STETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          wstethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T0 - start')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      await wstethMock.setExchangeRate('1100000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await wstethMock.setExchangeRate('1200000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)
      
      await wstethMock.setExchangeRate('2000000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice goes up')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await wstethMock.setExchangeRate('1800000000000000000')
      await wstethCollateral.refresh()

      refPerToken = await wstethCollateral.refPerTok()
      actRefPerToken = await wstethCollateral.actualRefPerTok()
      prevRefPerToken = await wstethCollateral.prevReferencePrice()
      console.log('T1 - referencePrice down more than 1%')
      console.log('refPerToken', refPerToken)
      console.log('actRefPerToken', actRefPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await wstethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })
  })

})