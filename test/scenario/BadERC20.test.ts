import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  BadERC20,
  ComptrollerMock,
  ERC20Mock,
  IBasketHandler,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIFurnace,
  TestIStRSR,
  TestIRToken,
} from '../../typechain'
import { getTrade } from '../utils/trades'
import { advanceTime } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IMPLEMENTATION } from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

describe(`Bad ERC20 - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let compoundMock: ComptrollerMock
  let aaveMock: AaveLendingPoolMock
  let aaveOracleInternal: AaveOracleMock

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: BadERC20
  let backupToken: ERC20Mock
  let collateral0: Collateral
  let backupCollateral: Collateral

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      rsr,
      stRSR,
      compoundMock,
      aaveMock,
      aaveOracleInternal,
      erc20s,
      collateral,
      config,
      rToken,
      furnace,
      assetRegistry,
      backingManager,
      basketHandler,
    } = await loadFixture(defaultFixture))

    // Main ERC20
    token0 = await (await ethers.getContractFactory('BadERC20')).deploy('Bad ERC20', 'BERC20')
    collateral0 = await (
      await ethers.getContractFactory('AavePricedFiatCollateral')
    ).deploy(
      token0.address,
      config.maxTradeVolume,
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      compoundMock.address,
      aaveMock.address
    )

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await aaveOracleInternal.setPrice(token0.address, bn('2.5e14'))
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address], [fp('1')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.refreshBasket()
    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  it('should act honestly without modification', async () => {
    const issueAmt = initialBal.div(100)
    await token0.connect(addr1).approve(rToken.address, issueAmt)
    await rToken.connect(addr1).issue(issueAmt)
    await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt)
    await token0.connect(addr2).approve(rToken.address, issueAmt)
    await rToken.connect(addr2).issue(issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt.mul(2))
    expect(await rToken.decimals()).to.equal(18)
  })

  describe('with reverting decimals', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      await token0.setRevertDecimals(true)
    })

    it('should revert during atomic issuance', async () => {
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during slow issuance', async () => {
      issueAmt = initialBal.div(10)
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during redemption', async () => {
      await expect(rToken.connect(addr1).redeem(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr1).redeem(issueAmt)
    })

    it('should revert during trading', async () => {
      await aaveOracleInternal.setPrice(token0.address, bn('1e10')) // default
      await assetRegistry.refresh()
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs([backupToken.address], [fp('1')], false)
      await expect(backingManager.manageTokens([])).to.be.revertedWith('No Decimals')
    })

    it('should keep collateral working', async () => {
      await collateral0.refresh()
      await collateral0.price()
      await collateral0.targetPerRef()
      await collateral0.pricePerTarget()
      expect(await collateral0.status()).to.equal(0)
    })

    it('should still transfer', async () => {
      await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    })

    it('should still approve / transferFrom', async () => {
      await rToken.connect(addr1).approve(addr2.address, issueAmt)
      await rToken.connect(addr2).transferFrom(addr1.address, addr2.address, issueAmt)
    })

    it('should still be able to claim rewards', async () => {
      await rToken.connect(addr1).claimAndSweepRewards()
    })

    it('should still have price', async () => {
      await rToken.connect(addr1).price()
    })

    it('should still melt', async () => {
      await rToken.connect(addr1).transfer(furnace.address, issueAmt)
      await furnace.melt()
    })

    it('should be able to unregister and use RSR to recapitalize', async () => {
      await assetRegistry.connect(owner).unregister(collateral0.address)
      expect(await assetRegistry.isRegistered(collateral0.address)).to.equal(false)
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs([backupToken.address], [fp('1')], false)
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      // Should be trading RSR for backup token
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.status()).to.equal(1) // OPEN state
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(backupToken.address)
    })
  })

  describe('with censorship', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      await token0.setCensored(backingManager.address, true)
      await token0.setCensored(rToken.address, true)
    })

    it('should revert during atomic issuance', async () => {
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during slow issuance', async () => {
      issueAmt = initialBal.div(10) // over 1 block
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(rToken.address, false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during redemption', async () => {
      await expect(rToken.connect(addr1).redeem(issueAmt)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await rToken.connect(addr1).redeem(issueAmt)
    })

    it('should revert during trading', async () => {
      await aaveOracleInternal.setPrice(token0.address, bn('1e10')) // default
      await collateral0.refresh()
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs([backupToken.address], [fp('1')], false)
      await expect(backingManager.manageTokens([])).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await backingManager.manageTokens([])
    })

    it('should keep collateral working', async () => {
      await collateral0.refresh()
      await collateral0.price()
      await collateral0.targetPerRef()
      await collateral0.pricePerTarget()
      expect(await collateral0.status()).to.equal(0)
    })

    it('should still transfer', async () => {
      await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    })

    it('should still approve / transferFrom', async () => {
      await rToken.connect(addr1).approve(addr2.address, issueAmt)
      await rToken.connect(addr2).transferFrom(addr1.address, addr2.address, issueAmt)
    })

    it('should still be able to claim rewards', async () => {
      await rToken.connect(addr1).claimAndSweepRewards()
    })

    it('should still have price', async () => {
      await rToken.connect(addr1).price()
    })

    it('should still melt', async () => {
      await rToken.connect(addr1).transfer(furnace.address, issueAmt)
      await furnace.melt()
    })

    it('should be able to unregister and use RSR to recapitalize', async () => {
      await assetRegistry.connect(owner).unregister(collateral0.address)
      expect(await assetRegistry.isRegistered(collateral0.address)).to.equal(false)
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs([backupToken.address], [fp('1')], false)
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      // Should be trading RSR for backup token
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.status()).to.equal(1) // OPEN state
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(backupToken.address)
    })
  })
})