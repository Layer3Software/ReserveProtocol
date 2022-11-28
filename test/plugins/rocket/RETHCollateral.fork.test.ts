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
const REF_PER_TOK = BigNumber.from('1034586816960530749') 
const STRICT_PRICE = BigNumber.from('1645313760880501655442')
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
  let rethMock: RETHMock

  // Factories
  let RETHCollateralFactory: ContractFactory
  let RETHMockFactory: ContractFactory

  // Assets
  let rethCollateral: RETHCollateral

  beforeEach(async () => {
    await forkToMainnet(FORK_BLOCK)
    ;[owner] = await ethers.getSigners()

    reth = IRETH__factory.connect(RETH, owner)
    weth = ERC20__factory.connect(WETH, owner)
    feed = AggregatorV3Interface__factory.connect(ETH_CHAINLINK_FEED, owner)

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

  describe('RETHMock testing', () => {
    let prevRefPerToken: BigNumber
    let refPerToken: BigNumber


    beforeEach(async () => {
      RETHMockFactory = await ethers.getContractFactory('RETHMock')
      rethMock = <RETHMock>(await RETHMockFactory.deploy(weth.address))

      expect(await rethCollateral.status()).to.be.equal(CollateralStatus.SOUND)
      expect(await rethCollateral.refPerTok()).to.be.above(fp('1'))
    })

    it('status DISABLED if refPerTok < prevRefPerTok', async () => {

      rethCollateral = <RETHCollateral>(
        await RETHCollateralFactory.deploy(
          fp('1'),
          ETH_CHAINLINK_FEED,
          rethMock.address,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault
        )
      )

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)


      await rethMock.setExchangeRate('2000000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await rethMock.setExchangeRate('1998000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await rethMock.setExchangeRate('1999000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await rethMock.setExchangeRate('2100000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.SOUND)

      await rethMock.setExchangeRate('1800000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

      // collateral should remain disabled even though refPerTok > prevRefPerTok
      await rethMock.setExchangeRate('2100000000000000000')
      
      await rethCollateral.refresh()

      refPerToken = await rethCollateral.refPerTok()
      prevRefPerToken = await rethCollateral.prevReferencePrice()
      console.log('refPerToken', refPerToken)
      console.log('prevRefPerToken', prevRefPerToken)

      expect(await rethCollateral.status()).to.be.eq(CollateralStatus.DISABLED)

    })   
    
  })


})