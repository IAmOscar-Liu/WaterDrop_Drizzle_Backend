# Admin Section 3 seller withdrawal plan

Date: 2026-09-16  
Source: `docs/api/FE-confirmation/ADMIN_FE_CONFIRMATION_CHECKLIST.md`, Section 3

Status: proposed; no runtime implementation has started.

## Conclusion

Section 3 is not implemented. The project has a seller account wallet, but it
currently represents money credited by a platform admin and money transferred
from that wallet into advertisements. It is not yet a seller-sales settlement
account.

Adding only these two routes would be unsafe:

```http
POST /api/admin/ad-revenue/withdrawal
GET  /api/admin/ad-revenue/withdrawals
```

There is no authoritative withdrawable-revenue balance, payout destination,
withdrawal reservation, approval workflow, or immutable payout ledger behind
them. Seller revenue settlement must be implemented before withdrawals are
enabled.

## Current-project audit

| Area | Current state | Gap for withdrawal |
| --- | --- | --- |
| Seller wallet | `account_wallets` and immutable wallet transactions exist. | Only admin credits and advertisement-funding debits are recorded. |
| Wallet locking | `lockedBalance` exists and is constrained not to exceed `walletBalance`. | Nothing currently writes it, and ad funding does not subtract it when checking available funds. |
| Sales revenue | Paid orders and dashboard GMV are queryable. | Paying an order does not credit a seller wallet or create a seller settlement. |
| Cash/coin revenue | `totalRevenueCash` and `totalRevenueCoin` exist. | No workflow maintains them, so they are not authoritative. |
| Delivery | Delivery can become `delivered`. | Delivery completion does not start or release a seller settlement hold. |
| Refund | Completed refunds restore/reconcile user coins and report cash refunds. | They do not reverse seller revenue because seller revenue is not recorded. |
| Seller attribution | Queries join an order item to the product's current `sellerId`. | `order_items` has no `sellerIdAtSale`; a platform admin can currently change product ownership. |
| Money authority | Variant availability is checked by the server. | Order item price, subtotal, total, discount, and fee values are still accepted from the app request. They cannot directly drive a payout. |
| Multi-seller orders | One order may contain products from multiple sellers. | Order-level coins, fees, shipping, and refunds need deterministic per-seller allocation. |
| Coin payment | `$1 = 10 coins` and order coin consumption are tracked. | Consumed coins do not currently create product-seller wallet revenue. |
| Bank details | App users have refund bank fields. | Admin-side seller accounts have no payout method or verified bank-account snapshot. |
| Withdrawal records | None. | No request, status, history, idempotency, approval, rejection, or paid reference exists. |
| Payment execution | ECPay is used for customer payment/refund and logistics. | There is no seller bank-payout provider integration. |
| Tests/reconciliation | Wallet and coin-ledger reconciliation exist. | Neither knows about sales credits, locked withdrawal funds, or payout debits. |

## Recommended business meaning

Use one seller account wallet for both:

- confirmed wallet top-ups/admin credits;
- released seller sales revenue;
- advertisement-funding debits;
- completed withdrawal debits.

`walletBalance` remains the total cash balance. Add an API-calculated value:

```text
availableBalance = walletBalance - lockedBalance
```

A withdrawal request reserves money by increasing `lockedBalance`. It does not
debit `walletBalance` until the transfer is confirmed paid. Advertisement
funding must check `availableBalance`, not the full wallet balance.

Money already transferred from the wallet into an advertisement remains
non-withdrawable. This preserves the accepted rule that an advertisement
budget cannot be moved back into the wallet. Seller returns also continue to
credit the source advertisement, not the wallet.

Do not treat dashboard `netSales`, advertisement balances, or the existing
`totalRevenue*` columns as withdrawable money until the settlement ledger has
credited the wallet.

## Recommended canonical APIs

Use the existing `/account-wallet` domain instead of restoring the obsolete
`/ad-revenue` namespace.

### Seller balance and payout method

```http
GET /api/admin/account-wallet/me
GET /api/admin/account-wallet/me/transactions
GET /api/admin/account-wallet/me/payout-method
PUT /api/admin/account-wallet/me/payout-method
```

Enhance the wallet response with exact decimal strings:

```json
{
  "walletBalance": "1250.00",
  "lockedBalance": "300.00",
  "availableBalance": "950.00",
  "totalRevenueCash": "800.00",
  "totalRevenueCoin": "200.00"
}
```

