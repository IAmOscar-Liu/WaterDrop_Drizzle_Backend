# Password recovery and login sessions — FE handoff

Originally published: 2026-10-14. Split into separate handoffs: 2026-10-18 (Asia/Taipei).

Status: **implemented; owner-run schema migration/configuration and deployment are required**. This document does not confirm availability on development/staging. Admin Swagger includes the implemented contracts; Flutter app-user registration/password flows are unchanged.

**Two-step seller registration, profile completion, existing-seller onboarding, email verification/resend and confirmed email changes have moved to [Seller registration and email verification — FE handoff](SELLER_REGISTRATION_AND_EMAIL_VERIFICATION_API_CHANGES.md).** Use that document for the complete FE verification flow. This filename is retained so existing recovery/session links continue to work.

This handoff covers forgot/reset password, signed-in password changes, and access/refresh-token session handling. Both handoffs share the current account authentication system. See the [combined backend plan](../../plans/SELLER_TWO_STEP_REGISTRATION_PLAN.md) for design context.

## Forgot password

### Request the email

```http
POST /api/admin/account/forgot-password
Content-Type: application/json
```

```json
{"email":"seller@example.com","callbackUrl":"https://seller.example.com/reset-password"}
```

No login token is required. `callbackUrl` is optional and must exactly match a server-approved FE reset-page URL after URL parsing. It cannot contain query parameters, fragments or user-info. The example domain is illustrative; use the environment URLs below. Omit the field to use the configured default (recommended).

Valid requests return HTTP 200:

```json
{"success":true,"data":{"message":"If an eligible account exists, a password reset email will be sent."}}
```

Existing, unknown, inactive/deleted accounts and suppressed resends receive the same response. Never show “email not registered” based on this response. Eligible recipients are active, non-deleted backend seller/admin/employee accounts, including incomplete sellers. Email lookup follows the existing exact login identity; no case-insensitive account merging is introduced.

Email delivery is asynchronous and best effort. A success response confirms request handling, not delivery. There is no durable mail queue/retry guarantee. If a link does not arrive, allow another request after cooldown. The email uses the existing 水滴 sender/logo and disables SendGrid click/open tracking.

### Handle the link and submit a new password

The emailed link looks like:

```text
https://seller.example.com/reset-password#token=OPAQUE_RANDOM_TOKEN
```

The token expires after **30 minutes** and is single-use. The FE router must support this fragment format. Read it into memory, remove it from the address bar/history using `history.replaceState`, and show password/confirmation inputs. Avoid analytics/third-party tracking on this page; use `Referrer-Policy: no-referrer`. Never put tokens/passwords in logs or local storage. Opening the link or scanning the email does not consume it. A reload after removing the token requires reopening the email link.

After the two password inputs match, call:

```http
POST /api/admin/account/reset-password
Content-Type: application/json
```

```json
{"token":"OPAQUE_RANDOM_TOKEN","newPassword":"Another-valid-password-123!"}
```

Password rules: at least eight characters with uppercase, lowercase, digit, and a supported special character (`!@#$%^&*(),.?":{}|<>`). New passwords are limited to **72 UTF-8 bytes**, preventing silent bcrypt truncation. Existing login passwords retain their current verification behavior. The API follows existing trimmed password input behavior; FE should not rely on leading/trailing spaces.

Success: `{success:true,data:{message:"Password reset successfully. Please log in."}}`. FE clears cached login state and returns to normal login; there is no automatic login. Completion, role, status and wallet data do not change. After login, sellers still need verified email and profile completion; follow the separate onboarding handoff. Password reset does not grant email verification.

Earlier unexpired links remain usable after requesting another email. Once any link succeeds, all outstanding links for that account are invalidated. Concurrent resets have at most one winner. Invalid password input does not consume a valid token. A lost success response followed by a retry returns an invalid-token error; offer login with the new password or another reset request.

| HTTP / code | FE handling |
| --- | --- |
| 400 validation envelope | Correct request/password fields. |
| 400 `PASSWORD_RESET_TOKEN_INVALID` | Unknown, malformed, expired, used, revoked or unavailable account; offer another reset email. |
| 400 unapproved callback | Use the configured/approved FE page URL. |
| 429 with `Retry-After` | Wait before retrying. |
| 503 recovery not configured | Backend must configure approved reset URLs and persistent JWT secret. |

