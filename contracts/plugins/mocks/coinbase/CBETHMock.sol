// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";

contract CBETHMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint256 internal _exchangeRate;

    constructor(
        address underlyingToken
    ) ERC20Mock('CBETH', 'CBETH') {
        _underlyingToken = underlyingToken;
        _exchangeRate = 1000000000000000000;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function exchangeRate() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint256 rate) external {
        _exchangeRate = rate;
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }

}