Only a seller may update its payout method. Employees must not view or update
bank details. Platform admins may view a masked destination and verification
state, but APIs must never return a full bank account after it is stored.

### Seller withdrawal request and history

```http
POST /api/admin/account-wallet/me/withdrawals
GET  /api/admin/account-wallet/me/withdrawals?page=1&limit=20&status=
GET  /api/admin/account-wallet/me/withdrawals/:id
POST /api/admin/account-wallet/me/withdrawals/:id/cancel
```

Recommended request:

```json
{
  "amount": "300",
  "idempotencyKey": "withdrawal-SELLER_UUID-20260916-0001"
}
```

Recommended rules:

- seller accounts only; employees cannot request withdrawals;
- seller must be active and have a verified payout method;
- positive whole-TWD amount because bank payouts do not use fractional TWD;
- fractional wallet value remains available for a later request;
- configurable minimum amount from environment;
- `availableBalance >= amount` under a wallet row lock;
- idempotency key is mandatory;
- allow at most one non-terminal withdrawal per seller initially;
- request creation increases `lockedBalance` atomically;
- a seller may cancel only while status is `pending`.

### Platform-admin operations

```http
GET   /api/admin/account-wallet/platform/withdrawals
GET   /api/admin/account-wallet/platform/withdrawals/:id
PATCH /api/admin/account-wallet/platform/withdrawals/:id/status
```

List filters should include `sellerId`, `status`, `startAt`, `endAt`, page, and
limit. The status update should accept an idempotency key, an optional internal
note, and a required external payment reference when marking a request paid.

Do not let an admin edit the requested amount or payout snapshot after request
creation. Reject or cancel the request and create a new one instead.

## Withdrawal state machine

Recommended statuses:

```text
pending -> approved -> processing -> paid
   |          |            |
   +-------> rejected <-----+
   |
   +-------> cancelled   (seller action while pending only)
```

- `pending`, `approved`, and `processing` keep the amount locked.
- `rejected` and `cancelled` release the locked amount without changing
  `walletBalance`.
- `paid` atomically decreases both `walletBalance` and `lockedBalance`, then
  inserts an immutable `withdrawal_debit` wallet transaction.
- `paid`, `rejected`, and `cancelled` are terminal.
- Repeating the same transition/idempotency key returns the original result.
- Invalid backward or conflicting transitions return `409`.

Start with manual bank-transfer processing: an admin marks `paid` only after
confirming the transfer externally. A future payout-provider integration needs
an outbox/worker and verified webhook; an external transfer must never be
performed inside a database transaction.

## Schema changes

### Snapshot seller ownership on order items

Add to `order_items`:

```text
sellerIdAtSale uuid -> accounts, not null for post-cutover orders
```

The server derives it from the product during order creation. Settlement and
refund accounting must use this snapshot, not the product's current owner.

### Add seller order settlements

Add `seller_order_settlements`, normally one row per order item:

```text
id
sellerId
orderId
orderItemId                    unique
grossAmount                    numeric(18,2)
cashPaymentAmount              numeric(18,2)
coinPaymentAmount              numeric(18,2)
transactionFeeAmount           numeric(18,2)
shippingDeductionAmount        numeric(18,2)
refundAmount                   numeric(18,2)
netAmount                      numeric(18,2)
status                         pending | available | reversed | exception
deliveredAt
availableAt
walletTransactionId            nullable, unique
calculationVersion
calculationSnapshot            jsonb
createdAt / updatedAt
```

Use an immutable calculation snapshot so later environment, product, price, or
fee changes cannot rewrite historical seller earnings.

### Extend wallet transaction types

Add at least:

```text
sale_cash_credit
sale_coin_credit
refund_debit
withdrawal_debit
admin_debit_correction
```

If one settlement contains both cash and coin value, either create two linked
wallet credits or one `sale_credit` with an immutable cash/coin breakdown.
Two entries make `totalRevenueCash` and `totalRevenueCoin` easier to reconcile.

Update database sign/type checks, Swagger enums, summaries, migration audits,
and reconciliation for every new type.

### Add seller payout methods

Add a dedicated `seller_payout_methods` table rather than reusing app-user
refund bank fields:

```text
sellerId                       unique
bankCode
accountHolderName
accountNumberEncrypted
accountNumberLast4
verificationStatus             unverified | verified | rejected
verifiedAt / verifiedByAccountId
createdAt / updatedAt
```

Store a payout-method snapshot on each withdrawal so later bank changes do not
change an existing request. Encryption key rotation and masking must be part of
the implementation; never log or return the plaintext account number.