No separate token-verification endpoint is required. Never use a reset token as an access token.

## Session invalidation

Resetting a password invalidates all existing backend access and refresh tokens. The signed-in `PUT /api/admin/account/change-password` now also invalidates previous sessions and recovery links and clears the current refresh cookie; FE must log in again after success.

Expired/revoked access credentials return 401; credential revision mismatch uses `ACCOUNT_CREDENTIALS_CHANGED`. The refresh endpoint returns 403 REFRESH_TOKEN_INVALID for an expired/revoked/invalid cookie, or REFRESH_TOKEN_REUSED when replay is detected, and clears its cookie. Do not loop refresh after failure; clear session state and return to login. Open admin chat streams recheck credentials on each poll and before delivering events; stale credentials cause `stream.reset` with `auth_expired` and close, normally within the one-second poll interval. Already authorized in-flight requests cannot be undone.

Access lifetimes remain one day locally/one hour elsewhere, capped by session expiry. Each login session now has a fixed 30-day maximum lifetime; refreshing does not extend it. This feature is not a 24-hour idle-session policy. Deploy all admin token validators together; old API processes cannot enforce credential revisions.

## Database and local rollout (owner-run)

Schema definitions only have been changed; no migration files were generated and no configured database was migrated.

- `accounts`: `credential_version` default 0 with a non-negative check; onboarding/verification schema is described in the separate handoff.
- `account_password_reset_tokens`: account FK, unique token hash, credential revision, creation/expiry/use/revocation timestamps, account/expiry indexes and validity checks. Raw tokens are never stored.
- `account_sessions` and `account_refresh_tokens`: login sessions, hashed refresh tokens and consumed-token history; one unconsumed token per session, account/expiry/session indexes and expiry/version checks.
- `account_recovery_rate_limits`: shared hashed email/IP counters across API instances, with an expiry-cleanup index. This additional small table is needed so limits also cover nonexistent emails and survive process changes.

```bash
npm run db:generate:local
# Review the generated SQL, including any other pending schema changes.
npm run db:migrate:local
npm run build
npm run dev
```

