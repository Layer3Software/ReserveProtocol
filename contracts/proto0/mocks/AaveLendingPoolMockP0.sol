// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Oracle.sol";

contract AaveLendingPoolMockP0 is IAaveLendingPool {
    ILendingPoolAddressesProvider private _lendingAddressesProvider;

    constructor(address lendingAddressesProvider) {
        _lendingAddressesProvider = ILendingPoolAddressesProvider(lendingAddressesProvider);
    }

    function getAddressesProvider() external view override returns (ILendingPoolAddressesProvider) {
        return _lendingAddressesProvider;
    }
}
