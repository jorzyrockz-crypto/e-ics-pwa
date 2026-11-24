export type TxType = 'E-Load' | 'Cash In' | 'Cash Out' | 'Top-Up';
export type Wallets = { cash: number; maribank: number; profit?: number };

// Optional receipt/tip fields keep older transactions and backups compatible.
export type TransactionMoney = {
  type: TxType;
  amount: number;
  fee: number;
  selling: number;
  discount?: number;
  tip?: number;
  tipWallet?: keyof Wallets;
  // Allocation of confirmed principal + fee, excluding the separately routed tip.
  // Stored in currency units at collection. Proportional allocation also keeps
  // ordinary amount/fee edits reversible, without moving all earlier partial
  // collections to the wallet selected for the newest payment.
  paymentAllocation?: Wallets;
  utang?: boolean;
  utangStatus?: 'unpaid' | 'paid';
  paidAmount?: number;
  // True only after the owner records the completed send/release. Missing on
  // older rows: retain their original pay-first baseline until explicitly reviewed.
  utangReleased?: boolean;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const defaultTipWallet = (type: TxType): keyof Wallets => type === 'Cash Out' ? 'maribank' : 'cash';
// Defaults for a NEW confirmation only. Do not apply this to legacy receipts:
// older Cash Out Utang collections were booked to Main Wallet, not cash.
export const defaultReceivingWallet = (tx: Pick<TransactionMoney, 'type' | 'utang'>): keyof Wallets => tx.utang ? 'cash' : defaultTipWallet(tx.type);
export const isValidTip = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
export const normalizeTip = (value: unknown): number => typeof value === 'number' && value > 0 && isValidTip(value) ? round2(value) : 0;
export const txTip = (tx: TransactionMoney): number => tx.type === 'Top-Up' ? 0 : normalizeTip(tx.tip);
export const txTipWallet = (tx: TransactionMoney): keyof Wallets => tx.tipWallet === 'cash' || tx.tipWallet === 'maribank' ? tx.tipWallet : defaultTipWallet(tx.type);

export function normalizePaymentAllocation(value: unknown): Wallets | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { cash, maribank } = value as Partial<Wallets>;
  if (typeof cash !== 'number' || typeof maribank !== 'number' || !isValidTip(cash) || !isValidTip(maribank)) return undefined;
  const allocation = { cash: round2(cash), maribank: round2(maribank) };
  const total = round2(allocation.cash + allocation.maribank);
  return total > 0 && isValidTip(total) ? allocation : undefined;
}

function assertWallet(wallet: keyof Wallets): asserts wallet is 'cash' | 'maribank' {
  if (wallet !== 'cash' && wallet !== 'maribank') throw new Error('Choose Cash on Hand or Main Wallet for this payment.');
}
function allocateReceipt(total: number, allocation: Wallets | undefined, fallback: keyof Wallets): Wallets {
  if (!allocation) return { cash: fallback === 'cash' ? total : 0, maribank: fallback === 'maribank' ? total : 0 };
  const amount = round2(total);
  const cash = round2(amount * (allocation.cash / (allocation.cash + allocation.maribank)));
  // Derive the other leg from the same total so centavos never disappear.
  return { cash, maribank: round2(amount - cash) };
}

// A tip is money already received, never part of an unpaid customer's debt.
// Legacy upfront sales are already recorded as paid; Utang needs an explicit
// paid status, even if an imported paidAmount happens to cover the principal.
export const canRecordTip = (tx: TransactionMoney): boolean => tx.type !== 'Top-Up' && (!tx.utang || tx.utangStatus === 'paid');
export function withRecordedTip<T extends TransactionMoney>(tx: T, amount: number, wallet: keyof Wallets): T {
  if (!canRecordTip(tx)) throw new Error('Confirm full customer payment before recording a tip.');
  if (!isValidTip(amount)) throw new Error('Extra / Tip must be zero or a positive amount within the supported range.');
  assertWallet(wallet);
  return { ...tx, tip: normalizeTip(amount), tipWallet: wallet };
}

