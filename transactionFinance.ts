export type TxType = 'E-Load' | 'Cash In' | 'Cash Out' | 'Top-Up';
export type Wallets = { cash: number; maribank: number };

// Optional tip fields keep older transactions and backups compatible.
export type TransactionMoney = {
  type: TxType;
  amount: number;
  fee: number;
  selling: number;
  discount?: number;
  tip?: number;
  tipWallet?: keyof Wallets;
  utang?: boolean;
  utangStatus?: 'unpaid' | 'paid';
  paidAmount?: number;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const defaultTipWallet = (type: TxType): keyof Wallets => type === 'Cash Out' ? 'maribank' : 'cash';
export const isValidTip = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
export const normalizeTip = (value: unknown): number => typeof value === 'number' && value > 0 && isValidTip(value) ? round2(value) : 0;
export const txTip = (tx: TransactionMoney): number => tx.type === 'Top-Up' ? 0 : normalizeTip(tx.tip);
export const txTipWallet = (tx: TransactionMoney): keyof Wallets => tx.tipWallet === 'cash' || tx.tipWallet === 'maribank' ? tx.tipWallet : defaultTipWallet(tx.type);

// A tip is money already received, never part of an unpaid customer's debt.
// Legacy upfront sales are already recorded as paid; Utang needs an explicit
// paid status, even if an imported paidAmount happens to cover the principal.
export const canRecordTip = (tx: TransactionMoney): boolean => tx.type !== 'Top-Up' && (!tx.utang || tx.utangStatus === 'paid');
export function withRecordedTip<T extends TransactionMoney>(tx: T, amount: number, wallet: keyof Wallets): T {
  if (!canRecordTip(tx)) throw new Error('Confirm full customer payment before recording a tip.');
  if (!isValidTip(amount)) throw new Error('Extra / Tip must be zero or a positive amount within the supported range.');
  return { ...tx, tip: normalizeTip(amount), tipWallet: wallet };
}

export function withUtangPayment<T extends TransactionMoney>(tx: T, principal: number): T {
  if (!tx.utang || tx.utangStatus === 'paid') throw new Error('This Utang is already paid or is not an unpaid Utang.');
  const total = round2(tx.amount);
  const alreadyPaid = round2(Math.min(total, Math.max(0, tx.paidAmount || 0)));
  const remaining = round2(total - alreadyPaid);
  const paidNow = round2(principal);
  // Legacy imports can have all principal collected but no paid marker yet.
  // Confirming those records closes the Utang without collecting money again.
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(alreadyPaid) || !Number.isFinite(principal) || paidNow < 0 || (paidNow === 0 && remaining > 0) || paidNow > remaining) throw new Error('Payment must be greater than zero and cannot exceed the remaining Utang.');
  const paidAmount = round2(alreadyPaid + paidNow);
  return { ...tx, paidAmount, utangStatus: paidAmount >= total ? 'paid' : 'unpaid' };
}

// Use the difference between cumulative paid portions, not independent rounded
// fractions, so several partial collections sum to the original fee/discount.
export function utangPaymentPortion<T extends TransactionMoney>(tx: T, principal: number): T {
  const updated = withUtangPayment(tx, principal);
  const before = txPortion({ ...tx, tip: 0 }, Math.min(tx.amount, Math.max(0, tx.paidAmount || 0)));
  const after = txPortion({ ...tx, tip: 0 }, updated.paidAmount || 0);
  return { ...txPortion(tx, principal), fee: round2(after.fee - before.fee), discount: round2(eLoadDiscount(after) - eLoadDiscount(before)), tip: 0 };
}

export const eLoadDiscount = (tx: TransactionMoney) => tx.type === 'E-Load' ? Math.min(Math.max(0, round2(tx.discount || 0)), tx.amount) : 0;
export const txProfit = (tx: TransactionMoney) => tx.type === 'Top-Up' ? -round2(tx.fee || 0) : round2((tx.fee || 0) + eLoadDiscount(tx) + txTip(tx));

// Principal + regular fee keep their existing payment route. Only the extra
// follows tipWallet, including cash tips on an otherwise digital Cash Out.
export function customerPayments(tx: TransactionMoney): Wallets {
  const payments: Wallets = { cash: 0, maribank: 0 };
  if (tx.type === 'Top-Up') return payments;
  payments[defaultTipWallet(tx.type)] = (tx.type === 'E-Load' ? tx.selling || tx.amount : tx.amount) + (tx.fee || 0);
  payments[txTipWallet(tx)] += txTip(tx);
  return { cash: round2(payments.cash), maribank: round2(payments.maribank) };
}

export function customerTotal(tx: TransactionMoney): number {
  if (tx.type === 'Top-Up') return round2(tx.amount + (tx.fee || 0));
  const payments = customerPayments(tx);
  return round2(payments.cash + payments.maribank);
}

export function txPortion<T extends TransactionMoney>(tx: T, amount: number): T {
  const ratio = tx.amount > 0 ? amount / tx.amount : 0;
  return {
    ...tx,
    amount: round2(amount),
    selling: tx.type === 'E-Load' ? round2(amount) : tx.selling,
    fee: round2((tx.fee || 0) * ratio),
    discount: round2(eLoadDiscount(tx) * ratio),
    tip: round2(txTip(tx) * ratio),
  };
}

export function applyTransaction(wallets: Wallets, tx: TransactionMoney, sign = 1): Wallets {
  const received = customerPayments(tx);
  let cash = wallets.cash + sign * received.cash;
  let maribank = wallets.maribank + sign * received.maribank;
  if (tx.type === 'E-Load') maribank -= sign * (tx.amount - eLoadDiscount(tx));
  else if (tx.type === 'Cash In') maribank -= sign * tx.amount;
  else if (tx.type === 'Cash Out') cash -= sign * tx.amount;
  else if (tx.type === 'Top-Up') {
    cash -= sign * (tx.amount + (tx.fee || 0));
    maribank += sign * tx.amount;
  }
  return { cash: round2(cash), maribank: round2(maribank) };
}

export function reverseTransaction(wallets: Wallets, tx: TransactionMoney): Wallets {
  return applyTransaction(wallets, tx, -1);
}

export function transactionWalletEffect<T extends TransactionMoney>(tx: T): T | null {
  if (tx.utang && tx.utangStatus !== 'paid') {
    const paid = Math.min(tx.amount, Math.max(0, tx.paidAmount || 0));
    return paid > 0 ? txPortion(tx, paid) : null;
  }
  return tx;
}

export function updateWalletsForEdit(wallets: Wallets, oldTx: TransactionMoney, newTx: TransactionMoney): Wallets {
  let next = { ...wallets };
  const oldEffect = transactionWalletEffect(oldTx);
  if (oldEffect) next = reverseTransaction(next, oldEffect);
  const newEffect = transactionWalletEffect(newTx);
  if (newEffect) next = applyTransaction(next, newEffect);
  return next;
}
