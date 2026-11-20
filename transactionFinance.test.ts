import { describe, expect, it } from 'vitest';
import {
  applyTransaction, customerPayments, customerTotal, defaultTipWallet, isValidTip, normalizeTip,
  reverseTransaction, transactionWalletEffect, txPortion, txProfit, txTip, txTipWallet,
  updateWalletsForEdit, type TransactionMoney, type TxType,
} from './transactionFinance';

const sale = (overrides: Partial<TransactionMoney> = {}): TransactionMoney => ({
  type: 'E-Load', amount: 100, selling: 100, fee: 3, ...overrides,
});
const startingWallets = { cash: 1000, maribank: 500 };

describe('separate customer tips', () => {
  it('keeps the regular fee intact when a customer gives 20 instead of 3', () => {
    const tx = sale({ tip: 17 });
    expect(tx.fee).toBe(3);
    expect(txTip(tx)).toBe(17);
    expect(customerTotal(tx)).toBe(120);
    expect(txProfit(tx)).toBe(20);
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 1120, maribank: 400 });
  });

  it('adds the provider discount to profit without charging it to the customer', () => {
    const tx = sale({ discount: 5, tip: 17 });
    expect(customerTotal(tx)).toBe(120);
    expect(txProfit(tx)).toBe(25);
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 1120, maribank: 405 });
  });

  it('keeps Cash In principal unchanged while adding the fee and tip to cash', () => {
    const tx = sale({ type: 'Cash In', selling: 0, tip: 17 });
    expect(customerPayments(tx)).toEqual({ cash: 120, maribank: 0 });
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 1120, maribank: 400 });
    expect(txProfit(tx)).toBe(20);
  });

  it('defaults a Cash Out tip to Main Wallet alongside the regular payment', () => {
    const tx = sale({ type: 'Cash Out', selling: 0, tip: 17 });
    expect(defaultTipWallet(tx.type)).toBe('maribank');
    expect(customerPayments(tx)).toEqual({ cash: 0, maribank: 120 });
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 900, maribank: 620 });
  });

  it('routes a cash tip on Cash Out only to cash, not Main Wallet', () => {
    const tx = sale({ type: 'Cash Out', selling: 0, tip: 17, tipWallet: 'cash' });
    expect(customerTotal(tx)).toBe(120);
    expect(customerPayments(tx)).toEqual({ cash: 17, maribank: 103 });
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 917, maribank: 603 });
    expect(txProfit(tx)).toBe(20);
  });

  it('also supports a separately transferred tip on a cash-paid sale', () => {
    const tx = sale({ tip: 17, tipWallet: 'maribank' });
    expect(customerPayments(tx)).toEqual({ cash: 103, maribank: 17 });
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 1103, maribank: 417 });
  });

  it.each<TxType>(['E-Load', 'Cash In', 'Cash Out', 'Top-Up'])('reverses both balances exactly for %s', type => {
    for (const tipWallet of ['cash', 'maribank'] as const) {
      const tx = sale({ type, tip: 17.25, tipWallet, discount: 2.5 });
      expect(reverseTransaction(applyTransaction(startingWallets, tx), tx)).toEqual(startingWallets);
    }
  });

  it('changes only the tip when editing an existing sale', () => {
    const oldTx = sale();
    const newTx = sale({ tip: 17 });
    const wallets = applyTransaction(startingWallets, oldTx);
    expect(updateWalletsForEdit(wallets, oldTx, newTx)).toEqual({ cash: 1120, maribank: 400 });
    expect(updateWalletsForEdit(applyTransaction(startingWallets, newTx), newTx, oldTx)).toEqual(wallets);
    expect(updateWalletsForEdit(wallets, oldTx, oldTx)).toEqual(wallets);
  });

  it('moves a tip between wallets without duplicating it on edit', () => {
    const oldTx = sale({ type: 'Cash Out', selling: 0, tip: 17, tipWallet: 'maribank' });
    const newTx = { ...oldTx, tipWallet: 'cash' as const };
    expect(updateWalletsForEdit(applyTransaction(startingWallets, oldTx), oldTx, newTx))
      .toEqual({ cash: 917, maribank: 603 });
  });

  it('counts a tip added after an Utang was paid exactly once', () => {
    const oldTx = sale({ utang: true, utangStatus: 'paid', paidAmount: 100 });
    const newTx = { ...oldTx, tip: 17 };
    expect(updateWalletsForEdit(applyTransaction(startingWallets, oldTx), oldTx, newTx))
      .toEqual({ cash: 1120, maribank: 400 });
  });

  it('does not move unpaid Utang wallets and preserves partial-payment proportions', () => {
    const unpaid = sale({ utang: true, utangStatus: 'unpaid', paidAmount: 0 });
    expect(transactionWalletEffect(unpaid)).toBeNull();
    const edited = { ...unpaid, notes: 'edited' };
    expect(updateWalletsForEdit(startingWallets, unpaid, edited)).toEqual(startingWallets);
    const part = transactionWalletEffect({ ...unpaid, paidAmount: 50 });
    expect(part?.amount).toBe(50);
    expect(part?.fee).toBe(1.5);
    expect(part?.tip).toBe(0);
    expect(txPortion(sale({ tip: 17, discount: 5 }), 50)).toMatchObject({ amount: 50, fee: 1.5, discount: 2.5, tip: 8.5 });
  });

  it('treats legacy records with no tip fields exactly as before', () => {
    const tx = sale();
    expect(txTip(tx)).toBe(0);
    expect(txTipWallet(tx)).toBe('cash');
    expect(customerTotal(tx)).toBe(103);
    expect(txProfit(tx)).toBe(3);
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 1103, maribank: 400 });
    expect(applyTransaction(startingWallets, sale({ type: 'Cash Out' }))).toEqual({ cash: 900, maribank: 603 });
  });

  it('ignores tips for provider top-ups and continues counting their fee as an expense', () => {
    const tx = sale({ type: 'Top-Up', amount: 200, fee: 10, tip: 17, tipWallet: 'cash' });
    expect(txTip(tx)).toBe(0);
    expect(customerTotal(tx)).toBe(210);
    expect(txProfit(tx)).toBe(-10);
    expect(applyTransaction(startingWallets, tx)).toEqual({ cash: 790, maribank: 700 });
  });

  it('defaults missing or invalid imported tips to zero and rounds valid tips to centavos', () => {
    for (const value of [undefined, null, '', '17', -1, NaN, Infinity, -Infinity]) expect(normalizeTip(value)).toBe(0);
    expect(normalizeTip(17.257)).toBe(17.26);
    expect(txProfit(sale({ fee: 0.1, tip: 0.2 }))).toBe(0.3);
  });

  it('rejects negative, non-finite, and out-of-range tip input before it can affect balances', () => {
    for (const value of [-0.01, NaN, Infinity, -Infinity, 1e308, Number.MAX_SAFE_INTEGER]) {
      expect(isValidTip(value)).toBe(false);
      expect(normalizeTip(value)).toBe(0);
    }
    for (const value of [0, 0.01, 17, 17.257]) expect(isValidTip(value)).toBe(true);
  });

  it('restores a deleted tip without erasing a sale entered after the deletion', () => {
    const deleted = sale({ tip: 17 });
    const laterSale = sale({ type: 'Cash Out', selling: 0, tip: 7, tipWallet: 'cash' });
    let wallets = reverseTransaction(applyTransaction(startingWallets, deleted), deleted);
    wallets = applyTransaction(wallets, laterSale);
    wallets = applyTransaction(wallets, deleted);
    expect(wallets).toEqual({ cash: 1027, maribank: 503 });
  });

  it('preserves separate tip data through a JSON backup round trip', () => {
    const tx = sale({ tip: 17, tipWallet: 'cash' });
    const restored: TransactionMoney = JSON.parse(JSON.stringify(tx));
    expect(restored.tip).toBe(17);
    expect(restored.fee).toBe(3);
    expect(applyTransaction(startingWallets, restored)).toEqual(applyTransaction(startingWallets, tx));
  });
});
