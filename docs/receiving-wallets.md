# Customer receiving wallets

## New payment defaults

| Payment being confirmed | Default receiving wallet |
| --- | --- |
| Upfront E-Load | Cash on Hand |
| Upfront Cash In | Cash on Hand |
| Upfront Cash Out | Main Wallet (internal) |
| Any Utang collection, including Cash Out Utang | Cash on Hand |

The owner can select the wallet that **actually received** each collection.
The optional new tip defaults to that selection and can be routed separately.
Tips are still offered only after full payment, never on a partial collection.

Selecting a receiving wallet does not change the outgoing service: load costs
and Cash In leave Main Wallet; Cash Out releases physical cash. A previously
recorded service release must not be deducted a second time at collection.

## Receipt allocation and compatibility

- `paymentAllocation` stores the principal-plus-fee distribution, **excluding
  tips**, in currency units at confirmation. Existing collections are retained;
  only the new cumulative principal/fee difference goes to the selected wallet.
- Partial collections can arrive in different wallets. Fee rounding remains the
  difference between cumulative paid portions, not a fresh rounded fraction.
- Ordinary price/fee edits scale the existing allocation proportionally, with
  the second wallet derived from the same total to preserve centavos. Notes do
  not change the allocation or either balance. Delete and Undo use the same math.
- A missing/invalid allocation uses the original service-based route. In
  particular, legacy Cash Out Utang receipts remain booked to Main Wallet until
  an owner explicitly corrects them. Loading records, updating the app, and
  opening/canceling a review must never migrate current balances automatically.
- Closing an old Utang with zero remaining principal keeps the previously
  collected receipts in their recorded wallets; it is not another collection.

## Correcting an existing payment

Transaction detail → **Correct receiving wallet** previews both wallet deltas.
It moves **all already-collected customer receipts for that transaction**,
including its collected tip. It does not change principal, fee, profit, paid
status, payment confirmation time, sale date, or the service-release baseline.
Do not use consolidation if earlier partial payments genuinely belong in
different wallets. Use the separate tip editor to move only a tip.

The owner must acknowledge the destination and that no manual correction was
already made. An online, revision-checked Firestore transaction updates the
record and both wallet balances together. Corrections are rejected offline,
with pending financial proposals/conflicts, or with a stale record/wallet
revision. Duplicate clicks and stale retries cannot apply the movement twice.

The record retains `paymentWalletCorrections` with the old/new receipt totals
and correction timestamp. Full backups preserve allocation/history; full CSV
exports include cash/Main receipt totals, full-payment confirmation time (when
available), and the latest destination-correction time. These are recorded
values, not independent evidence of physical cash or a complete receipt ledger.

Example: reclassifying an already-paid Cash Out receipt of 100 principal + 1.50
fee + 18.50 tip from Main to cash moves **cash +120 / Main -120**. It does not
repeat the 100 cash release or create another 120 payment. Any earlier negative
cash balance or cash-count mismatch still requires separate reconciliation.
