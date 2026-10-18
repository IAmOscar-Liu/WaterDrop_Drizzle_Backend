# Seller two-step registration and email verification — FE handoff

Date: 2026-10-18 (Asia/Taipei).

Status: **implemented; owner-run migration, mail configuration and coordinated FE/backend rollout are required**. This document does not confirm deployment availability. It is the dedicated handoff for seller onboarding, email verification and confirmed email changes. Admin Swagger documents these endpoints; Flutter app-user authentication is unchanged.

Password recovery, signed-in password changes and refresh-token rotation remain in the [password recovery and login-session handoff](SELLER_REGISTRATION_AND_PASSWORD_RECOVERY_API_CHANGES.md). The combined [backend plan](../../plans/SELLER_TWO_STEP_REGISTRATION_PLAN.md) remains available for implementation context.

The registration form has two stages: credentials and seller profile. Email verification is an additional access requirement between them in the recommended FE journey:

```text
Register email/password → verify email → complete seller profile → enter backend
Existing seller login → check current verification/profile state → finish only missing steps
```

## FE screens and routing

Provide a registration form, an authenticated verification-pending screen, a `/verify-email` link-confirmation page, and a profile-completion form. The pending screen may share the `/verify-email` route; the pending screen needs no email-link token. The same confirmation page handles ordinary verification and confirmed email changes.

After registration/login, use `data.user`. On reload, tab focus or a return from another browser, fetch `GET /api/admin/account/me` with the access token; its account is in `data`. These responses are authoritative; do not derive onboarding state from the JWT or from local assumptions.

| Account state | FE action |
| --- | --- |
| Seller, `isEmailVerified === false` | Show verification pending, regardless of profile state. Delay business API calls and SSE. |
| Seller, verified but `isProfileComplete === false` | Show profile completion. Delay business API calls and SSE. |
| Seller, verified and profile complete | Enter the seller backend and start authorized business requests/SSE. |
| Platform admin or employee | Keep the role's normal navigation; do not require their own seller profile/email verification. An employee's business access still depends on the parent seller. |

If an employee receives `ACCOUNT_EMAIL_UNVERIFIED` or `ACCOUNT_PROFILE_INCOMPLETE`, explain that their seller/owner must finish onboarding. Do not send the employee through their own verification/profile form as a workaround. Invalid/inactive/deleted account errors remain separate from onboarding.

### New seller: register, verify, complete profile

1. Submit email/password to `POST /api/admin/account/register` using credentials-enabled requests for the refresh cookie. Keep the returned access token and user in the existing FE auth state.
2. Show **「請驗證電子郵件」**, the returned email address, and **「重新寄送驗證信」** / **「我已完成驗證」** actions. Registration already attempts the first email; do not immediately call resend or promise inbox delivery.
3. The user opens the email link, authenticates if necessary and confirms through the link flow below.
4. Merge the successful verification response into cached account state. If the profile is incomplete, show the profile form and POST `/complete-profile`; otherwise enter the backend.
5. Start business API requests and streams only once both conditions are satisfied. Ordinary verification/profile completion does not require another login.

Legacy full-form registration can skip the profile form after verification, because `isProfileComplete` is already true. It cannot skip email verification. On duplicate-email 409, offer login/password recovery; do not overwrite or repeatedly register the existing account.

### Existing seller: login and verify

1. Log in normally or restore the session, then evaluate the same account fields above. Existing sellers do not register again.
2. If unverified, show **「請驗證電子郵件」**, their current email and **「寄送驗證信」**. Login and `/me` do **not** send a verification email automatically.
3. On the user's action, call the authenticated resend endpoint with `{}`. Show **「驗證信已送出，請查看信箱」** after success, explaining that inbox arrival may take time.
4. After verification, use `isProfileComplete` to decide whether the profile form is still needed. Existing complete profiles do not need to be filled out again. A valid profile with a null completion timestamp still needs explicit completion or the owner-run profile backfill.
5. On **「我已完成驗證」**, or when the original tab regains focus, refetch `/me` and apply the same routing rules. Receiving email or opening its link alone is not proof that verification committed. No polling stream is provided for onboarding state.