### Add withdrawal requests and status history

Add `seller_withdrawal_requests`:

```text
id
sellerId
walletId
amount                         numeric(18,0)
status
idempotencyKey                 unique
payoutMethodSnapshot           encrypted/masked jsonb
requestedAt
approvedAt / processingAt / paidAt / rejectedAt / cancelledAt
reviewedByAccountId
externalPaymentReference
sellerNote / adminNote
createdAt / updatedAt
```

Add append-only `seller_withdrawal_status_logs` with actor, previous status,
new status, note, idempotency key, and timestamp. Also record admin activity
events without sensitive bank data.

## Seller revenue settlement prerequisite

### Make order money server-authoritative

Before any payout can use order data:

1. Load and lock the requested variants/products on the server.
2. Derive seller, unit price, product/variant snapshots, and line total from the
   database.
3. Calculate subtotal, allowed coin discount, fee, shipping, and final total on
   the server.
4. Reject a client total that does not match; never persist it as the source of
   truth.
5. Use exact minor-unit/numeric helpers rather than floating-point arithmetic
   for new settlement values.

This is a correctness and security prerequisite, not optional cleanup.

### Create pending settlements

When an order becomes `paid`, create idempotent pending settlement rows for its
items. A multi-seller order produces rows for each item's seller. Coins are a
payment source at `$1 = 10 coins`; they must be included in product-seller
revenue even though the customer's cash charge is lower.

Do not credit `walletBalance` at payment time. The item may still be undelivered
or refundable.

### Release revenue after delivery and hold

When a delivery becomes `delivered`, set `deliveredAt` and calculate
`availableAt` using a configurable settlement/refund hold. A maintenance job
releases due settlements in bounded, idempotent batches:

1. lock the settlement and seller wallet;
2. skip rows with pending/processing refunds;
3. apply completed refunds and fee/deduction rules;
4. credit exact cash and coin revenue to the wallet;
5. update authoritative revenue totals;
6. mark the settlement available and link wallet transaction(s).

The maintenance job should run in the platform accounting timezone
(`Asia/Taipei`), using an advisory lock so multiple server instances cannot
process the same batch concurrently.

### Refund handling

- A completed refund before revenue release reduces the pending settlement.
- A pending/processing refund delays release.
- A completed exceptional refund after revenue release inserts an immutable
  `refund_debit` or seller-debt entry; it must never rewrite the original sale.
- Withdrawal locking and refund adjustment must lock the seller wallet in the
  same order to avoid races.

The project currently has no enforced refund deadline. Either implement one
that matches the settlement hold or add an explicit seller-debt balance for
refunds completed after the seller has withdrawn the revenue.

## Recommended seller earning formula

Recommended starting formula per order item:

```text
gross product value
- seller-borne transaction fee allocation
- seller-borne shipping deduction allocation
- completed product refund value
= seller net revenue
```

Customer coins are payment, not a reduction of seller gross product value.
Shipping charged to the customer should not automatically become product
revenue. Order-level amounts must be allocated deterministically using exact
minor units; assign any rounding remainder by stable order-item ID so totals
always reconcile.

The calculation version and inputs must be stored on the settlement row.

## Migration and historical cutoff

Recommended rollout policy: do not infer withdrawable revenue from historical
orders automatically. Historical orders use client-supplied amounts and lack a
seller-at-sale snapshot, so current product ownership is not reliable evidence
of who should receive old revenue.

Add:

```dotenv
SELLER_SETTLEMENT_ENABLED=false
SELLER_WITHDRAWAL_ENABLED=false
SELLER_SETTLEMENT_CUTOVER_AT=<ISO-8601 timestamp>
SELLER_SETTLEMENT_HOLD_DAYS=<confirmed value>
SELLER_WITHDRAWAL_MIN_TWD=<confirmed value>
SELLER_PAYOUT_ENCRYPTION_KEY=<environment secret>
```

Backfill steps:

1. Audit order money precision, products whose ownership changed, and paid
   historical items by seller.
2. Backfill `sellerIdAtSale` only where attribution is accepted; mark older
   rows as legacy/unsettled rather than payable.
3. Create settlement control rows for every existing seller.
4. If the business approves a historical seller opening balance, insert an
   explicit admin-reviewed opening transaction instead of reconstructing it
   silently.
5. Reconcile wallet aggregate, locked balance, withdrawal locks, and all new
   wallet transaction chains.

Enable settlement first. Observe and reconcile sales credits in a non-production
environment. Enable withdrawal requests only after settlement balances and
payout-method security are verified.

