# Seller earnings: discussion and decisions

Date: 2026-11-13 (Asia/Taipei)
Last updated: 2026-11-17 (Asia/Taipei)

Status as of 2026-11-17: implemented and merged into development; local and dev migrations applied, local earnings verified, and application schema parity confirmed. The dev service has not been deployed/restarted in this task; stg and production remain unchanged.

For the consolidated final business rules and the new API routes, use the [11/17 decision summary and API appendix](SELLER_EARNINGS_MEETING_AGENDA_ZH_TW.md). For implemented request/response contracts, use the [FE integration document](../api/FE-confirmation/SELLER_EARNINGS_AND_AD_AUTOMATION.md). This document retains detailed discussion and investigation notes; historical “planned” or “not implemented” statements describe the earlier review, not current implementation status. Where older proposals differ, the consolidated summary and implemented FE contract take precedence.

## Initial source investigation (historical)

The requested missing admin overview cards are 金幣收益 (coin earnings), 現金收益 (cash earnings), and 可提現金額 (withdrawable amount).

Source review found:

- `account_wallets.totalRevenueCash` and `totalRevenueCoin` exist and are exposed by wallet APIs, but no production workflow was found maintaining them.
- Verified payment settlement, buyer coin consumption, partial refunds, and variant-specific refund windows exist. Seller sales credits, reversals, and release accounting still need implementation.
- Orders can contain multiple sellers. Order-level discounts require deterministic allocation to purchased items/sellers.
- Advertising wallet funding and advertising budget returns are distinct from seller sales earnings and bank payouts.
- No implemented seller payout ledger/workflow was found.

References: [schema](../../src/db/schema.ts), [payment settlement](../../src/repository/payment.ts), [refund accounting](../../src/repository/refund.ts), [coin ledger](../../src/repository/coinLedger.ts), [wallet API](../../src/routers/admin/admin-account-wallet.ts), and [variant refund-window contract](../api/FE-confirmation/ADMIN_VARIANT_REFUND_WINDOWS.md).

## Agreed fee and delivery rules

### Buyer transaction surcharge

`TRANSACTION_FEE_RATE` is a buyer surcharge added at checkout to offset ECPay processing costs. It belongs to the platform, not the seller. The first version keeps the surcharge at 0%: buyers pay none and the platform covers processing costs, including additional payment-provider refund fees. Nonzero rates remain out of scope until their refund policy is separately agreed; no environment value is changed by this document.

It does not replace the seller's 10% commission and must not be deducted again from seller earnings. The initial suggestion to repurpose this setting as a seller fee was corrected and is not the agreed policy. The existing checkout includes `transactionFee` in the buyer's payable total; preserve that distinction.

### Seller commission

The platform charges 10% of product earnings, including cash and the cash equivalent of coins. Ten coins equal NT$1. Exclude buyer transaction surcharges and shipping charges from the commission base. Apply this commission once; withdrawal must not charge another 10% on an already-net balance.

Commission applies only to the non-refunded product amount. On a completed product refund, reverse the corresponding commission proportionally. A full product refund leaves no platform commission for that product; a partial refund leaves commission only on the retained product amount. Apply the original commission policy and reconcile rounding across successive partial refunds.

For example, a NT$1,000 product initially yields NT$100 commission and NT$900 seller earnings. A full product refund reverses NT$100 commission and deducts NT$900 from the seller; the platform funds the NT$1,000 buyer product refund. A NT$400 product refund reverses NT$40 commission and deducts NT$360 from the seller, leaving NT$60 commission and NT$540 seller product earnings. These examples exclude shipping, buyer surcharges, and extra compensation; existing cash/coin refund allocation still applies.

### Refund return shipping

Latest confirmed change: the seller bears refund return-shipping costs. This supersedes the earlier platform-funded return-shipping agreement. Product commission reversal and platform-funded payment-provider refund fees are unchanged.

Latest confirmed collection method: the platform advances return shipping, and an admin calculates the total actual charge and applies a separate manual seller-revenue adjustment. Do not calculate or deduct return shipping automatically on refund completion, shipment events, or scheduled release. Remove the proposed `REFUND_RETURN_SHIPPING_FEE` setting from scope; no environment variable or fixed fee is needed. The prior fixed-fee and automatic per-return-shipment charge proposal is superseded.

The admin is responsible for checking the total, including shared parcels and previously charged costs, before submitting an adjustment. The system records the explicit adjustment but does not infer parcel fees. Retry protection must prevent the same adjustment request from posting twice. Return shipping remains separate from `extraRefundAmount` and buyer payouts, with no additional commission. Normal product refunds, extra-refund deductions, and commission reversals remain automatic as already agreed; only return-shipping recovery becomes manual.

Existing API clarification: `PATCH /api/admin/refund/{refundItemId}/status` already accepts optional nonnegative `extraRefundAmount`. Swagger describes it as additional shipping, fees, or manual adjustments. The backend adds it once to the product cash refund (`paidRefundAmount`), rounds the combined cash payout down to whole TWD, and converts the fractional remainder to coins. It is a total extra amount for that refund record, not an extra per-unit amount. This supports case-by-case shipping reimbursement without a new shipping-refund toggle. For a cash-only NT$1,000 product refund, extra 0 yields NT$1,000 cash; extra 30 yields NT$1,030 cash.

Agreed funding rule: deduct the full `extraRefundAmount` from the seller's earnings when the refund completes. Sellers can choose this amount through the existing API, including optional reimbursement of original outbound shipping. No 10% commission is charged on the extra amount, and it generates no additional commission reversal. Seller-funded return shipping is a distinct cost from the seller-entered extra refund; do not charge the same shipping expense twice or automatically increase the buyer refund by a carrier payment.

For a cash-only NT$1,000 product fully refunded with `extraRefundAmount: 30`, the buyer receives NT$1,030; reverse NT$100 platform commission and deduct NT$930 from seller earnings (NT$900 product settlement plus NT$30 extra). The seller additionally bears return shipping. The NT$930 figure excludes that separate cost and any original shipping-subsidy adjustment. For example, refund completion deducts NT$930; a later admin adjustment charging NT$60 return shipping brings total deductions to NT$990. The buyer still receives NT$1,030. NT$60 is illustrative, not a configured or automatic charge.

The field does not identify which kind of shipping/fee is being refunded or whether the original seller shipping subsidy should be reversed. It does not automatically limit extras to the original shipping charge or allocate shipping across separate item refunds. This policy does not automatically refund original outbound shipping: reimbursement is chosen through the seller-funded extra amount. The future earnings ledger must enforce this funding rule; existing API support alone does not implement seller deductions.