Existing sellers must verify after the migrated backend is deployed. There is no email-verification backfill or legacy-account exemption. If the address has a typo or is inaccessible, use the password-confirmed email-change flow below while signed in; do not use generic profile update to edit it.

### Email link: parse, authenticate, explicitly confirm

1. Parse `token` and `purpose` from `window.location.hash` with `URLSearchParams`. Supported purposes are `verify` and `change`. Missing/malformed input should show a pending/help state, not submit an empty token.
2. Capture the values in memory and remove the fragment with `history.replaceState`. Keep tokens out of analytics, logs, persistent storage and login redirect query strings. If a full navigation/reload discards in-memory state, ask the user to reopen the email after login.
3. Wait for auth initialization. If unauthenticated, show normal login. For a pending email change, the old address remains the login identity until confirmation. If already signed into a different account, offer an explicit account switch; never silently change accounts based on an email link.
4. Show a **「確認驗證」** button for `verify`, or **「確認變更電子郵件」** for `change`. Disable the button while its request is in flight; do not submit on page mount, GET, or email preview.
5. For `verify`, POST `{ "token": "..." }` to `/api/admin/account/verify-email`. For `change`, POST it to `/api/admin/account/confirm-email-change`. Both require the matching account's bearer access token.
6. Ordinary verification returns the updated account in `data`. Email-change confirmation instead returns `data.requiresLogin: true`, revokes sessions and requires FE to clear auth/cache state and log in using the new email.

The server checks token purpose and account identity independently; a fragment value never authorizes another account. Verification-token errors do not disclose the expected account's identity.

### Expired link, resend, or missing email

A link expires after **30 minutes**. The server returns `400 EMAIL_VERIFICATION_TOKEN_INVALID` for expired, consumed, revoked, wrong-account, wrong-purpose or otherwise invalid links; FE cannot infer which case from that code alone.

For ordinary verification, refetch `/me` first after a used/uncertain link result. If already verified, proceed normally. Otherwise show **「驗證連結已失效或無法使用，請確認登入帳號或重新寄送驗證信」** and a resend button:

```http
POST /api/admin/account/resend-verification-email
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{}
```

Use the account's configured default FE page unless another approved callback is specifically needed. Do not send an email/account ID. Require login if the session is unavailable. Do not re-register to request another email.

Resending replaces previous links of the same purpose. Tell the user **「請使用最新一封驗證信」**. Disable repeated clicks and show a 60-second initial cooldown after registration/send; hourly limits may still block sending. On any 429, honor the actual `Retry-After` header (currently a conservative 3600 seconds), even if the FE's shorter countdown has ended. Do not run automatic resend retries on page focus, login or a timer.

For an expired `purpose=change` link, request a fresh change through `/request-email-change` with the new email and current password. The ordinary resend endpoint only verifies the current address and will not resend a pending change link. Confirmation may have already succeeded after a lost response; return to normal login/recovery rather than replaying a possibly committed email change.

On send failure, keep the user on the pending screen, preserve the account session and allow a deliberate retry after cooldown. An older link may already have been revoked. Opening the newest email in another browser still requires authentication to the same account.

### FE error interception and acceptance checks