export function withUtangPayment<T extends TransactionMoney>(tx: T, principal: number, wallet: keyof Wallets = defaultReceivingWallet(tx)): T {
  if (!tx.utang || tx.utangStatus === 'paid') throw new Error('This Utang is already paid or is not an unpaid Utang.');
  const total = round2(tx.amount);
  const alreadyPaid = round2(Math.min(total, Math.max(0, tx.paidAmount || 0)));
  const remaining = round2(total - alreadyPaid);
  const paidNow = round2(principal);
  // Legacy imports can have all principal collected but no paid marker yet.
  // Confirming those records closes the Utang without collecting money again.
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(alreadyPaid) || !Number.isFinite(principal) || paidNow < 0 || (paidNow === 0 && remaining > 0) || paidNow > remaining) throw new Error('Payment must be greater than zero and cannot exceed the remaining Utang.');
  const paidAmount = round2(alreadyPaid + paidNow);
  return withReceivedPayment({ ...tx, paidAmount, utangStatus: paidAmount >= total ? 'paid' : 'unpaid' }, wallet, tx);
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

// Missing allocation retains the historical service-based receipt route. Only
// an explicit collection or correction records a different receiving wallet.
// Tips remain independently routable, including a cash tip on digital Cash Out.
export function customerPayments(tx: TransactionMoney): Wallets {
  if (tx.type === 'Top-Up') return { cash: 0, maribank: 0 };
  const total = (tx.type === 'E-Load' ? tx.selling || tx.amount : tx.amount) + (tx.fee || 0);
  const payments = allocateReceipt(total, normalizePaymentAllocation(tx.paymentAllocation), defaultTipWallet(tx.type));
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

// The customer receipt and the service payout are separate legs. This helper
// describes collections only; it must not be used as the service's wallet debit.
export function collectedTransaction<T extends TransactionMoney>(tx: T): T | null {
  if (tx.type !== 'Top-Up' && tx.utang && tx.utangStatus !== 'paid') {
    const paid = Math.min(tx.amount, Math.max(0, tx.paidAmount || 0));
    // Do not silently erase an old stored tip's already-booked paid portion.
    // New tips remain gated by canRecordTip/withRecordedTip until full payment.
    return paid > 0 ? txPortion(tx, paid) : null;
  }
  return tx;
}

// Cumulative confirmed receipts, not the amount charged or the outgoing cost.
export function collectedPayments(tx: TransactionMoney): Wallets {
  const collected = collectedTransaction(tx);
  return collected ? customerPayments(collected) : { cash: 0, maribank: 0 };
}

// Book ONLY the new principal + fee to the selected wallet. Earlier partial
// receipts retain their destinations, even if this payment arrives elsewhere.
export function withReceivedPayment<T extends TransactionMoney>(tx: T, wallet: keyof Wallets, previous: TransactionMoney | null = null): T {
  assertWallet(wallet);
  if (tx.type === 'Top-Up') throw new Error('Provider top-ups do not have customer payment receipts.');
  const before = previous ? collectedPayments({ ...previous, tip: 0 }) : { cash: 0, maribank: 0 };
  const after = collectedPayments({ ...tx, tip: 0 });
  const total = round2(after.cash + after.maribank);
  const added = round2(total - before.cash - before.maribank);
  if (!isValidTip(total) || !isValidTip(before.cash) || !isValidTip(before.maribank)) throw new Error('The customer payment total is invalid. Review the amount and fee.');
  const allocation = added >= 0
    ? { ...before, [wallet]: round2(before[wallet] + added) }
    : allocateReceipt(total, normalizePaymentAllocation(before), wallet);
  return { ...tx, paymentAllocation: normalizePaymentAllocation(allocation), tipWallet: txTip(tx) > 0 ? txTipWallet(tx) : wallet };
}

// Explicit owner correction: move money ALREADY collected, including its tip,
// without changing the debt, profit, service release, or total receipts.
export function withPaymentWalletCorrection<T extends TransactionMoney>(tx: T, wallet: keyof Wallets): T {
  assertWallet(wallet);
  const received = collectedPayments(tx);
  const receivedTotal = round2(received.cash + received.maribank);
  if (tx.type === 'Top-Up' || !isValidTip(received.cash) || !isValidTip(received.maribank) || !isValidTip(receivedTotal) || receivedTotal <= 0) throw new Error('There is no recorded customer payment to move.');
  const base = collectedPayments({ ...tx, tip: 0 });
  const total = round2(base.cash + base.maribank);
  return { ...tx, paymentAllocation: normalizePaymentAllocation({ cash: wallet === 'cash' ? total : 0, maribank: wallet === 'maribank' ? total : 0 }), tipWallet: wallet };
}

// paidAmount is principal only. Fees are collected proportionally, so a partial
// payer must not be charged the already-collected part of the fee again.
export function utangAmountDue(tx: TransactionMoney): number {
  if (!tx.utang || tx.utangStatus === 'paid' || tx.type === 'Top-Up') return 0;
  const collected = collectedTransaction(tx);
  return Math.max(0, round2(customerTotal({ ...tx, tip: 0 }) - (collected ? customerTotal({ ...collected, tip: 0 }) : 0)));
}

export const needsUtangRelease = (tx: TransactionMoney): boolean => tx.type !== 'Top-Up' &&
  Boolean(tx.utang) && tx.utangStatus !== 'paid' && tx.utangReleased !== true &&
  Number.isFinite(tx.amount) && tx.amount > Math.max(0, tx.paidAmount || 0);

export function withUtangRelease<T extends TransactionMoney>(tx: T): T {
  if (!needsUtangRelease(tx)) throw new Error('This Utang has no unrecorded release to confirm. Reload and review the latest record.');
  return { ...tx, utangReleased: true };
}

export function applyTransaction(wallets: Wallets, tx: TransactionMoney, sign = 1): Wallets {
  const collected = collectedTransaction(tx);
  const received = collected ? customerPayments(collected) : { cash: 0, maribank: 0 };
  let cash = wallets.cash + sign * received.cash;
  let maribank = wallets.maribank + sign * received.maribank;
  // New, owner-confirmed Utang releases debit the entire outgoing service now,
  // even when no customer money has arrived. Legacy rows keep their old paid-
  // portion debit until the owner explicitly reconciles the missing release.
  const payout = tx.type !== 'Top-Up' && tx.utang && tx.utangStatus !== 'paid' && tx.utangReleased !== true ? collected : tx;
  if (payout?.type === 'E-Load') maribank -= sign * (payout.amount - eLoadDiscount(payout));
  else if (payout?.type === 'Cash In') maribank -= sign * payout.amount;
  else if (payout?.type === 'Cash Out') cash -= sign * payout.amount;
  else if (payout?.type === 'Top-Up') {
    cash -= sign * (payout.amount + (payout.fee || 0));
    maribank += sign * payout.amount;
  }
  return {
    cash: round2(cash),
    maribank: round2(maribank),
    ...(typeof wallets.profit === 'number' && wallets.profit > 0 ? { profit: wallets.profit } : {}),
  };
}

export function reverseTransaction(wallets: Wallets, tx: TransactionMoney): Wallets {
  return applyTransaction(wallets, tx, -1);
}

export function updateWalletsForEdit(wallets: Wallets, oldTx: TransactionMoney, newTx: TransactionMoney): Wallets {
  // Difference of cumulative legs: collecting a released Utang changes receipts
  // only, never sends its principal again. Edits, delete, and Undo share this math.
  return applyTransaction(reverseTransaction(wallets, oldTx), newTx);
}