### Original shipping reimbursement: once per original shipment

Agreed rule: repeated approved refunds for the same purchased product must not reimburse or charge the seller for the original shipment more than once. Scope this protection to the original shipment/delivery group, including different items sharing that shipment. A separate original shipment has its own eligibility. A product refund with no shipping reimbursement must not consume the one-time entitlement.

Example: the buyer paid NT$30 shipping for two units delivered together. The first completed unit refund includes NT$30 shipping in its extra amount. A later refund of the second unit must include NT$0 for that same original shipping. The first NT$30 is deducted from seller earnings once. Return shipping is a separate seller-funded cost; the once-per-original-shipment rule does not prohibit separately justified non-shipping compensation.

Implementation proposal: distinguish the original-shipping portion from other compensation within `extraRefundAmount`, while keeping the total extra seller-funded. Exact request field names and compatibility behavior remain to be designed; the existing generic amount alone cannot reliably identify duplicate shipping reimbursement. Reject a duplicate shipping claim rather than silently reducing an already-agreed buyer refund.

Use a stable original delivery-group identity, a persisted claim, and transaction-safe uniqueness/locking to prevent concurrent refunds from both claiming the same shipping. Reserve the claim at the agreed approval/processing stage, finalize it on completion, and release an unused reservation on cancellation/rejection. A completed claim remains consumed. The existing statuses and exact reservation transition need mapping during implementation. Payment/settlement retries must not repeat the buyer reimbursement or seller deduction. Missing historical shipment evidence requires reconciliation, not assuming eligibility.

Agreed seller-facing design: show a shipping summary in both refund list and detail, including buyer-paid shipping for this delivery group, reimbursement state, and the related refund reference/amount where applicable. Current responses expose whole-order `shippingCost` and `shippingCostDeduction`, not a dedicated per-delivery buyer-paid amount. Whole-order shipping must not be treated as the refundable amount for every item or seller. Enforce eligibility on the backend as well as disabling duplicate shipping selection in the UI.

Availability means the buyer paid shipping for this original shipment and no active reservation or completed refund has claimed its shipping reimbursement. Sellers should not have to inspect all earlier refunds to determine this.

Agreed new admin response object: add `shippingReimbursement` to each refund in `GET /api/admin/refund/list` and to the refund returned by `GET /api/admin/refund/{refundItemId}`. These fields are planned, not currently implemented:

```json
{
  "shippingReimbursement": {
    "buyerPaidAmount": "30.00",
    "status": "available",
    "canReimburse": true,
    "claimedByRefundId": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `buyerPaidAmount` | Decimal-string TWD amount paid for this original delivery group, not the whole order. For unknown historical amounts, use null rather than inventing zero. |
| `status` | `available`, `reserved`, `refunded`, `not_applicable`, or `needs_review`. |
| `canReimburse` | Server-calculated eligibility for this refund to claim original shipping; false for a competing reservation, completed claim, no buyer-paid shipping, or unresolved historical evidence. Existing refund editability/authorization must also be respected. |
| `claimedByRefundId` | Nullable refund UUID identifying the reservation or completed reimbursement, exposed only within the caller's authorized scope. |

The response is read-only eligibility information, not client authority to claim shipping. Distinguish this refund's own existing reservation for editing/retry; exact transition semantics remain to be finalized. Admin mutation field names for selecting shipping and entering other compensation remain open.

| State | Example seller-facing message | Control behavior |
| --- | --- | --- |
| Available | 買家支付運費 NT$30，尚未退還 | Allow selection of shipping reimbursement. |
| Reserved by another refund | 其他退款申請處理中 | Disable shipping selection; identify the claiming refund within authorized seller scope. |
| Already refunded | 運費已退還 NT$30 | Disable shipping selection; link to the completed refund. |
| No buyer-paid shipping | 買家未支付運費 | No original-shipping reimbursement is needed. |
| Historical data requires review | 運費退款紀錄待確認 | Do not assert availability; reconcile prior refunds/shipment evidence first. |

Agreed refund editor presentation:

- **退還原運費:** optional checkbox showing the buyer-paid amount for this shipment, enabled only when eligible.
- **其他額外退款:** seller-entered amount for other compensation.
- **額外退款合計:** sum of selected original-shipping reimbursement and other compensation; the full total remains seller-funded.

Persist the shipping/other-compensation breakdown in the API and accounting records. Exact field names and compatibility behavior remain to be designed. Recheck eligibility atomically when saving the claim; a stale UI must not permit duplicate reimbursement. Cancellation/rejection releases an unused reservation, but a completed shipping reimbursement remains consumed. The current refund's own reservation must remain distinguishable from a competing refund during editing/retry.

Legacy `extraRefundAmount` records do not identify whether the extra reimbursed shipping or other compensation. Do not infer this from the amount alone or automatically label the shipment available. Review ambiguous historical extras before enabling shipping reimbursement. Seller-funded return shipping remains distinct from original-shipping reimbursement and other extras; avoid recording the same expense under both categories.

### Platform-paid delivery (CVS)

Environment settings supply the standard shipping cost. Sellers may charge buyers less, including free shipping, and cover the difference. Calculate this per applicable delivery group, not per product item.

```text
Seller shipping subsidy = standard shipping cost - buyer shipping charge
```

Existing supported seller shipping settings enforce nonnegative prices capped at the configured standard.

### Confirmed outbound shipping adjustments

Retain the seller's original CVS shipping subsidy when the original logistics cost has been incurred, including full/partial product refunds and failed pickup. Do not proportionally refund shipment-level subsidies for partially refunded items. Reverse the subsidy only when the entire shipment is cancelled and it is confirmed that no logistics cost was incurred. Refund/cancellation status alone is not evidence of zero cost; implementation must establish a reliable cost-incurrence basis before posting a reversal. Preserve the underlying evidence and avoid double reversals.

Buyer-paid outbound shipping is returned only when the seller elects the once-per-shipment extra reimbursement. This is separate from subsidy reversal. Seller-paid home-delivery shipping remains credited to the seller; any buyer reimbursement goes through seller-funded extras. Return shipping is seller-funded under the latest decision; provider refund costs remain platform-funded and must not become seller deductions.

### Seller-paid home delivery

Sellers arrange/pay home delivery themselves. Credit the buyer's home-delivery shipping payment to the seller. Do not also deduct the standard home-delivery cost from platform settlement; that would charge the seller twice.

Home-delivery environment values act as default/maximum buyer shipping charges under the current settings, rather than automatic seller settlement deductions. Apply the same accounting to refrigerated home delivery when it is seller-paid. The seller's actual courier expense is external to the platform settlement amount.

### Settlement calculation before refunds and release holds

```text
Product earnings = product cash payment + product coins used / 10
Platform commission = product earnings * 10%