Treat `403 ACCOUNT_EMAIL_UNVERIFIED` and `403 ACCOUNT_PROFILE_INCOMPLETE` as onboarding navigation, not access-token expiry. Stop pending business requests/SSE and avoid Axios refresh/retry loops. Use the existing coordinated refresh mechanism only for ordinary access-token expiry; definitive session invalidation requires login. See the [session handoff](SELLER_REGISTRATION_AND_PASSWORD_RECOVERY_API_CHANGES.md#refresh-token-rotation-extension) for cross-tab rotation requirements.

Before rollout, FE should exercise: email/password-only registration; full-form registration; an existing unverified seller; an already-verified incomplete profile; a token opened while signed out or in the wrong account; expiry/resend/old-link rejection; mail failure; 429 backoff; verification in another tab; typo correction through email change; and successful email-change logout. Confirm business requests/streams begin only after all required states pass.

## Two-step registration

Keep using `POST /api/admin/account/register`.

```json
{"email":"seller@example.com","password":"Valid-password-123!"}
```

Email/password only creates an active seller with an incomplete profile. The response remains `{success:true,data:{user,token}}` with an HTTP-only refresh cookie. Roles/status/completion fields supplied by the caller cannot grant access.

**Existing full registration remains supported:** send `name`, `realName`, `phone`, and optionally `address` with email/password. A valid full profile completes the profile immediately; email verification is also required before business access. Partial profile groups, or address without the required profile group, return 400. Duplicate email returns 409 and does not overwrite the account. Account/wallet creation is atomic.

Account responses now include:

```json
{
  "role": "seller",
  "name": null,
  "realName": null,
  "phone": null,
  "isEmailVerified": false,
  "emailVerifiedAt": null,
  "isProfileComplete": false,
  "profileCompletedAt": null,
  "missingProfileFields": ["name", "realName", "phone"]
}
```

The additions appear in registration/login `data.user`, `/account/me`, and profile-completion responses. After completion, `isProfileComplete` is true and `missingProfileFields` is empty. Admin/employee accounts are not subject to their own seller-onboarding form; employee business access still requires an eligible parent seller. Do not use role changes to implement onboarding.

Call the new authenticated endpoint:

```http
POST /api/admin/account/complete-profile
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{"name":"水滴商店","realName":"王小明","phone":"0912345678","address":"台北市"}
```

`name`, `realName`, `phone` are required; address is optional. The current real-name rule remains ECPay weighted length 4–10 with no emoji; phone is 10 digits beginning with `09`. Account ID comes from authentication. Unknown body fields are rejected. Response: `{success:true,data:<updated account>}`. An identical retry is safe; different profile data after completion returns 409 and must use the existing profile-update endpoint. Existing access tokens can use business APIs once both email verification and profile completion succeed; a second login is unnecessary.

## Protected APIs and FE behavior

Incomplete sellers can log in, refresh/logout, fetch their own `/account/me`, complete their profile, and use the signed-in change-password action. Public recovery endpoints are also available. Email verification is checked first (`403 ACCOUNT_EMAIL_UNVERIFIED`). After verification, business APIs retain their existing permissions and reject incomplete sellers with:

```json
{"success":false,"statusCode":403,"code":"ACCOUNT_PROFILE_INCOMPLETE","message":"Please complete your seller profile."}
```

This covers products, ads, wallet, orders, refunds, delivery, chat REST/SSE, dashboard, sidebar notifications, file uploads and employee management. The ordinary profile-update endpoint is not an onboarding exception. Existing `isAuth` checks the current database completion state; it also recognizes account tokens on shared authenticated routes, such as file upload. Invalid/inactive/deleted accounts are still denied on authentication-only exceptions.

After login or `/me`, route unverified sellers to email verification, then incomplete sellers to the profile form. Delay business requests and streams until both gates pass. An Axios response interceptor should handle `403 ACCOUNT_PROFILE_INCOMPLETE` by opening onboarding, **without retrying token refresh**. Resume normal requests after updating the cached user from completion.

Only platform admins may change role/status through the account-update API. Completed seller profiles cannot have required fields cleared. Direct account-email edits now return 409; use the confirmed email-change flow below. Confirmation invalidates sessions and pending recovery/verification links.

## Seller email verification and confirmed email changes

### Registration and access

The existing registration request and `{success:true,data:{user,token}}` response are preserved. Registration creates an unverified seller, even if the full profile is provided. A verification email is attempted after account creation; SendGrid failure is logged and the account/session remains usable for onboarding and resend. An invalid/missing verification-page configuration returns 503 before account creation. Success does not guarantee inbox delivery. There is no durable email delivery queue.

Account responses include `emailVerifiedAt` (UTC timestamp or null) and derived `isEmailVerified` in registration/login `data.user`, `/account/me`, profile completion and verification. Caller-supplied verification/profile-completion fields never grant access. Profile completion does not verify email, and password reset does not mark an unverified email as verified.

```json
{
  "role": "seller",
  "isEmailVerified": false,
  "emailVerifiedAt": null,
  "isProfileComplete": true,
  "profileCompletedAt": "2026-10-18T01:00:00.000Z"
}
```

Business access requires an active account, a valid session, verified seller email, a completed seller profile and the existing role/scope permissions. The current database state is checked by `isAuth` and shared seller-scope helpers, including account-token use on shared routes such as uploads and SSE access revalidation. Employees require an eligible parent seller. Own-email verification is not mandatory for platform-admin or employee business access; they may still verify/change their own addresses through these endpoints. App-user authentication is unchanged.

Unverified/incomplete sellers can log in, refresh, log out, use `/account/me`, complete their profile, change/recover their password, and use all four endpoints below. The ordinary account-update route remains a business route. Inactive/deleted accounts cannot use these authentication-only exceptions. No broad `/account/*` exemption exists.

If both verification and profile completion are missing, verification is reported first:

```json
{"success":false,"code":"ACCOUNT_EMAIL_UNVERIFIED","message":"Please verify your email address."}
```

This is HTTP 403. FE should show verification, then the profile form, and start business requests/streams after both pass. Handle `ACCOUNT_EMAIL_UNVERIFIED` and `ACCOUNT_PROFILE_INCOMPLETE` without token-refresh loops. Verification alone does not create a new session or change refresh-token rotation. Existing sessions can continue after ordinary verification.

### Endpoints

All four endpoints require `Authorization: Bearer ACCESS_TOKEN` for an active backend account and its valid session. Account identity comes from authentication. Unknown body fields are rejected. Responses use `Cache-Control: no-store`.

| Method / endpoint | Body | Successful `data` |
| --- | --- | --- |
| POST `/api/admin/account/resend-verification-email` | `{}` or optional `{ "callbackUrl": "APPROVED_PAGE_URL" }`; no recipient field | `{ "message": "Verification email accepted for delivery." }`, or an already-verified acknowledgement without another email |
| POST `/api/admin/account/verify-email` | `{ "token": "EMAIL_VERIFICATION_TOKEN" }` | Updated account, including verification/profile fields; no password or internal credential revision |
| POST `/api/admin/account/request-email-change` | `{ "newEmail": "seller@example.com", "password": "CURRENT_PASSWORD", "callbackUrl": "OPTIONAL_APPROVED_PAGE_URL" }` | `{ "message": "Check the new email address to confirm the change. Your current email remains active." }` |
| POST `/api/admin/account/confirm-email-change` | `{ "token": "EMAIL_CHANGE_TOKEN" }` | `{ "requiresLogin": true, "message": "Email changed. Please log in with your new email address." }` |

`newEmail` is at most 320 characters, `password` 1–256 characters, `callbackUrl` at most 2048 and `token` at most 256. The backend also checks the actual random-token format. Login/email uniqueness retains the existing exact-case identity policy; no automatic case-insensitive merging is introduced. Rate-limit destination keys normalize casing separately.

### Email links and FE handling

Mail uses the existing 水滴 sender/logo with click/open tracking disabled:

- Ordinary verification: **水滴｜驗證電子郵件**.
- New-address confirmation: **水滴｜確認變更電子郵件**.
- After an email change commits, a best-effort **水滴｜電子郵件已變更** alert is sent to the old address. Alert failure does not undo the change.

Both link types expire after **30 minutes** and are single-use:

```text
https://dev.waterdropping.com/verify-email#token=OPAQUE_RANDOM_TOKEN&purpose=verify
https://dev.waterdropping.com/verify-email#token=OPAQUE_RANDOM_TOKEN&purpose=change
```

FE reads `token` and `purpose` from the fragment, removes them from visible browser history and keeps them out of analytics/logs/local storage. Do not put the token in login redirect query strings. Require an explicit confirmation action; GET/page loads must never consume it. A reload after removing the fragment requires reopening the email link.

Wait for account initialization before confirmation. If no account session exists, ask for normal login first. For `purpose=change`, use the **old address** to log in until the change commits. The authenticated account must match the link; a link never logs in or switches accounts. `purpose` helps FE choose the endpoint only; the backend independently checks the stored token purpose.

For `purpose=verify`, POST to `/verify-email`, merge the returned account, then show profile completion or enter the backend. Used tokens return an error on retry; after an uncertain response, refetch `/me` to see whether verification succeeded. Another account's token receives the same generic invalid-token response as an unknown token.

For `purpose=change`, POST to `/confirm-email-change`, clear FE auth/cache state and return to login with the new address. All sessions, including other devices and open admin SSE sessions, are invalidated. The current refresh cookie is cleared. Do not automatically refresh/retry confirmation after success or an uncertain network result; return to normal login/recovery. Password, role, status, profile and wallet remain unchanged.

### Resending, email corrections and concurrent requests

A resend invalidates outstanding tokens of the same purpose. Ordinary resend does not cancel a pending email change, and requesting a new address does not prevent verification of the still-current address. Successfully confirming either purpose revokes all remaining verification/change links for that account. Resends are explicit; login does not automatically send another email.

The current email remains the login/recovery address until new-address confirmation commits. This also lets unverified sellers correct a typo using their current password. The proposed address is stored only in the verification-token record, not as a replacement account email or returned pending-email field. A new address is not reserved merely by requesting it. If another account claims it before confirmation, return 409 and roll back every mutation, including session revocation.

Direct changes through `PUT /api/admin/account/update` now return `409 ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION`, including platform-admin attempts to edit another account's email. Sending the unchanged email remains allowed. Use the own-account request/confirmation flow; no administrative verification bypass is added.

Password changes/resets and supported status/role changes revoke outstanding email-verification/change tokens. Token consumption checks the account, current email snapshot, credential revision and active session again inside the transaction. Disabling an account prevents consumption; subsequently reactivating it does not restore links revoked by that update.

### Errors and limits

| HTTP / code | FE handling |
| --- | --- |
| 400 validation envelope / unapproved callback URL | Correct input or omit callbackUrl to use the configured page. |
| 400 `EMAIL_VERIFICATION_TOKEN_INVALID` | Malformed, expired, used, revoked, wrong-account, wrong-purpose or stale-email/credential token. Offer the appropriate resend/request-change action. |
| 401 `ACCOUNT_SESSION_INVALID` / existing auth errors | Reauthenticate as appropriate; token possession does not bypass session checks. |
| 403 `ACCOUNT_EMAIL_UNVERIFIED` | Show seller email verification; do not refresh-loop. |
| 403 `EMAIL_CHANGE_PASSWORD_INVALID` | Correct the current password; limits still apply to failed attempts. |
| 403 account unavailable | Account is inactive/deleted; no onboarding exception. |
| 409 `ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION` | Use request-email-change/confirm-email-change instead of direct profile edits. |
| 409 `ACCOUNT_EMAIL_UNAVAILABLE` | New email is already used; current address remains unchanged. |
| 429 `EMAIL_VERIFICATION_RATE_LIMIT` | Respect `Retry-After: 3600`; conservative retry delay covers the hourly counters and cooldown. |
| 503 `EMAIL_VERIFICATION_DELIVERY_FAILED` | Account/current email retained; request a fresh link after cooldown. Previous links may already have been revoked. |
| 503 configuration error | Backend must configure approved verification URLs. |
| 500 generic operation failure | Do not assume the operation committed; check account state or use normal login/recovery. |

Limits use shared PostgreSQL counters across API instances:

| Operation | Limits |
| --- | --- |
| Public registration | 20 attempts/hour/IP |
| Initial verification send and resend | 5/hour/account, 60-second cooldown; resend additionally 20/hour/IP |
| Request email change | 20/hour/IP, 5/hour/account and 5/hour/normalized destination; account/destination cooldown 60 seconds |
| Verify or confirm email change | Shared 60/hour/IP and 60/hour/account |

Shape-invalid requests are rejected before service counters. Accepted attempts count even when business validation/delivery later fails. Already-verified resends are rate-limited no-ops. Express currently uses its direct peer IP; configure trusted reverse-proxy hops deliberately before rollout rather than trusting arbitrary forwarding headers.

### Configuration and owner-run migration

These settings were added to the existing environment files, preserving their aligned layout and other values:

| Environment | `ACCOUNT_EMAIL_VERIFICATION_URL` |
| --- | --- |
| local | `http://localhost:3000/verify-email` |
| development | `https://dev.waterdropping.com/verify-email` |
| staging | `https://stg.waterdropping.com/verify-email` |
| test | `http://localhost:3000/verify-email` (isolated suites supply a test page) |

`ACCOUNT_EMAIL_VERIFICATION_ALLOWED_URLS` is empty unless additional exact pages are needed. The public `.env` keeps both values empty. The default URL is required even with an allowlist. Supplied callbackUrl must match a configured full URL after parsing, with no query, fragment or user-info. HTTPS is required except configured localhost HTTP in local/test. FE must implement these pages; local port/path is adjustable. Restart the backend to load changes. These settings do not change CORS.

Schema definitions add nullable `accounts.email_verified_at` and `account_email_verification_tokens` (hashed token, account, current-email snapshot, target email, purpose, credential revision, lifecycle timestamps, indexes and checks). No new role enum is needed. Email-change pending state uses the same purpose-bound table. Verification records are independent of password-reset tokens. All mutation/revocation writes commit atomically using account → session → token locking.

**Existing sellers are unverified after migration and must verify before business access.** Their valid sessions may still use onboarding/recovery endpoints. No timestamp backfill or automatic exemption is provided. Admin/employee own verification is not required, but employee access depends on the seller parent. There is no feature flag that disables enforcement: coordinate the FE verification UI, mail settings, migration and backend release.

```bash
npm run db:generate:local
# Review generated SQL, including any other pending changes.
npm run db:migrate:local
npm run account:profile:audit:local
# Review audit output before backfilling valid legacy profiles:
npm run account:profile:backfill:local
npm run build
npm run dev
```

Audit is read-only; backfill explicitly writes completion timestamps only for valid incomplete seller profiles, using the current time. Both report account IDs and invalid/missing fields. Exit code 2 means some sellers still need remediation/onboarding; do not deploy the gate without reviewing those accounts. Neither script fabricates data or changes passwords/roles/status. No automatic backfill runs at startup. For another environment, explicitly run `NODE_ENV=development npx tsx src/scripts/backfillSellerProfiles.ts` (audit) and add `--apply` only after review and that environment's migration.

The profile backfill never sets `emailVerifiedAt`; existing sellers must still verify. Original onboarding schema changes made `real_name` and `phone` nullable and added `profile_completed_at`; `name` was already nullable. Review all outstanding schema changes together.

No migration files were generated or edited and no configured database was migrated by this implementation. Repeat generation/review/migration for each environment yourself. Daily cleanup at **03:37 Asia/Taipei** deletes verification tokens whose expiry is over seven days old; `NO_CRON=true` skips cleanup. Expiry is enforced at consumption regardless of cleanup. Verified account timestamps are not pruned.

### Verification

```bash
npm run test:email-verification
```

This uses the existing disposable PostgreSQL test runner and current schema in memory. Email delivery is mocked; no real messages are sent and no configured database is migrated. It covers registration compatibility, profile/email gate separation, token hashing/expiry/purpose/account binding, resend invalidation, concurrent consumption, wrong-account and GET attempts, mail/configuration failure, credential/status/session invalidation, email-change conflicts and rollback, recovery/session invalidation, SSE closure and cleanup. Existing onboarding/rotation/business fixtures also model verified sellers explicitly. Actual FE navigation, inbox delivery and staging/proxy behavior remain rollout checks.

Validation for the 2026-10-18 extension: `npm run build`, `npm test` (including email verification, onboarding and rotation), and `npm run test:admin-chatroom-sse` (including legacy/app chat regressions) passed against disposable databases. No real verification email was sent by these tests.
