import axios from 'axios';
import { ethers } from 'ethers';
import BigNumber from 'bignumber.js'
import { DictInterface } from './interfaces';
import { curve } from "./curve";
import { poolsData } from "./constants/abis/abis-ethereum";
import { DECIMALS } from "./constants/coins";

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const MAX_ALLOWANCE = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(256)).sub(ethers.BigNumber.from(1));

// bignumber.js

export const BN = (val: number | string): BigNumber => new BigNumber(val);

export const toBN = (n: ethers.BigNumber, decimals = 18): BigNumber => {
    return BN(ethers.utils.formatUnits(n, decimals)).times(decimals);
}

export const toStringFromBN = (bn: BigNumber, decimals = 18): string => {
    return bn.div(decimals).toFixed(decimals);
}

export const fromBN = (bn: BigNumber, decimals = 18): ethers.BigNumber => {
    return ethers.utils.parseUnits(toStringFromBN(bn, decimals), decimals)
}

// -------------------

export const isEth = (address: string): boolean => address.toLowerCase() === ETH_ADDRESS.toLowerCase();
export const getEthIndex = (addresses: string[]): number => addresses.map((address: string) => address.toLowerCase()).indexOf(ETH_ADDRESS.toLowerCase());

export const _getDecimals = async (...coins: string[] | string[][]): Promise<number[]> => {
    let _coins = coins
    if (coins.length == 1 && Array.isArray(coins[0])) _coins = coins[0];
    _coins = [..._coins] as string[];

    return  _coins.map((coinAddr) => DECIMALS[coinAddr] || 18);
}


export const _getBalances = async (addresses: string[], coins: string[]): Promise<DictInterface<ethers.BigNumber[]>> => {
    const _coins = [...coins]
    const ethIndex = getEthIndex(_coins);
    if (ethIndex !== -1) {
        _coins.splice(ethIndex, 1);
    }

    const contractCalls = [];
    for (const coinAddr of _coins) {
        contractCalls.push(...addresses.map((address: string) => curve.contracts[coinAddr].multicallContract.balanceOf(address)));
    }
    const response = await curve.multicallProvider.all(contractCalls);

    if (ethIndex !== -1) {
        const ethBalances: ethers.BigNumber[] = [];
        for (const address of addresses) {
            ethBalances.push(await curve.provider.getBalance(address));
        }
        response.splice(ethIndex * addresses.length, 0, ...ethBalances);
    }

    const balances: DictInterface<ethers.BigNumber[]>  = {};
    addresses.forEach((address: string, i: number) => {
        balances[address] = coins.map((_, j: number ) => response[i + (j * addresses.length)]);
    });

    return balances;
}

export const getBalances = async (addresses: string[], coins: string[]): Promise<DictInterface<string[]>> => {
    const _balances = await _getBalances(addresses, coins);
    const decimals = await _getDecimals(coins);

    const balances: DictInterface<string[]>  = {};
    for (const address of addresses) {
        balances[address] = coins.map((_, i: number ) => ethers.utils.formatUnits(_balances[address][i], decimals[i]))
    }

    return balances;
}


export const getAllowance = async (coins: string[], address: string, spender: string): Promise<ethers.BigNumber[]> => {
    const _coins = [...coins]
    const ethIndex = getEthIndex(_coins);
    if (ethIndex !== -1) {
        _coins.splice(ethIndex, 1);

    }

    let allowance: ethers.BigNumber[];
    if (_coins.length === 1) {
        allowance = [await curve.contracts[_coins[0]].contract.allowance(address, spender)];
    } else {
        const contractCalls = _coins.map((coinAddr) => curve.contracts[coinAddr].multicallContract.allowance(address, spender));
        allowance = await curve.multicallProvider.all(contractCalls);
    }


    if (ethIndex !== -1) {
        allowance.splice(ethIndex, 0, MAX_ALLOWANCE);
    }

    return allowance;
}

export const ensureAllowance = async (coins: string[], amounts: ethers.BigNumber[], spender: string): Promise<void> => {
    const address = curve.signerAddress;
    const allowance: ethers.BigNumber[] = await getAllowance(coins, address, spender);

    for (let i = 0; i < allowance.length; i++) {
        if (allowance[i].lt(amounts[i])) {
            const contract = curve.contracts[coins[i]].contract;
            if (allowance[i].gt(ethers.BigNumber.from(0))) {
                const gasLimit = (await contract.estimateGas.approve(spender, ethers.BigNumber.from(0), curve.options)).mul(130).div(100);
                await contract.approve(spender, ethers.BigNumber.from(0), { ...curve.options, gasLimit });
            }
            const gasLimit = (await contract.estimateGas.approve(spender, MAX_ALLOWANCE, curve.options)).mul(130).div(100);
            await contract.approve(spender, MAX_ALLOWANCE, { ...curve.options, gasLimit });
        }
    }
}

export const getPoolNameBySwapAddress = (swapAddress: string): string => {
    return Object.entries(poolsData).filter(([_, poolData]) => poolData.swap_address.toLowerCase() === swapAddress.toLowerCase())[0][0];
}


const _crvRateCache = {
    'rate': 0,
    'time': 0,
}

export const getCrvRate = async (): Promise<number> => {
    let crvAddress = "0xd533a949740bb3306d119cc777fa900ba034cd52";
    crvAddress = crvAddress.toLowerCase();
    if (_crvRateCache.time + 60000 < Date.now()) {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${crvAddress}&vs_currencies=usd`);
        _crvRateCache['rate'] = response.data[crvAddress]['usd'];
        _crvRateCache['time'] = Date.now();
    }
    return _crvRateCache['rate']
}
