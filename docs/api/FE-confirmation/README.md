# FE confirmation package

Last updated: 2026-09-17

This folder is the frontend handoff package for the current backend changes.
It includes both admin-web contracts and the app/Flutter coin-ledger changes so
the complete package can be shared at once.

Swagger at `/api-docs` is the executable reference for `/api/admin/**` APIs.
The Markdown files below explain business rules, migration from older FE route
names, and non-admin app behavior that is intentionally absent from Swagger.

## Current status

| Scope | Status | FE action |
| --- | --- | --- |
| Original checklist Section 1 | Implemented and tested | Migrate to the documented canonical routes. |
| Original checklist Section 2 | Implemented and tested | Apply the confirmed request, auth, permission, and response changes. |
| Coin ledger and refund changes | Implemented and tested | Update admin accounting/refund screens and Flutter ad/treasure-box handling. |
| Original checklist Section 3 — seller withdrawal | **Pending** | Do not integrate or expose withdrawal UI yet; no withdrawal API exists. |

Section 3 remains pending because seller settlement timing, late refunds,
fees, bank verification, historical balances, and payout execution still need
business decisions. Its engineering proposal remains outside this FE package
at `docs/plans/ADMIN_SECTION_3_WITHDRAWAL_PLAN.md`.

## Admin web FE — recommended reading order

1. [Original confirmation checklist](ADMIN_FE_CONFIRMATION_CHECKLIST.md) —
   status of Sections 1–3 and replacements for old route names.
2. [Section 1 API update](ADMIN_SECTION_1_UPDATE_2026-09-16.md) — subaccounts,
   categories, product deletion, dashboards, reports, wallet summaries, and
   sidebar counts.
3. [Section 2 API update](ADMIN_SECTION_2_UPDATE_2026-09-16.md) — authentication,
   registration, avatar, account filters, ad permissions, shipping fee, and
   push notification changes.
4. [Account wallet and ad funding](ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md) —
   exact wallet amounts, admin credits, idempotency, and wallet-to-ad funding.
5. [Coin ledger and refund update](ADMIN_COIN_LEDGER_REFUND_UPDATE_2026-09-15.md) —
   ad accounting, lifecycle, seller returns, financial close, balance
   transfer, and refund changes.
6. [Detailed admin refund API](ADMIN_REFUND_API.md) — complete refund request,
   update, logs, fractional-TWD conversion, and response fields.

## Flutter/app FE

1. [Inactive product and variant update](FLUTTER_INACTIVE_PRODUCT_VARIANT_UPDATE_2026-09-17.md) —
   product availability, automatic cart cleanup, collection behavior, and
   checkout error handling.
2. [Flutter coin-ledger API changes](FLUTTER_COIN_LEDGER_API_CHANGES.md) — ad
   assignment, video completion, treasure-box deadlines, order coin use, and
   refund behavior.
3. [Flutter API enums](FLUTTER_API_ENUMS.md) — shared enum values and client
   model guidance.

## Important boundaries

- Admin Swagger intentionally exposes only `/api/admin/**` endpoints.
- Flutter/app endpoints are documented here rather than added to admin
  Swagger.
- Currency and coin-ledger decimal strings must not be converted through
  JavaScript floating-point arithmetic for accounting calculations.
- Existing `/ad-revenue/*` route names were not recreated. Use the documented
  `/account-wallet/*` and `/advertisement/*` replacements.
- Seller withdrawal remains unavailable; the reserved
  `/ad-revenue/withdrawal` and `/ad-revenue/withdrawals` routes do not exist.

## Verification

The implemented Sections 1 and 2, wallet/ad funding, admin refund, coin-ledger
API flow, and scheduled accounting jobs are covered by the disposable
PostgreSQL suite run through `npm test`.