Seller net earnings = product earnings
                    - platform commission
                    - platform-paid shipping subsidy
                    + buyer shipping payments for seller-paid delivery
```

Examples for a NT$1,000 product:

| Delivery | Calculation | Seller settlement |
| --- | --- | --- |
| CVS, standard NT$69, buyer pays NT$30 | 1,000 - 100 - 39 | NT$861 |
| Home, buyer pays NT$60 | 1,000 - 100 + 60 | NT$960 |
| Home, free shipping | 1,000 - 100 | NT$900 |

For home delivery, the seller separately pays the courier. Settlement is not the seller's profit after external costs. A buyer surcharge, when configured, belongs entirely to the platform and does not alter these seller examples.

## Team revision: separate seller revenue wallet

This team revision supersedes the earlier weekly-settlement wallet-credit proposal. Do not deposit into or deduct from the existing seller/advertising wallet as a result of weekly revenue review. Create a separate revenue wallet for each seller.

The new wallet must support:

- Separate current coin-revenue and cash-revenue balances, with coins and TWD units explicit.
- Historical movements, including completed seller-requested withdrawals, sales, refunds, and fee/shipping adjustments needed to explain balances. The revenue wallet has no seller deposit-request feature. Separate admin-initiated accounting increases/decreases are authorized below, not bank deposits or payouts.
- Lifetime coin and cash earnings totals and totals within a selected week, month, or custom date range. The user's repeated “cash & cash” is interpreted as “coin & cash”, pending any correction.
- Seller access to their own balances/history and platform-admin access to selected sellers. Sellers initiate the supported wallet requests; admins review, may amend amounts, and make the final decision. Admins do not initiate ordinary deposit/withdrawal transactions, but may initiate the explicitly authorized revenue-wallet adjustments below.

Distinguish current balances from earnings flows: withdrawals reduce balances without reducing historical sales earnings; approved deposits into the existing wallet increase that wallet balance without being counted as product sales; they do not credit the revenue wallet. Preserve separate product-earnings totals before commission and the corresponding fee/refund breakdowns. Apply the agreed allocation and seller-selected withdrawal rules below.

Latest agreed direction: record verified paid sales and completed refunds immediately in the new revenue wallet. New net earnings enter pending availability immediately. Every day at 03:00 Asia/Taipei, automatically release eligible aged earnings within this same wallet under the fixed-hold policy below. This changes availability, not total funds; it is neither another revenue deposit nor a transfer into the existing advertising wallet. Weekly/monthly earnings reports remain independent of release scheduling.

Previously agreed principles remain: all verified paid sales are in scope regardless of delivery/refund-window status; the platform accepts refund advance risk; commission applies only to non-refunded product amounts; extras and return shipping are seller-funded. Payment confirmation and provider remittance into the platform bank account are distinct. Preserve seller debt rather than dropping a negative adjustment; apply the agreed debt-offset and withdrawal-blocking rules below.

### Automatic daily release and cash-flow protection

The team cannot separately decide a release date/amount for each seller. Replace the earlier manual weekly release suggestion with a fixed holding period and automatic daily release. Do not hide this week's sales or show only last week's earnings: revenue remains current, while withdrawal availability is delayed.

Confirmed holding and release policy: hold earnings for at least 14 elapsed days (336 hours) after verified payment, then release eligible remaining funds every day at 03:00 Asia/Taipei. At the scheduled cutoff, include payments confirmed at or before cutoff minus 14 days; younger earnings wait for a later run. Effective waiting time is at least 14 days and less than 15 days under the normal uninterrupted schedule. The user has finalized the duration and time; they are no longer open decisions. This records the chosen business policy, not an independent verification of ECPay remittance timing.

- Paid sale: record product earnings immediately; record corresponding net funds as pending after applicable fees/adjustments and debt offsets.
- Completed refund before release: reduce pending funds under the refund deduction order below. Do not release funds already consumed by refunds or debt repayment.
- Environment-specific hold: production and staging retain 336 hours (14 days). Explicit local/development environments use one tenth: 33.6 hours (33 hours 36 minutes, 1.4 days), following the existing refund-window acceleration convention in `src/lib/refundEligibility.ts` / `isLocalOrDevelopment`. Do not round to whole days or hours. Only the hold duration is shortened; the daily 03:00 Asia/Taipei schedule remains unchanged (`0 3 * * *` with explicit timezone). For local/development, the normal waiting interval is at least 33 hours 36 minutes and less than 57 hours 36 minutes (1.4 to under 2.4 days). Use cutoff minus the effective environment-specific duration for eligibility. Other/unspecified environments must not silently enable acceleration.
- This daily policy supersedes the previous Tuesday schedule. Existing refund windows are unchanged; use the same environment-selection convention for the new earnings hold, not the product's configurable refund duration. Schedule failures/delays can extend the waiting interval; the next run must catch up all eligible unreleased funds without double release.
- Each day at 03:00 Asia/Taipei: inspect all unreleased funds, not only the most recent seven days. Automatically move eligible remaining funds from pending to released once.
- Completed refund after release: deduct remaining funds and carry any uncovered amount as debt.
- Seller-requested revenue withdrawal: use released available funds only, never pending funds; admin review is required for the withdrawal request. Automatic daily release itself remains free of per-seller review. These are separate processes.

A fixed hold reduces risk but cannot prove that ECPay remitted funds or eliminate late refunds, especially for unlimited-refund products. Coin-derived earnings also require platform cash. Confirmed funding-delay policy: pause actual payout processing only. Revenue recording and daily release continue normally; sellers may still submit withdrawal requests. Keep unpaid requests pending rather than rejecting them solely because platform cash is delayed. Resume processing when funding is available. Do not introduce a platform-wide release freeze or disable requests for this case. Admins continue checking bank funds and handling actual transfers outside the system. A separate percentage reserve was discussed but is not an agreed requirement of this simplified fixed-hold scheme.

### Current balances, availability, and reconciliation

Use distinct labels for historical product earnings and current net wallet balances:

| Label | Meaning |
| --- | --- |
| 累計金幣收益／累計現金收益 | Product earnings less completed product-refund reversals, before commission; lifetime or clearly identified selected-period figures. Withdrawals do not reduce these totals. |
| 金幣餘額／現金餘額 | Current net funds remaining after applicable commissions, shipping adjustments, refunds, completed withdrawals, and debt offsets; no revenue-wallet deposit feature is currently planned. Units are coins and TWD respectively. |
| 待開放提領 | Net funds still within the holding period or otherwise not yet released, expressed in TWD equivalent. |
| 已開放提領餘額 | Released funds remaining, including fractional TWD. |
| 可提現金額 | Sum of withdrawable whole TWD cash and whole TWD redeemed from multiples of 10 released available coins; retain residuals in each original component. Zero when debt remains; a platform funding delay does not erase this eligibility or block submission, but may delay actual payment. |
| 待抵扣款項 | Outstanding seller debt, shown separately in TWD. |

For nonnegative current balances after offsets, pending and released funds partition the same funds:

```text
coin balance / 10 + cash balance = pending amount + released balance
released balance = whole-TWD withdrawable amount + retained cash/coin residual equivalent
```

Withdrawal reservations are confirmed: released balance equals unreserved withdrawable whole TWD + its retained cash/coin residual equivalent + reserved withdrawal value. Reservations stay inside released balance until a completed withdrawal debits them; do not double-subtract them.

The second equality describes normal unblocked, unreserved availability; a funding delay postpones actual payment without changing release eligibility or the underlying released balance. Historical pre-commission earnings do not satisfy these balance equations. Do not subtract completed withdrawals twice. For a signed net position including debt, reconcile as `pending + released - outstanding debt`; do not subtract the debt again from balances that already incorporate the same liability. Apply the agreed cross-currency policy below; exact fractional rounding and posting mechanics remain to be designed.

### Confirmed policy: no funds held for unfinished refunds

To avoid buyer refund requests being used to restrict seller funds, do not reserve or freeze earnings merely because a refund is requested, pending, processing, or approved but not completed. These events do not reduce balances, block daily release, block withdrawal requests, or create seller debt. Do not add a pending-refund reserve card or a refund-reserve shortfall.

Only refund completion posts the agreed product reversal, commission reversal, and seller-funded extra deduction. Apply the established original-transaction/other-released/other-pending deduction order; any uncovered amount becomes 待抵扣款項 and activates the agreed debt restrictions. Record these changes in the refund completion period. Cancellation/rejection of an unfinished refund has no earnings hold to release.

This accepts the possibility that the seller withdraws before a refund completes, consistent with platform advance risk. It does not change the 14-day hold, confirmed reservations for seller withdrawal requests, or the once-per-shipment shipping-reimbursement claim. A shipping claim prevents duplicate reimbursement, not access to seller funds. Completed refunds have priority over pending withdrawal requests, but must not consume reservations already in external payment processing, as specified below. Unfinished refund requests must not preempt either.

### Agreed seller debt presentation and recovery

Show an independent **待抵扣款項** card when debt is positive, explaining that completed refunds/other deductions exceeded available earnings. Do not disguise debt as a negative withdrawable amount. Hide the card when debt is zero.

Example display: 待開放提領 NT$0; 可提現金額 NT$0; 待抵扣款項 NT$400.

Suggested copy: 「已完成退款等扣款超過您的收益餘額，目前尚有 NT$400 待抵扣。後續淨收益將優先抵扣，抵扣完成前無法提領。」

Agreed deduction order:

1. Deduct the refunded transaction's own remaining earnings first, preserving original cash/coin attribution. Exclude funds already reserved for an external payment in progress.
2. For any shortfall, consume other released earnings before other pending earnings. Within each availability group, use cash first, then coins converted at 10 coins per TWD. Only the remaining uncovered amount becomes debt. Do not count the same amount twice; deterministic ordering among entries of the same group remains an implementation detail.
3. Record the uncovered remainder as debt. After all available offsets, do not retain positive usable funds alongside avoidable debt. Funds committed to an external payment already in progress are not usable for refund offsets and may temporarily coexist with debt.
4. Apply future net earnings to debt first. Ordinary revenue-wallet deposit requests remain out of scope, and deposits into the separate existing wallet must not automatically clear revenue debt. The newly authorized revenue adjustments are a separate accounting operation; increases clear debt first and release any excess immediately, as confirmed below. Only the excess from new sales enters pending availability under its own holding period. Debt repayment is neither a new sale nor another withdrawal.
5. Block withdrawals until debt is cleared. If a separate repayment mechanism is later needed, define it explicitly; do not treat an accounting adjustment as bank collection or enable automatic cross-wallet deductions.

Example: debt NT$400 plus new net sales earnings NT$600 clears the debt and creates NT$200 pending funds. The amount is net earnings, not gross product revenue before commission.

The debt detail shows source refunds/adjustments, original deduction, amount offset, and remaining debt. Recovery if a seller stops selling and any write-off policy are deferred operational topics, not first-version blockers. Keep debt, offset future earnings, and block new withdrawals; add no collection, automatic bank debit, or write-off workflow. Acceptance of platform advance risk is not debt forgiveness.

### Agreed coin/cash allocation and seller-selected withdrawals

- Product commission and product-refund reversal: allocate according to the original transaction's cash/coin payment proportions. For a NT$1,000 product paid with NT$900 cash plus 1,000 coins, deduct NT$90 cash and 100 coins as commission, leaving NT$810 cash plus 900 coins. A full product refund reverses these net seller earnings and the associated commission, subject to the remaining-funds/debt rules if already withdrawn. This describes seller accounting, not a change to buyer coin-refund eligibility.
- Seller shipping subsidies and extra refunds: denominated in TWD; deduct cash first, then equivalent coins if needed. Platform-advanced return shipping is recovered only through an explicit manual admin revenue adjustment, not an automatic refund charge. Do not include the same cost again in extraRefundAmount. Precise balance/debt posting for manual adjustments must follow the design noted below.
- Product-refund shortfalls: use the original transaction's remaining earnings first; then other released earnings, then other pending earnings, with cash before coins within each fallback group; only then create debt. This supersedes the earlier undecided ordering. Honor the payment-in-progress reservation exception below; deterministic entry ordering and precision are implementation details that must preserve this business priority.
- Withdrawals: the seller requests both the number of coins and the TWD cash amount to withdraw. The admin may explicitly amend the final coin/cash amounts during review. Preserve and show the original request and final amounts; do not apply automatic cash-first substitution or silently overwrite the request. Validate each final component against its own released available balance. No pending funds may be used, and outstanding debt blocks withdrawal.
- Coins selected for withdrawal are redeemed at 10 coins = NT$1; the cash payout equals selected coins / 10 plus selected cash. Example: 1,000 coins plus NT$400 cash yields NT$500 payout and debits exactly those two components, with no additional 10% commission.
- The seller now initiates a withdrawal request in the seller/admin-side product. The admin reviews the request, may amend amounts, and approves or rejects it. Only a seller-originated request can lead to a bank withdrawal. A separate admin accounting adjustment may debit revenue but does not initiate a bank payout. Actual bank payment remains external. This supersedes the earlier offline seller-choice/admin-initiation flow.
- Confirmed withdrawal units: cash must be whole TWD; coins must be multiples of 10 coins. Apply the same rules to seller requests and admin-final amounts. Either component may be zero, but the combined withdrawal must be positive. Reject invalid units with a correction message; never automatically round or substitute components. No additional minimum applies in the first version beyond these units and a positive combined amount.
- Preserve all residual value in its original cash/coin balance. Example: released NT$123.45 cash and 256 coins allow NT$123 plus 250 coins, paying NT$148 and retaining NT$0.45 plus 6 coins. These restrictions apply to withdrawal input, not internal earnings precision. Do not truncate each sale, fee, or balance movement to whole TWD/10 coins. Existing-wallet withdrawal cash follows the whole-TWD rule; existing-wallet deposits retain positive TWD amounts with at most two fractional digits.
- Maximum revenue withdrawal under normal, debt-free conditions is `floor(unreserved released cash) + floor(unreserved released coins / 10)` TWD. Do not floor the combined converted balance: fractions remain in their original components and cannot be combined to bypass input units. Total retained equivalent can therefore exceed NT$1 across the two components. Admin amendments must remain visible alongside the original request.

### Agreed revenue reporting policy

Provide current balances, lifetime product earnings, period product earnings, and filtered transaction history as distinct views. For each selected range, show product sales, completed product-refund reversals, and resulting net earnings separately for coins and cash; show commission, shipping, extras, and completed withdrawals separately. Keep requests and their decisions distinguishable from completed balance movements. Do not label all incoming balance movements as revenue.

Confirmed range ownership: the frontend chooses and supplies the reporting start/end times, whether for calendar weeks/months, rolling periods, or custom dates. The backend filters the supplied interval and must not substitute its own week/month range. Date labels and boundaries must agree between frontend and backend; document the precise interval inclusivity/time-zone contract during implementation. This reporting choice does not change the fixed daily release schedule.

Confirmed refund attribution: recognize completed refunds in the period when the refund completes, not the original sale period. A request, approval, or later note edit is not a new completed refund event. Product-refund reversals and their related commission/extra adjustments retain their separate classifications and use the completion event for period reporting. Preserve the original sale record and avoid restating it. Example: a sale paid in January and refunded in February remains January sales, with its refund adjustment reported in February. A refund-heavy period may legitimately have negative net earnings; this does not by itself mean the current wallet has debt.

### Existing wallet history: verified capability

The existing advertising/account wallet already supports:

- `GET /api/admin/account-wallet/me/transactions` for the signed-in account.
- `GET /api/admin/account-wallet/{accountId}/transactions` for platform admins selecting an account.
- Optional `page`, `limit`, `type`, `startAt`, and `endAt`; dates filter transaction creation time with inclusive bounds. Supply timestamps for the desired interval; there are no built-in week/month preset parameters.
- Transaction types: `legacy_opening_balance`, `admin_credit`, `advertisement_funding_debit`, and `advertisement_budget_return`.
- Paginated results ordered newest first, with amounts and before/after balances.

Existing wallet summary endpoints also accept date bounds, but summarize advertising-wallet cash flow, not product sales earnings. The current history does not imply an existing seller bank-withdrawal feature or the new revenue wallet. This revision preserves those current APIs.

## Environment settings inspected

All five files inspected (`.env`, `.env.local`, `.env.development`, `.env.test`, `.env.stg`) had identical fee values on 2026-11-13. These are repository configuration values, not verification of provider tariffs or deployed configuration.

| Setting | Value |
| --- | ---: |
| TRANSACTION_FEE_RATE | 0 |
| HOME_DELIVERY_FEE | 60 |
| HOME_DELIVERY_REFRIG_FEE | 160 |
| OKMARTC2C_LOW_TMP_DELIVERY | 160 |
| ECPAY_FAMI_SHIPPING_FEE | 60 |
| ECPAY_UNIMART_SHIPPING_FEE | 69 |
| ECPAY_FAMIC2C_SHIPPING_FEE | 69 |
| ECPAY_UNIMARTC2C_SHIPPING_FEE | 69 |
| ECPAY_HILIFEC2C_SHIPPING_FEE | 58 |
| ECPAY_OKMARTC2C_SHIPPING_FEE | 58 |

## Revised wallet request and admin-decision workflow

This decision supersedes the earlier admin-initiated ordinary deposit/withdrawal model and the exclusion of approval flows. The later manual revenue adjustment permission is a separate explicit exception. Sellers must initiate; admins review an existing request, may change its amount, and make the final decision. There is still no bank integration: admins verify and handle bank transfers externally. No extra multi-level approval or separate audit project is requested; normal request/decision and transaction history must show what happened.

| Wallet | Seller can request | Admin responsibility |
| --- | --- | --- |
| Existing account/advertising wallet | Cash deposit or cash withdrawal | Review the seller's request, amend the final amount if needed, approve or reject, and verify/handle external bank activity. |
| New revenue wallet | Withdrawal specifying coins plus cash | Review the requested composition, explicitly amend final coin/cash amounts if needed, approve or reject, and handle external cash payout. No deposit request is included. |

### Confirmed request lifecycle and permissions

- Seller-originated only: sellers submit/view their own requests; admins review existing requests, may explicitly amend final amounts, and approve/reject. No standalone admin-originated ordinary deposit/withdrawal. The separate revenue adjustment endpoint below is the explicit exception.
- Withdrawal business states: pending (待處理), payment in progress (付款處理中), completed (已完成), cancelled (已取消), rejected (已拒絕). Technical names remain an implementation choice. Approval to start external payment is the move to payment in progress; a mere funding delay leaves the request pending.
- Deposit requests do not credit balances. Admin confirms actual external receipt and final amount, then completes the request and credits the existing wallet together. Deposits do not need an outbound-payment state. Amounts must be positive TWD with at most two decimals.
- Withdrawal submission immediately reserves the requested available amount. In the revenue wallet, reserve cash and coins separately from released balances only. In the existing wallet, reservations must also prevent ad funding from spending those funds. A reservation reduces spendable/requestable funds, not total balance.
- Admin amount amendments occur while pending and may only retain or reduce the seller-requested amount, never increase it. Apply this to both existing-wallet deposits/withdrawals and revenue-wallet withdrawals. For revenue withdrawals, final cash and coin amounts must each be no greater than their original requested component; reducing one cannot authorize increasing the other. A reduced withdrawal releases the unused reservation. Preserve original request, final amounts, status, and explanation. For withdrawals enforce whole-TWD cash, multiples of 10 coins, positive total, and no additional minimum. Deposits retain positive amounts with at most two decimals. Reject rather than complete a zero-total request. No automatic currency substitution. Preserve the original request as the immutable upper bound; any additional amount requires a new seller request.
- Sellers may cancel their own pending requests only. Cancellation/rejection releases unused reservations. Do not allow arbitrary cancellation, rejection, amount changes, or release of funds after external payment has started; an uncertain external payment must be reconciled, not treated as unpaid by assumption.
- Admin checks funds and starts the external transfer, moving the request into payment in progress. Protect that reservation against concurrent refunds. Confirm actual external payment before completing the request and finally debiting its reserved amount, exactly once.
- Deposits remain in the existing wallet. Do not transfer them to revenue or automatically clear revenue debt. Automatic sale/refund entries and daily release are not discretionary admin deposits.
- First version shows request status, original/final amounts, and handling explanation in request history/detail. Proactive notifications are deferred. Funding delay copy may state: 「平台款項調度中，付款將延後處理。您的申請仍在處理中，不影響收益紀錄。」 State that 可提現金額 is eligibility to request, not an immediate-payment promise. No global pause switch or automated payment queue is introduced; admins handle external payment ordering.

### Confirmed completed-refund conflict policy

An unfinished refund never reserves funds or interferes with a withdrawal request.

For a completed refund competing with a pending withdrawal, the refund takes priority under the agreed debit order. If the remaining funds cannot support the pending request's full cash/coin composition, cancel the affected request with an explanation, release its reservation as required for the refund, and let the seller submit a new request. Do not silently resize or switch currencies. Implement cancellation, reservation adjustment, refund debit, and any resulting debt consistently so a concurrent admin cannot start paying an invalidated request.

If a withdrawal is already in payment in progress, do not consume its reservation. Debit other earnings and record uncovered refund value as debt. Finish and record the in-progress external payment truthfully even if a later refund creates debt; debt blocks new withdrawals/payment starts, not recording a payment already committed. This exception must be reflected in balance reconciliation. Existing-wallet reservations never become automatic sources for revenue-wallet refunds.

Keep ordinary request/decision history and linked completed transactions; duplicate requests/decisions must not repeat credits/debits. This is not a separate audit project or multi-level approval system.

### Admin-only manual revenue adjustment API

Confirmed requirement: allow a platform admin to increase or decrease a seller's new revenue wallet directly, without a seller-originated request. This is an accounting adjustment, not an ordinary deposit/withdrawal, seller approval flow, or bank transfer. It is not authorized for the existing advertising wallet and does not restore the old unrestricted account-wallet credit endpoint.

Implemented route: `POST /api/admin/seller-earnings/:sellerId/adjustments`. Request fields are `direction` (`increase` or `decrease`), `cash`, `coins`, `reason`, and `idempotencyKey`. See the FE contract for validation and precision; adjustments explicitly distinguish cash and coins.

- Platform admins only; seller/app callers cannot invoke it. Validate that the target is a seller and enforce one-time posting on retry.
- Record the amount, direction, reason, time, and resulting balances in ordinary transaction history. This adds no separate audit/approval workflow.
- Record these movements separately from sales, refunds, and withdrawals. They change wallet net funds, not historical product coin/cash sales totals, and incur no 10% commission. Expose them as separate adjustments in period reporting using the posting date.
- Manual return-shipping charge: admin calculates the total and explicitly posts a decrease. Refund completion must not independently debit that same shipping amount. A correction can use an explicit increase instead of rewriting the old movement.
- Confirmed adjustment allocation: admin explicitly enters coin/cash components. Increases clear debt first and release the remainder immediately, without a sales holding period or commission. Decreases consume the specified currency’s released funds, then its pending funds, followed by the agreed cross-currency offsets and debt rules. Cancel affected pending withdrawal requests when their composition can no longer be supported; preserve reservations for external payments already in progress. These independent accounting increases/decreases remain authorized; the request-review reduction-only rule does not prohibit them.
- No buyer Flutter request/response changes. This admin API is implemented; local and dev migrations are applied, while stg and production remain unchanged.

### Existing direct-credit endpoint transition

The current `POST /api/admin/account-wallet/{accountId}/credit` allows admin-originated credits and therefore conflicts with the revised product policy. During implementation, retire/block its standalone-credit behavior or replace it with completion of a valid seller-originated deposit request. Hiding a button alone is insufficient. Preserve existing balances and transaction history; new request history applies prospectively unless a historical mapping is explicitly defined. Coordinate admin frontend/API changes; buyer Flutter APIs remain unchanged. The standalone-credit endpoint now returns `410 WALLET_CREDIT_REQUIRES_REQUEST`; deposits use the seller request workflow.

## Card meanings after the team revision

- Coin earnings: lifetime or selected-period product coin earnings less completed product-refund reversals, before commission; show the separate current coin balance explicitly if displayed alongside it.
- Cash earnings: lifetime or selected-period product cash earnings less completed product-refund reversals, before commission; exclude existing-wallet deposits, buyer surcharges, and shipping collections. Show current cash balance separately.
- Withdrawable amount: derived from the new revenue wallet, never the existing advertising wallet. Apply the automatic daily release, pending/released split, retained fractions, and debt rules above; use the agreed allocation and seller-selected withdrawal composition above. Completed withdrawals reduce balances once. Pending/payment-in-progress request reservations reduce available-to-request funds without reducing total wallet balance. Preserve fractional value and display no negative withdrawable amount.

The new wallet's two current balances and historical earnings totals are distinct quantities. Label historical figures as 累計收益 or selected-period 收益, current funds as 餘額, and show 待開放提領、可提現金額 and positive 待抵扣款項 separately. Follow the reconciliation rules above.

## Flutter API compatibility requirement

Agreed constraint: preserve all Flutter-facing API contracts. This work must not require a Flutter app update. New shipping eligibility fields and shipping-selection inputs belong only to admin APIs; seller earnings/settlement endpoints are admin-side or internal.

- Preserve existing app paths, methods, request fields, response shapes/types, success/error envelopes, and buyer refund eligibility rules. Do not add required shipping or settlement inputs to app checkout/refund requests.
- Keep `shippingReimbursement` and internal seller ledger/claim fields out of app responses. Shared database/schema changes must not leak new columns through relation spreads or change existing app serialization.
- Preserve the existing buyer cash/coin refund calculation and the meaning of total `extraRefundAmount`; the admin-only breakdown determines funding and duplicate-shipping protection internally. A buyer can still receive a seller-approved extra through existing refund outputs, without a new app field.
- Seller revenue accounting must not change buyer refund windows, delivery eligibility, checkout surcharges, or app payment-status behavior.
- Before implementation is accepted, add/run focused contract regression checks for app refund creation, order/refund read paths, and affected shared serializers, alongside admin tests. Changes to shared internals are allowed only while preserving these public contracts.

Source check on 2026-11-13: `src/routers/refund.ts` exposes app refund creation through `createUserRefund`; refund list/detail/update routes are in `src/routers/admin/admin-refund.ts`. Controllers, services, repositories, schema, and nested order/refund data can still be shared, so route separation alone is not sufficient proof of compatibility. No runtime API changes have been made during this planning discussion; compatibility of future implementation must be verified by tests.

## Implementation design checklist

1. Save immutable seller-at-sale, item cash/coin allocation, conversion rate, commission policy, delivery payer, standard shipping cost, and buyer shipping charge. Calculate these server-side; environment/seller-setting changes must not rewrite old purchases.
2. Add a seller earnings transaction ledger with unique event keys for sale credits, refund reversals, release, and completed seller-requested/admin-decided withdrawals. Add request and decision handling for deposits/withdrawals in the existing wallet and withdrawals in the new wallet, with ordinary history and duplicate prevention. Add the separate admin-only manual revenue increase/decrease endpoint and history entries. Keep sales accounting distinguishable from advertising funding. Do not provide transfers from revenue to advertising funds in the first version.
3. Record sale credits atomically with verified payment settlement and reversals atomically with completed refunds. Use consistent locks and idempotency to avoid duplicate credits and refund/release races.
4. Implement immediate revenue/refund posting and retry-safe automatic daily release in the separate revenue wallet, using the finalized hold duration, without weekly transfers to the current wallet. Provide lifetime and period earnings reports alongside balances and transaction history. Record each sale/refund/adjustment once, support negative adjustments without losing debt, and keep buyer refund deadlines independent of seller accounting.
5. Add a seller-scoped summary API and admin-only selected-seller access, with decimal strings, pending amounts, retained remainder, rates, payout availability, and an `asOf` timestamp. Implemented route: `GET /api/admin/seller-earnings/summary`; admins provide `sellerId`, while sellers access their own summary.
6. Enforce the prospective launch boundary below. Preserve old transaction reads and existing-wallet balances, but do not backfill historical revenue or debit excluded sales through new refund entries. Review ambiguous historical shipping reimbursement records manually.
7. Update all relevant router, validation, controller, service, repository, schema, Swagger, and frontend handoff layers. Generate migrations only for the chosen environment when implementation is authorized.

Use exact arithmetic with sufficient precision for fractional coins, conversion, and fees. Specify deterministic allocation and rounding so item/seller totals reconcile to order totals. Preserve fractional funds rather than rounding away value per item or withdrawal.

Validation should cover mixed payments, multiple sellers, partial/extra refunds, repeated refunds for the same item and different items sharing a shipment, concurrent shipping reimbursement claims, reservation cancellation/rejection, completed-claim retry, separate shipments, duplicate callbacks, concurrent completed refunds/releases, no earnings holds or withdrawal blocks for unfinished refunds, zero/unlimited refund windows, delivery subsidies, seller-paid shipping, rounding, daily hold boundaries, local/development 33.6-hour scaling and staging/production 336-hour holds, exact cutoff inclusion, all-age pending selection, duplicate/missed release runs, debt offsets from earnings, seller/admin request permissions, explicit amount amendments, request completion replay, reservation competition with ad funding/refunds, blocked standalone admin credits, withdrawal blocking, balance reconciliation, prospective cutoff boundaries (including legacy refunds after launch), proof of no outbound-cost subsidy reversal, partial-refund subsidy retention, pending-withdrawal cancellation on refund, payment-in-progress reservation protection, and retry replay. Run `npm run build` and relevant payment, refund, coin, and wallet suites when code is implemented.

## Confirmed launch boundary and first-version scope

The user accepted the consolidated five-part proposal on 2026-11-14. The previously listed business decisions are resolved; this does not authorize runtime implementation or deployment.

- Include only orders whose verified payment is confirmed at/after the formal revenue-wallet launch cutoff. Record the exact cutoff during rollout preparation; order creation time does not determine inclusion.
- Old orders/refunds remain queryable, but do not generate new revenue-wallet opening balances automatically. Mark the new wallet's reporting coverage clearly and exclude unposted old transactions from its earnings aggregates.
- A post-launch refund of a pre-launch paid sale does not debit the new wallet because its sale was never credited there. Continue the existing/manual handling for that legacy case, without changing buyer refund eligibility or Flutter contracts. Enforce this scope for product and associated seller refund adjustments, avoiding mixed-scope debits.
- Any later historical import must reconcile sales, completed refunds, and prior payments together, not import sales alone. Historical import is not part of version one.
- Admin reviews ambiguous old shipping-reimbursement evidence before eligibility is granted; do not assume it has never been refunded.
- Keep buyer surcharges at 0%. Platform bears provider refund fees and advances applicable return shipping externally; recover return shipping through a separately calculated manual admin revenue adjustment only, never an automatic fee. No separate reimbursement application subsystem is required.
- No transfers between revenue and existing advertising wallets; no collection/bank-debit/write-off workflow for stopped sellers; no proactive notification delivery. Request status, amounts, and handling explanations are visible in the first-version product.

## Deferred operations and implementation details

The consolidated agenda decisions remain confirmed. The latest return-shipping revision replaces the automatic configured fee with admin-calculated manual revenue adjustments. No shipping-fee environment value is needed. Design the new adjustment API using the confirmed currency/availability/debt allocation; ordinary seller-request workflows remain intact. Other deferred topics are nonzero buyer-surcharge refunds, stopped-seller recovery, external return-shipping reimbursement operations, cross-wallet transfers, proactive notifications, and historical revenue import.

During implementation, resolve technical details against the confirmed rules: exact money precision and residual allocation, stable shipment/cost evidence, request field names and statuses, shipping-claim mapping, deterministic same-priority entry ordering, concurrency/retry recovery, and period-boundary serialization. Preserve existing buyer cash/coin refund calculations, including fractional cash conversion and expiry handling; new seller entries must reconcile without duplicating credits/debits. Any newly discovered business ambiguity should be surfaced rather than silently changing these rules. Exact launch timestamp belongs to rollout preparation, not a decision to backfill.

## Relationship to earlier plans

The [September withdrawal plan](ADMIN_SECTION_3_WITHDRAWAL_PLAN.md) contains earlier proposals, including a shared advertising/sales wallet and payout workflow. Those proposals are not approved merely by this discussion. This dated record governs the fee/delivery decisions above; the later confirmed request workflow and first-version boundaries in this document supersede conflicting older proposals. Its older source audit must be rechecked against current code before implementation.


## Advertising batch operations and automatic refill — 2026-11-17

Confirmed scope: add batch ad funding, batch activation/pause, and seller-configurable automatic refill to the plan. Planning only; no implementation or deployment is authorized. These operations use the existing advertising wallet, never the new revenue wallet.

### Batch operations

- Sellers select their own ads and increase their budgets, activate them, or pause them. “Inactive” means the existing ad status `paused`, not a new enum value.
- Confirmed funding input: one common amount per selected ad, or individual amounts. Show the total wallet debit before confirmation.
- Confirmed funding semantics: validate the entire batch and commit all funding atomically; insufficient spendable wallet funds or an invalid item causes no funding writes. Return item-specific validation reasons. Do not report partial funding success under this model.
- Confirmed status semantics: process each ad independently and report success/failure per ad; preserve existing activation checks and archived/closed restrictions.
- Each successful funding produces linked wallet debit and ad credit records. Use retry-safe identifiers and concurrency protection so repeated submissions cannot charge twice. Do not spend withdrawal-reserved funds.

### Automatic refill

- Confirmed amount model: the seller sets a **fixed amount per refill**, e.g. NT$500. This replaces the earlier target-balance suggestion. A balance of NT$80 plus a NT$500 refill becomes NT$580, not NT$500.
- Confirmed simplified settings per ad: only an automatic-refill switch and, when enabled, the fixed refill amount (default NT$500). Keep automatic refill off by default. The trigger is fixed at balance < NT$100, matching the existing display cutoff; balance exactly NT$100 does not trigger refill. Sellers cannot configure the trigger. This replaces the earlier daily-cap proposal; no daily refill cap is included in this design.
- Confirmed eligibility: only active/depleted ads attached to an active, non-deleted product. Do not automatically fund manually paused, archived, or financially closed ads, or ads belonging to an unavailable seller. Existing activation/availability rules still apply.
- Confirmed insufficient-funds behavior: require the full configured refill amount from spendable advertising-wallet funds; skip with a visible reason otherwise. No partial refill, overdraft, or use of revenue-wallet funds. Reserved withdrawal funds are unavailable.
- On success, debit the wallet and credit the ad atomically and record the automatic source/configured amount. A depleted ad can reactivate when the resulting balance satisfies existing activation rules; a manual pause must not be undone.
- Prevent duplicate refill for the same trigger/retry and concurrent manual funding/withdrawal races. Check settings, status, the balance < NT$100 condition, and spendable funds again when committing. Automatic refills count toward ad funding totals and period funding reports, not sales earnings.

### Confirmed operating rules

The user accepted these rules on 2026-11-17: fixed refill amount defaults to NT$500, minimum NT$100; use the confirmed event-driven triggers below instead of an every-minute polling job; prioritize ads that have waited longest for refill when wallet funds are limited. Keep a stable tie-breaker and recheck eligibility under concurrency. These are internal processing rules, not extra seller settings. Batch funding is all-or-nothing; batch activation/pause reports per-ad outcomes. Do not repeatedly refill the same qualifying event on retries. Manual revenue adjustment allocation is confirmed above. Exact field names, safe locking and deployment cutoff remain implementation/rollout details.

### Event-driven refill triggers (supersedes minute polling)

- After a successful video-completion ad debit, check the resulting ad balance. If below NT$100 and eligible for automatic refill, attempt the configured fixed wallet-to-ad funding.
- When a seller's advertising-wallet deposit request is completed and funds are credited, retry eligible waiting ads for that seller, prioritizing those waiting longest. A pending deposit request alone does not trigger funding.
- When the seller enables automatic refill or changes its amount while enabled, immediately check that ad. Disabling automatic refill must not trigger funding.
- Do not add a per-minute automatic-refill cron. Ad assignment alone does not incur the viewing charge; treasure-box opening can be delayed or never happen, so neither is the primary refill trigger. The separate daily 03:00 earnings-release schedule is unchanged.
- Insufficient funds leave the ad subject to existing depletion/display rules, with the reason recorded; do not undo a valid completed view solely because refill cannot proceed. Funding debit/credit must be atomic and retry-safe, with eligibility rechecked under concurrency so simultaneous view completions or duplicate deposit events cannot overfund the ad.
- Verify event integration and recovery during implementation: duplicate event delivery and retries must not duplicate either the original view debit/deposit credit or the refill. Preserve existing Flutter contracts; these triggers are backend behavior.

Implementation should extend existing admin-side funding/status workflows and ledgers, with matching validation, Swagger and FE documentation. Preserve Flutter contracts. Tests should cover authorization, mixed valid/invalid batches, insufficient funds, idempotent retries, reserved funds, fixed-amount refill with default NT$500, the strict NT$100 trigger boundary, paused/archived/product-inactive exclusions, event triggers after view debit, completed wallet deposit and settings updates, no refill on disabled settings or pending deposits, and concurrent batch/manual/automatic funding.

## Batch auto-refill configuration — 2026-11-18

Added `PUT /api/admin/advertisement/batch/auto-refill`: 1–100 distinct ads, common enabled flag and optional amount, per-item results using existing ownership rules. Omitted amounts preserve each existing setting or default to NT$500. Minimum NT$100; technical maximum NT$90,071,992,547,409.91, with no separately agreed business cap. Enabling can immediately trigger refill; saving a setting is distinct from successfully transferring funds. See the FE contract for payloads and retry behavior.
