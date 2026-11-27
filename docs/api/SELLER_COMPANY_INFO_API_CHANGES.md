# Seller company info and account access changes

Date: 2026-11-27

Seller accounts now support an optional related company-info record. Account API responses include `companyInfo`, and account lookup is restricted to platform admins or the account owner.

## API overview

All endpoints below require `Authorization: Bearer <access_token>`.

| Endpoint | Behavior and access |
| --- | --- |
| `GET /api/admin/account/me` | Returns the authenticated account, including its own `companyInfo`. Available during seller onboarding. |
| `GET /api/admin/account/{id}` | Returns a specific account. Only platform admins or that account's owner may access it; other callers receive `403`. |
| `GET /api/admin/account/list` | Platform-admin-only account list. Each seller entry includes its `companyInfo`. Existing filters and pagination remain supported. |
| `PUT /api/admin/account/update` | Updates an account, including optional seller `companyInfo`. Only platform admins or the account owner may update it. |

Specific-account lookup and updates require verified seller email and a completed seller profile. Company info itself is optional and is not an onboarding prerequisite.

Employees cannot read or edit their parent seller's company info through these endpoints. The nested `parent` account does not include `companyInfo`. Non-seller accounts return `companyInfo: null` on the account reads above.

## Company info fields

All editable fields are optional, nullable strings. Strings are trimmed; empty strings are rejected. Use `null` to clear a field. Bank codes and account numbers must be sent as strings to preserve leading zeros.

| Field | Validation |
| --- | --- |
| `companyName` | 1–200 characters |
| `taxId` | 1–32 characters; no additional tax-ID format validation |
| `companyAddress` | 1–500 characters |
| `contactName` | 1–100 characters |
| `contactPhone` | 1–50 characters; allows international prefixes and extensions |
| `bankName` | 1–100 characters |
| `bankCode` | Exactly three digits, such as `"004"` |
| `bankAccount` | 1–32 digits, such as `"001234567890"` |
| `bankAccountName` | 1–200 characters |

Saved records also return the server-managed `sellerId`, `createdAt`, and `updatedAt`. These fields cannot be supplied inside an update's `companyInfo` object. Unknown nested fields are rejected.

## Bank list for FE

```http
GET /api/admin/system/bank-list
Authorization: Bearer <access_token>
```

Returns the complete bank list without request parameters or pagination. Requires an admin-side account access token. Active platform admins, eligible sellers, and seller employees may access it. Sellers require verified email and a completed profile; employees require an eligible parent seller.

Response excerpt:

```json
{
  "success": true,
  "data": [
    { "code": "004", "name": "臺灣銀行" },
    { "code": "005", "name": "臺灣土地銀行" }
  ]
}
```

Map `code` to `companyInfo.bankCode` and `name` to `companyInfo.bankName`. Keep bank codes as strings.

## Save or update company info

```http
PUT /api/admin/account/update
Authorization: Bearer <seller_or_admin_access_token>
Content-Type: application/json
```

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "companyInfo": {
    "companyName": "Example Company",
    "taxId": "12345678",
    "companyAddress": "Taipei, Taiwan",
    "contactName": "Oscar",
    "contactPhone": "0912345678",
    "bankName": "Example Bank",
    "bankCode": "004",
    "bankAccount": "001234567890",
    "bankAccountName": "Example Company"
  }
}
```

The body still requires the target account's UUID in `id`. A seller supplies their own account ID. Platform admins may supply another seller's ID. Supplying company info for a target whose resulting role is not `seller` returns `400`.

The first update creates the related record. Later updates patch only supplied fields. Omitting `companyInfo` leaves the record unchanged; an empty object (`{}`) is rejected.

For example, change the contact phone and clear the contact name while preserving all bank fields:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "companyInfo": {
    "contactPhone": "+886-2-12345678 ext 9",
    "contactName": null
  }
}
```

To remove the entire company-info record:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "companyInfo": null
}
```

## Response shape

Successful reads and updates keep the existing account response and add `data.companyInfo`. The following is an excerpt; existing account fields remain present:

```json
{
  "success": true,
  "data": {
    "id": "33333333-3333-4333-8333-333333333333",
    "role": "seller",
    "companyInfo": {
      "sellerId": "33333333-3333-4333-8333-333333333333",
      "companyName": "Example Company",
      "taxId": "12345678",
      "companyAddress": "Taipei, Taiwan",
      "contactName": "Oscar",
      "contactPhone": "0912345678",
      "bankName": "Example Bank",
      "bankCode": "004",
      "bankAccount": "001234567890",
      "bankAccountName": "Example Company",
      "createdAt": "2026-11-27T04:00:00.000Z",
      "updatedAt": "2026-11-27T04:00:00.000Z"
    }
  }
}
```

If no company info has been saved, or the record was removed, `companyInfo` is `null`. A saved record may contain nullable fields. Passwords and internal credential revisions remain excluded from public account responses.

## Access and errors

| Status | Relevant conditions |
| --- | --- |
| `400` | Invalid UUID or company-info fields, empty company-info object, unknown nested fields, or company info supplied for a non-seller target |
| `401` | Missing, invalid, expired, or revoked authentication |
| `403` | Account lookup/update by someone other than the owner or a platform admin; employee access to a parent seller; unmet account eligibility requirements |
| `404` | Target account does not exist, when the caller is authorized to perform the lookup/update |

Specific-account lookup checks owner/admin authorization before fetching the target. An unauthorized caller receives `403` even when the target ID does not exist. The list route remains protected by `isAdmin`; specific-account lookup enforces admin-or-owner authorization in the service.

## Database and migration

- New table: `seller_company_info`.
- `seller_id` is both the primary key and a foreign key to `accounts.id`, allowing at most one record per account.
- Editable fields are nullable text columns. Timestamps are managed by the server.
- Physical deletion of the owning account cascades to the company-info record. Existing account soft deletion does not physically delete the record.
- Account updates and company-info writes run in one transaction, locking the account row before validation and mutation.
- Existing sellers are not backfilled; they return `companyInfo: null` until details are saved.

Generated migrations:

- Local: [`drizzle/local/0126_military_captain_universe.sql`](../../drizzle/local/0126_military_captain_universe.sql).
- Development: [`drizzle/dev/0076_powerful_jubilee.sql`](../../drizzle/dev/0076_powerful_jubilee.sql).

Local and development migrations were applied successfully on 2026-11-27 with `npm run db:migrate:local` and `npm run db:migrate:development`. The development migration was generated with `npm run db:generate:development` and reviewed before applying; it only adds the company-info table and its foreign key. No staging or production migration was generated or applied as part of this change. Before deploying elsewhere, generate and review the migration for the intended environment, then apply it before running code that reads the new relation.

## Validation completed

- `npm run build` — passed.
- `npm run test:account-onboarding` — passed against a disposable test database.
- `git diff --check` — passed for the implementation changes.

Integration coverage includes owner/admin reads, cross-seller read/write denial, employee denial, parent-response privacy, seller-only writes, input validation, partial updates, field clearing, record removal, leading-zero preservation, and company info in the admin account list.

Swagger schemas and endpoint documentation were updated in `src/routers/admin/admin-account.ts` and are available through `/api-docs`.