## Authorization

- Seller: view own settlement/wallet/withdrawals, maintain own payout method,
  create and cancel its own pending request.
- Employee: no payout method or withdrawal access; financial authority remains
  with the seller account.
- Platform admin: list all requests, verify payout methods, and advance/reject
  withdrawal states; cannot silently alter amounts.
- Inactive, banned, or deleted accounts cannot create requests.
- Every seller scope is resolved server-side.

## Concurrency and reconciliation

Use the existing wallet lock order as the base:

```text
seller wallet -> settlement/withdrawal row -> linked ledger rows
```

Advertisement funding, withdrawal creation, withdrawal completion, sales
release, and refund debits must all serialize through the seller wallet.

Extend reconciliation to fail on:

- `lockedBalance` not equal to the sum of non-terminal withdrawals;
- `lockedBalance > walletBalance`;
- available balance below zero;
- paid withdrawal without one equal wallet debit;
- terminal rejected/cancelled withdrawal still locking money;
- released settlement without matching wallet credit(s);
- duplicate order-item settlement;
- revenue aggregates differing from immutable settlement entries;
- payout destination or paid transition missing required audit data.

## Test plan

Add disposable-database API/integration coverage for:

- server-authoritative price and seller snapshots;
- cash-only, coin-only, and mixed-payment seller revenue;
- multi-seller orders and deterministic rounding;
- delivered/undelivered settlement timing;
- pending and completed refunds before release;
- exceptional refund after release;
- settlement cron idempotency and multi-instance advisory locking;
- seller/admin/employee authorization;
- payout method masking and verification;
- whole-TWD and minimum withdrawal validation;
- insufficient available balance;
- request idempotency and one-open-request rule;
- concurrent ad funding versus withdrawal reservation;
- cancel/reject fund release;
- paid debit and external reference requirement;
- invalid status transitions;
- full wallet/settlement/withdrawal reconciliation;
- no change to advertisement balances, coin expiry, or seller ad returns.

## Expected implementation areas

```text
src/db/schema.ts
src/repository/order.ts
src/repository/delivery.ts
src/repository/refund.ts
src/repository/accountWallet.ts
src/repository/sellerSettlement.ts
src/repository/sellerWithdrawal.ts
src/services/accountWallet.ts
src/services/sellerWithdrawal.ts
src/controller/accountWallet.ts
src/controller/sellerWithdrawal.ts
src/middleware/admin/accountWallet.ts
src/middleware/admin/sellerWithdrawal.ts
src/routers/admin/admin-account-wallet.ts
src/routers/admin/admin-seller-withdrawal.ts
src/lib/scheduler.ts
src/scripts/sellerSettlementMigration.ts
src/tests/api.e2e.ts
src/tests/sellerSettlement.integration.ts
src/tests/sellerWithdrawal.integration.ts
package.json
Swagger and dated admin-FE handoff documentation
environment-specific Drizzle migrations
```

## Decisions required before implementation

1. **Withdrawal source:** recommended: the available seller account-wallet
   balance after real admin credits and released sales revenue. Advertisement
   balances remain excluded.
2. **Use of sales revenue:** recommended: once credited to the wallet, it may
   fund ads or be withdrawn.
3. **Settlement release time:** choose the refund/settlement hold after delivery
   (for example 7 days); no safe default exists in current code.
4. **Late refunds:** choose an enforced refund deadline or a seller-debt model.
   Recommended: enforce the normal deadline and retain an admin-only debt path
   for exceptional late refunds.
5. **Fee ownership:** confirm whether platform transaction fees and shipping
   deductions reduce seller revenue, and how order-level values split across
   multiple sellers.
6. **Extra refund ownership:** confirm whether `extraRefundAmount` is charged to
   the product seller or treated as a platform expense.
7. **Withdrawal minimum:** set whole-TWD minimum per environment.
8. **Payout method verification:** decide who verifies seller bank details and
   what evidence is required.
9. **Payment execution:** recommended first version: manual bank transfer plus
   admin confirmation/reference; provider automation later.
10. **Historical revenue:** recommended: cut over prospectively and use only
    admin-reviewed opening balances for old orders.
11. **Compatibility aliases:** recommended: document `/account-wallet/...` as
    the replacement and do not add `/ad-revenue/*` aliases unless FE cannot
    migrate.

Implementation should not begin until decisions 1, 3, 4, 5, 6, 7, 8, 9, and
10 are confirmed because each changes accounting or payout behavior.