For seller-profile auditing/backfill and email-verification rollout, follow the [registration and verification handoff](SELLER_REGISTRATION_AND_EMAIL_VERIFICATION_API_CHANGES.md#configuration-and-owner-run-migration). Profile backfill never verifies email or creates sessions.

The following defaults are configured in the repository's local environment files. Ensure deployment uses the corresponding value and restart the backend after changing configuration. FE must provide these routes:

| Environment file | `ACCOUNT_PASSWORD_RESET_URL` |
| --- | --- |
| `.env.local` | `http://localhost:3000/reset-password` |
| `.env.development` | `https://dev.waterdropping.com/reset-password` |
| `.env.stg` | `https://stg.waterdropping.com/reset-password` |

The local port/path is a placeholder; update it to match the local FE before testing. For development, the emailed link is `https://dev.waterdropping.com/reset-password#token=RESET_TOKEN`; staging and local use their respective base URLs. FE reads the fragment token and submits it with the new password as described above.

`ACCOUNT_PASSWORD_RESET_ALLOWED_URLS` is optional and currently unset in these three files. If additional reset pages are needed, configure exact URLs separated by commas, for example locally:

```dotenv
ACCOUNT_PASSWORD_RESET_URL=http://localhost:3000/reset-password
# Optional additional exact allowed pages, comma-separated:
ACCOUNT_PASSWORD_RESET_ALLOWED_URLS=http://localhost:5173/reset-password
```

When FE supplies `callbackUrl`, it takes precedence only when it matches the default URL or an additional allowed URL after URL parsing. Matching includes the full path, not just the origin; an unapproved URL returns 400 and sends no email. Omitting `callbackUrl` uses the default. `ACCOUNT_PASSWORD_RESET_URL` remains required even if the additional allowlist is set; missing/invalid server URL configuration returns 503.

Local/test may use explicitly configured localhost HTTP URLs; deployed environments require HTTPS. A persistent `JWT_SECRET` and the existing SendGrid configuration are required. Reset-page settings and the email-verification settings described in the separate onboarding handoff are configured in these environment files; credentials were unchanged. These settings do not automatically add a new FE origin to the application's CORS allowlist; local FE should use its existing development proxy or configure CORS deliberately.

Limits: forgot-password 20 requests/hour/IP; one accepted request/minute and five requests/hour per normalized email. Email suppression keeps the generic 200 response. Reset submission allows 60 valid-shaped requests/hour/IP. IP throttling returns 429 with a conservative 3600-second `Retry-After`. Keys are HMAC hashes. Express currently uses its direct peer IP; behind a reverse proxy, configure trusted proxy hops deliberately before rollout so unrelated users do not share the proxy's quota. Do not blindly trust arbitrary forwarded IP headers.

Daily cleanup runs at **03:37 Asia/Taipei**: deletes reset tokens whose expiry is over seven days old, sessions whose expiry is over seven days old (with their refresh-token history), and rate-limit rows whose window is over two days old. `NO_CRON=true` skips it. Expired/used/revoked tokens fail immediately regardless of cron success; run cleanup on at least one deployed process. Multiple processes may run the idempotent cleanup safely.

## Verification

`npm run test:account-onboarding` creates and drops an isolated database using the current schema in memory on the configured test PostgreSQL server. It never migrates the configured local/development database and captures recovery email calls without sending real email. It covers legacy/new registration, partial/duplicate input, permissions and shared-route bypasses, completion retries, reset hashing/expiry/one-time consumption, concurrent resets, open SSE revocation, refresh rejection, email-change invalidation, shared rate-limit concurrency, backfill and cleanup. Admin Swagger is checked as part of the suite.

Actual FE routing, real SendGrid inbox delivery, deployment proxy settings and migration SQL remain owner/deployment checks.


## Refresh-token rotation extension

Implemented on this branch; owner-run migration required before deployment.

Keep the existing register/login/refresh/logout endpoints and response envelopes. Replace the admin refresh JWT cookie with a cryptographically random opaque token, storing only its hash. Add PostgreSQL `account_sessions` and `account_refresh_tokens`: one session per login, immutable token history per session, expiry and revocation state. Reset-password tokens remain separate.

Every successful refresh atomically consumes the current token and creates its replacement. Reuse of a consumed token revokes that session, including its current refresh token, access tokens and open admin chat streams; other devices/sessions remain usable. Do not throw inside the revocation transaction in a way that rolls it back. Logout revokes the current session server-side. Password change/reset revokes all account sessions atomically with the credential-version increment.

Admin access JWTs identify their purpose, issuer, audience and session ID. Authenticated admin/shared routes require a valid active session. Refresh tokens cannot authorize business APIs; access JWTs cannot refresh a session. Old untyped admin JWTs and old refresh cookies are rejected after deployment: **all backend users must log in once again**. Normal app-user tokens remain unchanged.

A session has a **30-day absolute lifetime from login**, rather than extending forever on refresh. The refresh cookie expires at that same boundary. Access token lifetimes remain one day locally/one hour elsewhere, capped by the session boundary. Expired session/token history is deleted seven days after session expiry by daily cleanup. Consumed token hashes are retained until then for replay detection.

Strict replay policy: there is no grace window or retry token. Concurrent uses have one winner; the loser revokes the session, so even the winner's response is no longer usable. A lost refresh response can require login again. FE must share one in-flight refresh promise, coordinate across tabs (for example Web Locks with a recheck of shared authentication state), and never automatically retry refresh/logout network requests. Do not broadcast/store refresh tokens; they stay in the HTTP-only cookie. Use credentials-enabled requests, exclude auth endpoints from automatic refresh interception, retry a business request at most once, and clear authentication state on definitive refresh failure. On an uncertain network result, return to login rather than replaying a potentially consumed token.

Deploy all instances together after migration; mixed old/new validators are unsupported. No refresh session backfill is possible or needed. Existing generated migration files are left untouched; generate another migration from the updated schema. Existing local `0113` migration files are left untouched. Generate and review a subsequent migration for the new session tables; do not deploy the new authentication code before applying it. Profile audit/backfill is covered by the separate onboarding handoff and never creates login sessions.

### Rotation HTTP contract

| Endpoint | Successful response | Cookie/session behavior |
| --- | --- | --- |
| `POST /api/admin/account/register` | `{success:true,data:{user,token}}` | Creates a login session and its refresh cookie. |
| `POST /api/admin/account/login` | `{success:true,data:{user,token}}` | Creates an independent session for this login. |
| `POST /api/admin/account/refresh-token` | `{success:true,data:{token}}` | No request body needed; consumes the cookie token and sets its replacement. |
| `POST /api/admin/account/logout` | `{success:true,data:"OK"}` | Revokes the session identified by cookie; falls back to a valid bearer access token if no known cookie exists. Clears cookie on success. No body needed. |

Use `withCredentials: true` for the FE's cookie-authenticated login/refresh/logout calls. Raw refresh tokens never appear in JSON. Access JWTs now contain minimal identity/session claims rather than account profile fields; use `data.user` or `/account/me` for profile/role information. JSON authentication responses use `Cache-Control: no-store`. Logout without identifiable credentials remains a successful cookie clear, but cannot revoke an unidentified server session. Do not refresh as a prerequisite to logout; even a consumed cookie can identify its session for revocation. Logout failure does not clear the cookie, allowing a deliberate retry; do not report server-side revocation as completed if that call failed.

| HTTP / code | Meaning |
| --- | --- |
| 401 `ADMIN_ACCESS_TOKEN_REQUIRED` | Account token has wrong/missing purpose, issuer, audience or session claims; old admin JWTs must log in again. |
| 401 `ACCOUNT_SESSION_INVALID` | Access JWT's session is expired/revoked/unavailable or belongs to a different account. |
| 401 `ACCOUNT_CREDENTIALS_CHANGED` | Access JWT credential revision is stale after password change/reset. |
| 401 `REFRESH_TOKEN_MISSING` | No refresh cookie supplied. |
| 403 `REFRESH_TOKEN_INVALID` | Refresh token unknown, expired/revoked, wrong type, legacy JWT, or account unavailable. |
| 403 `REFRESH_TOKEN_REUSED` | A consumed token was replayed; the session revocation was committed before this response. |
| 500 / 503 | Server/configuration failure; do not assume rotation succeeded or failed based on missing response. |

Refresh 401/403 responses clear the cookie; server failures do not. Missing/expired/invalidly signed access JWTs continue to return the existing generic authentication errors. Do not refresh on `ACCOUNT_SESSION_INVALID`, `ACCOUNT_CREDENTIALS_CHANGED`, or `ADMIN_ACCESS_TOKEN_REQUIRED`; require login. For ordinary access expiry, attempt a single coordinated refresh. Any definitive refresh 401/403 requires login. Password reset/change invalidates every session, while normal rotation leaves already-issued access tokens usable until their normal expiry unless the session is revoked.

### FE coordination and checks

Use one Axios refresh promise per tab plus a cross-tab lock on the same origin. After acquiring the lock, recheck whether another tab has already supplied a newer access token; distribute fresh access tokens through the FE's existing secure session-state mechanism (for example an in-memory BroadcastChannel), not by reading the HTTP-only refresh cookie. Also coordinate logout and account changes so an older refresh response cannot restore a logged-out user's state. Multiple FE origins sharing the cookie need a coordinated deployment/session design; same-origin browser locks alone do not serialize those origins. Do not disable reuse detection to work around request races.

A session's refresh history is deliberately retained even after individual tokens are consumed. Cleanup never removes history from an unexpired session. Already connected admin SSE streams recheck session validity every poll and before events; logout, replay, expiry or password changes reset/close them. No session-list or revoke-other-device endpoint was added.

`npm run test:account-sessions` tests two API processes against a disposable PostgreSQL database: token separation, actual login/refresh cookie exchange, replay persistence, concurrent use, transaction rollback, independent devices, logout and idle SSE shutdown, expiry/retention and password-change/reset revocation. No real emails are sent, and no configured database or generated migration file is changed by this suite.


Verified for this implementation: `npm run build`, the full `npm test` suite (including onboarding and rotation), `npm run test:admin-chatroom-sse`, and `npm run test:notification-sse` passed. These are isolated PostgreSQL tests, not deployment confirmation. Browser cross-tab coordination and actual deployment cookie/proxy behavior remain FE/staging checks.
