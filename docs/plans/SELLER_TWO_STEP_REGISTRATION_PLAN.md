# Seller registration, protected API access, and password recovery

Date: 2026-10-14

Status: **implemented on `feat/two_step_registration`; owner-run migration/configuration and rollout pending**. This document preserves the agreed design. See the [registration/email-verification handoff](../api/FE-confirmation/SELLER_REGISTRATION_AND_EMAIL_VERIFICATION_API_CHANGES.md) and [password recovery/session handoff](../api/FE-confirmation/SELLER_REGISTRATION_AND_PASSWORD_RECOVERY_API_CHANGES.md) for the exact implemented contracts, local migration/backfill commands, configuration, and testing. No generated migration files or configured databases were changed by implementation.

Implementation additions: shared recovery throttling uses an additional `account_recovery_rate_limits` table; daily cleanup runs at 03:37 Asia/Taipei; new passwords have a 72-byte UTF-8 limit for bcrypt. Existing sellers need the explicit audit/backfill before enforcing onboarding in a deployed environment.

## Decision and scope

Allow a new seller to register with email/password, authenticate, and complete the remaining profile fields afterward. Keep `role: "seller"` throughout. Add a separate completion timestamp rather than a new role enum: roles determine permissions, while completion determines whether a seller may access business APIs.

The first release uses today's required profile fields: `name`, `realName`, and `phone`. Keep `address` optional. Retain existing password, name, and phone validation. This is registration/profile onboarding, not two-factor authentication or a new session-expiration policy. Seller email verification is now implemented as the extension below; seller approval remains outside scope.

Incomplete sellers can resume onboarding after logout or token expiry. FE navigation alone must not enforce the restriction; the backend must deny business access until completion.

This plan also adds email-based forgotten-password recovery for backend accounts, including incomplete sellers. It preserves the existing signed-in change-password action. Password recovery does not complete a seller's profile, reactivate a suspended account, or grant new permissions.

## Verified current behavior

| Area | Current implementation | Required change |
| --- | --- | --- |
| Registration | `POST /api/admin/account/register` requires name, realName, email, password, phone; address is optional. Creates a seller and returns an access token plus refresh cookie. | Accept credentials-only registration and preserve full-form registration. |
| Storage | `accounts.name` is nullable; `real_name` and `phone` are NOT NULL. No completion field exists. | Permit missing initial profile data and store completion separately. |
| Login/refresh | Credentials and active/not-deleted account checks; no onboarding distinction. | Allow incomplete sellers to resume, while reporting onboarding state. |
| Protected routes | Admin routers generally attach `isAuth` to individual endpoints. For `/api/admin/` requests, it checks the database account's status and deletion state. | Add a default seller-completion gate and explicit exceptions. |
| Business authorization | `getActiveAdminAccount` / `resolveAdminSellerScope` enforce active accounts, roles, and seller/employee scope. | Ensure incomplete sellers cannot be used as authorized business actors or employee parent scopes. |
| Profile update | Self-update accepts `role` and `status` along with profile fields. | Separate administrative changes from self-service fields; no client-controlled completion flag. |
| Password recovery | The account router has a signed-in change-password action, but no forgot/reset-password flow. Access/refresh JWT verification does not check a credential revision. | Add expiring, single-use reset tokens and session invalidation after password reset. |

Reference files: [schema](../../src/db/schema.ts), [account router](../../src/routers/admin/admin-account.ts), [validation](../../src/middleware/admin/account.ts), [controller](../../src/controller/account.ts), [service](../../src/services/account.ts), [repository](../../src/repository/account.ts), [isAuth](../../src/middleware/isAuth.ts), [seller scope](../../src/repository/adminScope.ts), and [tokens](../../src/lib/token.ts).

## Database design

Recommended changes require a migration:

1. Add nullable `accounts.profile_completed_at` (`profileCompletedAt`, timestamp with time zone), with no automatic completion default.
2. Allow `accounts.real_name` and `accounts.phone` to be null during onboarding. `name` is already nullable.
3. Derive `isProfileComplete` and `missingProfileFields` in the account response serializer; do not store a second boolean that can disagree with the timestamp.

Password recovery additionally requires the reset-token table and account credential revision described below. These are proposed schema changes, not generated migrations.

For sellers, a null timestamp means onboarding is incomplete. Successful full registration or profile completion validates all required fields and sets the timestamp in the same transaction. Preserve the original timestamp on successful retries and normal later edits. Prevent completed sellers' required fields from being cleared or made invalid through any supported update path.

Do not store fake names, empty-string placeholders, or dummy phone numbers to satisfy current NOT NULL constraints. Do not reuse `status: "inactive"` for onboarding: account suspension and incomplete registration have different login/access behavior.

Existing admin and employee provisioning remains separate from seller self-registration; no new role is added. Seller-completion enforcement must use the current database role, not a stale role in a JWT. Any administrative conversion of an account to seller must also enforce the seller-profile rules.

## Proposed API flow

### Step 1: register credentials

Reuse `POST /api/admin/account/register`:

```json
{
  "email": "seller@example.com",
  "password": "A-valid-password-123!"
}
```

Create an active seller with an incomplete profile, hash the password, and return the existing `{success:true,data:{user,token}}` envelope and refresh cookie. An active status alone does not grant business access.

Existing full-form clients can still submit `name`, `realName`, and `phone` with registration. Require that profile group to be either absent or fully supplied and valid; reject partially supplied or invalid profile groups with 400. A valid full registration creates a completed seller atomically. Keep address optional. Never accept caller-supplied role, account status, completion timestamp, or `isProfileComplete` as authority.

Duplicate registration must not overwrite an existing account or reset its profile/password; return a conflict and let the seller log in. Preserve atomic account/wallet initialization and ensure retries cannot create duplicate accounts or wallets. Existing initialization does not itself unlock business APIs.

### Step 2: complete the seller profile

Add `POST /api/admin/account/complete-profile`, authenticated and permitted for incomplete sellers:

```json
{
  "name": "水滴商店",
  "realName": "王小明",
  "phone": "0912345678",
  "address": "Optional address"
}
```

- Derive the account ID from authentication; do not accept a target account ID.
- Accept only the onboarding fields. Role/status/email/password changes are not part of this operation.
- Validate all required profile fields, lock the account, recheck its role/status/deletion state, and save the profile and completion timestamp atomically.
- Return `{success:true,data:<updated user>}` with completion information.
- Make an identical retry safe and preserve the completion timestamp. If already completed, do not use this endpoint to overwrite the profile with different data; use the existing profile-update workflow instead.
- No second login is required. Authorization reads current database state, so the existing access token can use business routes after completion commits.

### Account response additions

Include these fields in the `user` returned by registration/login, in `/account/me`, and in profile-completion results:

```json
{
  "role": "seller",
  "isProfileComplete": false,
  "profileCompletedAt": null,
  "missingProfileFields": ["name", "realName", "phone"]
}
```

`missingProfileFields` identifies missing or invalid required fields according to the shared validator. After completion, return `true`, the timestamp, and an empty array. A legacy row with valid fields but a null completion timestamp still needs migration/backfill or explicit completion; field presence alone must not silently grant access.

Refresh retains its existing token-only JSON response and sets the rotated refresh cookie. FE can call `/account/me` afterward for current onboarding state. Never rely on a completion claim inside the JWT as the authorization source.

## Integration with the current isAuth middleware

Keep existing `isAuth` usage as the default for protected business routes. Extend its admin-account branch to read `role` and `profileCompletedAt` alongside `status` and `deletedAt`. Reject incomplete sellers by default, after token and active-account checks.

Provide an explicitly named authentication-only middleware variant for the few onboarding routes. Share JWT/account verification between the variants; the exception skips only seller-profile completion, never account existence, suspension, deletion, or ownership checks. Select the variant in route definitions rather than exempting broad URL prefixes.

| Route/action | Incomplete seller allowed? | Conditions |
| --- | --- | --- |
| `POST /api/admin/account/register` | Yes | Public registration with validation. |
| `POST /api/admin/account/login` | Yes | Valid credentials; account active and not deleted. |
| `POST /api/admin/account/refresh-token` | Yes | Valid refresh credentials; current account active and not deleted. |
| `POST /api/admin/account/logout` | Yes | Preserve the existing cookie-clearing behavior. |
| `POST /api/admin/account/forgot-password` | Yes | Public; generic acknowledgement and abuse controls. |
| `POST /api/admin/account/reset-password` | Yes | Public; valid reset token authorizes only the password reset. |
| `GET /api/admin/account/me` | Yes | Authentication-only variant; own account. |
| `POST /api/admin/account/complete-profile` | Yes | Authentication-only variant; own seller profile. |
| `PUT /api/admin/account/change-password` | Yes | Authentication-only variant; own account and valid old password. |
| `PUT /api/admin/account/update` | No | Incomplete sellers use the dedicated completion endpoint. |
| Products, advertisements, wallet, orders, refunds, delivery, chat/SSE, dashboard, sidebar streams, uploads, and employee/account management | No | Normal completion gate plus all existing authorization checks. |

**Do not exempt all `/api/admin/account/*` routes.** That router also exposes privileged account-management operations.

For business requests by incomplete sellers, return HTTP 403 using the existing error envelope:

```json
{
  "success": false,
  "code": "ACCOUNT_PROFILE_INCOMPLETE",
  "message": "Please complete your seller profile."
}
```

Authentication failures remain authentication failures. Inactive/banned/deleted accounts remain denied even on onboarding exceptions. Completion does not override existing seller scope or permissions.

Audit every admin route for missing/different authentication and any authenticated shared routes that an admin token can access. Cover ordinary REST endpoints and SSE before headers are sent. For long-lived streams, retain existing access revalidation and ensure relevant account/seller eligibility is included. Do not rely solely on the URL-prefix branch if an alternate route reaches the same business operation.

Normal app-user authentication remains unchanged. Existing admin/employee authorization remains in effect; employee seller-scope resolution must also reject an incomplete seller parent. Prevent incomplete sellers from creating employees or being assigned as an eligible seller parent. Add shared business-level checks where needed so internal reuse cannot accidentally bypass the HTTP gate; keep profile lookup/completion paths available through their intended exceptions.

## Self-update and validation protections

The current self-update path accepts role/status. Restrict those to explicitly authorized platform-admin operations. Regular sellers and employees must not change their own role/status to bypass onboarding or other restrictions. Allow no direct write of `profileCompletedAt` through generic update input.

Use one profile validator for full registration, completion, later profile changes, and migration audit. Keep the current required field set and existing name/phone rules. Changing validation policy is a separate decision; backfill must not silently treat invalid historical values as valid.

## Forgot-password procedure

### Scope and endpoints

Use the `accounts` table, not app-user identities. Proposed eligibility is an active, non-deleted backend account (`seller`, `employee`, or `admin`), whether or not the seller profile is complete. This does not add recovery to app-user APIs. Suspended/deleted accounts require the existing support process; password recovery cannot bypass their status.

Both endpoints are public and therefore do not use the login-token `isAuth` gate. They require Zod validation, request limits, and their own recovery checks. The reset token grants no access to `/me`, profile completion, or business APIs.

| Method | Proposed endpoint | Body | Success |
| --- | --- | --- | --- |
| POST | `/api/admin/account/forgot-password` | `email`, optional `callbackUrl` | 200 generic acknowledgement; no token/account details. |
| POST | `/api/admin/account/reset-password` | `token`, `newPassword` | 200 confirmation; no automatic login or new session tokens. |

### 1. Request a reset email

```json
{
  "email": "seller@example.com",
  "callbackUrl": "https://seller.example.com/reset-password"
}
```

The URL above is illustrative. Configure the real FE reset-page URL separately for local, development, staging, and production. If omitted, use the server's configured default. If supplied, require an exact match to an approved reset-page URL after URL parsing; do not allow arbitrary destinations, wildcard domains, user-info components, caller-supplied query parameters, or fragments. HTTPS is required except for explicitly configured localhost development URLs. Never build the destination from request `Host` or forwarded-host headers. This is the FE page URL, not a backend webhook or a URL the backend fetches.

For a valid request, respond consistently:

```json
{
  "success": true,
  "data": {
    "message": "If an eligible account exists, a password reset email will be sent."
  }
}
```

Return the same envelope/status for an unknown email, an ineligible account, an accepted request, or a silently suppressed resend. Avoid timing differences that disclose account existence, including synchronous SendGrid latency for only matching accounts. Invalid body/callback URL may return 400 before account lookup. Apply shared limits across API instances to both existing and nonexistent email inputs: proposed starting limits are one email per minute and five requests per hour per normalized email, plus 20 requests per hour per client IP. Per-email suppression retains the generic response; IP throttling may return 429 with `Retry-After`. Do not lock an account because someone requests resets.

Use the same email identity rules as registration/login. Audit legacy casing/whitespace and potential collisions before introducing case-insensitive lookup; never send a token for an ambiguously matched account. Send only to the stored account address. Pending reset links must be invalidated on account-email changes.

For an eligible, non-throttled account, generate 32 cryptographically random bytes encoded as base64url. Store its SHA-256 hash and a **30-minute expiry**, then commit before attempting email delivery. The raw token is returned only through the email link, never the API response. The proposed link format is:

```text
https://seller.example.com/reset-password#token=OPAQUE_RANDOM_TOKEN
```

FE reads the fragment, keeps the token in memory, and removes it from the browser address/history with `history.replaceState`. Confirm that the FE router supports this fragment format before implementation. Do not persist the token in local storage or analytics. The reset page should use `Referrer-Policy: no-referrer`, avoid third-party tracking, and avoid recording passwords/tokens in error reports. Disable SendGrid click tracking for reset links so the recovery secret is not wrapped in tracking URLs.

Reuse the shared SendGrid mail helper, including the 水滴 sender name and logo. The email explains expiry, how to request another link, and that the recipient can ignore an unsolicited request. A GET/page load or email security scanner must never consume the token. No separate verification endpoint is required initially; final validation occurs on reset submission.

The proposed resend policy allows earlier unexpired links to remain valid until one reset succeeds, avoiding out-of-order email delivery breaking an earlier link. Rate limits bound issuance. A successful reset invalidates every outstanding link for that account. SendGrid failure must be logged/monitored without recording secrets or disclosing account existence; allow a new request after cooldown. Do not promise durable email retries without a persistent delivery mechanism. An in-process background send can be lost on a process crash; FE's recovery path is to request a new link.

### 2. Submit the new password

```json
{
  "token": "OPAQUE_RANDOM_TOKEN",
  "newPassword": "Another-valid-password-123!"
}
```

FE asks the user to confirm the password locally, then sends `newPassword` and the token in the POST body over HTTPS. Backend validation uses the same password rules as registration/change-password. Never accept an email/account ID from this request as the reset target; derive it from the hashed token record.

Use a transaction with consistent account-first locking across reset issuance, reset consumption, email changes, and other password changes. Locate the candidate account by token hash, lock the account, and re-read/lock the token before authorizing the write. Recheck database expiry, unused state, account status/deletion, and the credential revision recorded at issuance. Hash the new password with the existing password-hashing implementation. Atomically update the password, increment the account credential revision, mark the selected token used, and invalidate all other outstanding reset tokens. Concurrent attempts must yield at most one successful reset, including attempts using different links for the same account.

Return the same HTTP 400/code `PASSWORD_RESET_TOKEN_INVALID` for unknown, malformed, expired, used, revoked, or no-longer-eligible tokens. Do not reveal account details. Invalid password input returns the standard validation error and does not consume the token. A repeated submission after success also returns the generic token error; if the response was lost, FE can direct the user to try logging in with the new password or request another link.

On success, return `{success:true,data:{message:"Password reset successfully. Please log in."}}`, clear the current browser's refresh cookie, and send a password-changed confirmation email without the password or reset token. Confirmation-email failure does not roll back the password change. FE discards its cached login credentials/state and returns to login. After login, an incomplete seller still goes to onboarding.

### PostgreSQL storage and session invalidation

Add `account_password_reset_tokens` with proposed columns:

| Column | Purpose |
| --- | --- |
| `id` | UUID primary key. |
| `account_id` | Required FK to `accounts`; cascade on physical account deletion. |
| `token_hash` | Required unique SHA-256 digest; never store the raw token. |
| `credential_version` | Account credential revision when issued. |
| `created_at` | Required timestamp with time zone. |
| `expires_at` | Required timestamp with time zone; later than creation. |
| `used_at` | Nullable timestamp for the consumed token. |
| `revoked_at` | Nullable timestamp for invalidated links. |

Index `account_id` for invalidation and `expires_at` for cleanup, in addition to the unique hash index. Proposed cleanup removes expired records after seven days; correctness must depend on expiry checks, never on cleanup having run. No legacy token backfill is needed. Implement rate limiting with shared state; this table alone does not track unknown-email/IP attempts.

Also add `accounts.credential_version`, a non-negative integer defaulting to 0. Password reset and other password changes increment it atomically. New admin access and refresh tokens carry the version; both the normal and authentication-only `isAuth` variants, refresh endpoint, and other admin-token entry points compare it against the current account row. A stale version is an authentication failure. Never let refresh upgrade an old credential version into a valid new session.

Before this feature, JWT validity was independent of password changes. The rotation extension below supersedes legacy-token compatibility: untyped admin JWTs are rejected and all backend accounts must log in again after deployment. All token issuers must read the current version, and concurrent login/refresh must not issue a new-version token based on credentials verified before the reset. Existing admin SSE streams must check the captured version during access revalidation and close when stale; already authorized in-flight requests cannot be retroactively undone. Deploy all validators together before enabling resets. App-user sessions stay unchanged.

Other password-change paths and account-email changes must invalidate outstanding recovery links under the same lock policy. Completion state, role, account status, wallet data, and business ownership are unchanged by recovery. Do not expose token hashes or credential revision as editable profile fields.

Security reference: the generic response, random single-use token, trusted reset destination, and normal login after reset follow the [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). The 30-minute expiry, resend policy, limits, and PostgreSQL layout above are proposed project choices.

## FE onboarding integration

1. Submit email/password and store credentials using the existing mechanism.
2. Read `user.isProfileComplete`; incomplete sellers go to the profile form, completed sellers go to the normal backend interface.
3. On page reload or resumed login, fetch `/api/admin/account/me` to restore the correct screen.
4. Submit the remaining fields to `complete-profile`; update cached user state and enter the normal interface after success.
5. In the shared HTTP interceptor, route `403 ACCOUNT_PROFILE_INCOMPLETE` to onboarding. Do not start a token-refresh loop for this code. Keep existing authentication-expiry handling separate.
6. While incomplete, do not start dashboard/sidebar/chat requests or streams. Start them after completion. Clear stale business state if access is denied.

## Existing accounts and rollout

Before enforcement, audit existing sellers with the agreed profile validator. Backfill qualifying existing sellers as completed so they retain access. If historical completion times are unknown, use a documented migration/backfill timestamp rather than claiming to know when their profiles were originally completed.

Produce a report of incomplete/invalid existing sellers before enabling the gate. Decide how to remediate those records or have those sellers complete onboarding; do not unexpectedly lock out existing business users or mark invalid profiles complete. This legacy-data decision remains a rollout prerequisite.

Suggested rollout order:

1. Audit existing records and enumerate affected routes/role-sensitive paths.
2. Implement schema definitions, shared validation/serialization, completion workflow, and access enforcement.
3. Prepare and review migration/backfill for the intended environment; the owner runs generation and migration. No migration is generated or applied by this planning task.
4. Verify existing seller/admin/employee compatibility and close any historical-data gaps before enforcement goes live.
5. Deploy the backend and FE together or use a rollout sequence that ensures FE understands the new 403 code before users enter incomplete registration. Avoid mixed old/new API instances accepting registrations without the new gate.
6. Update admin Swagger and publish an implemented FE handoff with exact response contracts and rollout status.

For password recovery, include the reset-token table and credential revision in the owner-run migration. Configure approved FE URLs and shared rate limits, verify the fragment-link flow and SendGrid tracking settings, and deploy every admin JWT validator/issuer before exposing the forgot-password UI. No production email is sent as part of this planning task.

## Planned verification

- Credentials-only registration, full-form backward compatibility, invalid partial profiles, duplicate-email concurrency, password hashing, and single account/wallet initialization.
- Login/refresh/resume for incomplete sellers, with inactive/banned/deleted accounts still rejected.
- Every protected admin feature rejects incomplete sellers; authentication-only exceptions remain available for the correct account.
- Direct requests cannot bypass onboarding through FE state, a forged completion field, stale JWT contents, self-role/status changes, an employee parent relationship, or an alternate/shared route.
- Valid completion is atomic; invalid input makes no partial changes; concurrent retries preserve the original completion timestamp.
- Existing access tokens work after completion; all normal seller-scope and role restrictions still apply.
- Required fields cannot be cleared later; unrelated app-user behavior and existing admin/employee provisioning remain compatible.
- SSE access is rejected before headers when incomplete, and FE does not loop token refresh on onboarding denial.
- Audited/backfilled legacy accounts retain intended access.
- Recovery for eligible complete/incomplete backend accounts; identical responses for unknown/inactive/deleted accounts, and no app-user account reset.
- Callback allowlist bypass attempts, token/password redaction, email tracking disabled, shared rate limits, and comparable request timing without account enumeration.
- Valid/expired/used/revoked tokens; scanner/page loads do not consume links; invalid password input does not consume a valid token.
- Concurrent same-token and different-token resets, reset versus login/refresh/email change, rollback, out-of-order email delivery, and SendGrid failure/retry behavior.
- Old passwords, access JWTs, refresh cookies, and established admin streams lose access after reset as specified; legacy token rejection, new login, and unrelated app-user sessions behave correctly.
- Reset preserves seller completion/status/roles and wallet data; cleanup is not required for token expiry enforcement.

The implementation includes an isolated PostgreSQL integration suite. See the handoff for verification coverage and remaining deployment checks.


## Refresh-token rotation extension

Implemented on this branch; owner-run migration required before deployment.

Keep the existing register/login/refresh/logout endpoints and response envelopes. Replace the admin refresh JWT cookie with a cryptographically random opaque token, storing only its hash. Add PostgreSQL `account_sessions` and `account_refresh_tokens`: one session per login, immutable token history per session, expiry and revocation state. Reset-password tokens remain separate.

Every successful refresh atomically consumes the current token and creates its replacement. Reuse of a consumed token revokes that session, including its current refresh token, access tokens and open admin chat streams; other devices/sessions remain usable. Do not throw inside the revocation transaction in a way that rolls it back. Logout revokes the current session server-side. Password change/reset revokes all account sessions atomically with the credential-version increment.

Admin access JWTs identify their purpose, issuer, audience and session ID. Authenticated admin/shared routes require a valid active session. Refresh tokens cannot authorize business APIs; access JWTs cannot refresh a session. Old untyped admin JWTs and old refresh cookies are rejected after deployment: **all backend users must log in once again**. Normal app-user tokens remain unchanged.

A session has a **30-day absolute lifetime from login**, rather than extending forever on refresh. The refresh cookie expires at that same boundary. Access token lifetimes remain one day locally/one hour elsewhere, capped by the session boundary. Expired session/token history is deleted seven days after session expiry by daily cleanup. Consumed token hashes are retained until then for replay detection.

Strict replay policy: there is no grace window or retry token. Concurrent uses have one winner; the loser revokes the session, so even the winner's response is no longer usable. A lost refresh response can require login again. FE must share one in-flight refresh promise, coordinate across tabs (for example Web Locks with a recheck of shared authentication state), and never automatically retry refresh/logout network requests. Do not broadcast/store refresh tokens; they stay in the HTTP-only cookie. Use credentials-enabled requests, exclude auth endpoints from automatic refresh interception, retry a business request at most once, and clear authentication state on definitive refresh failure. On an uncertain network result, return to login rather than replaying a potentially consumed token.

Deploy all instances together after migration; mixed old/new validators are unsupported. No refresh session backfill is possible or needed. Existing generated migration files are left untouched; generate another migration from the updated schema. See the FE handoff for response/error details, frontend coordination and verification.


## Email verification extension — implemented 2026-10-18

The email-verification proposal is implemented; see the [FE handoff](../api/FE-confirmation/SELLER_REGISTRATION_AND_EMAIL_VERIFICATION_API_CHANGES.md#seller-email-verification-and-confirmed-email-changes) for the exact contracts. Earlier onboarding-only access descriptions in this plan are superseded by the requirement for both verified seller email and profile completion.

- New and existing sellers require email verification for business APIs. Keep role/status unchanged; no automatic verification backfill or exemption. Admin/employee own verification is not enforced, but an employee's seller parent must be verified and complete.
- Add `accounts.emailVerifiedAt` and `account_email_verification_tokens` with current-email snapshot, target email, purpose (`verify`/`change`), unique SHA-256 hash, credential revision and lifecycle timestamps. Schema definitions only; generation/migration remain with the owner.
- Preserve existing registration bodies and responses; attempt SendGrid delivery after account creation. Failed delivery keeps the account for resend. Invalid URL configuration fails before account creation. Full profile submission no longer alone grants business access.
- Add authenticated resend/verify and request/confirm-email-change endpoints. Single-use 30-minute tokens require the same account's valid session. Links use `#token=...&purpose=verify` or `purpose=change`; GET cannot confirm. Resends replace links of the same purpose; successful confirmation revokes all outstanding verification/change links.
- Allow verification, profile completion and email correction during onboarding. Email correction/change requires current password and confirmation at the new address before replacement. Direct email edits, including admin edits, return 409. Confirmed email changes revoke all sessions and recovery links, then require login with the new address. Notify the old address after commit.
- Extend existing seller eligibility checks used by middleware, business scope helpers and SSE. Return `ACCOUNT_EMAIL_UNVERIFIED` before the profile-incomplete error. Ordinary verification does not rotate sessions or complete profiles; password reset does not verify an address.
- Use dedicated namespaces in the existing shared throttling table. Extend daily cleanup at 03:37 Asia/Taipei with seven-day post-expiry retention. No email outbox or guaranteed delivery is promised.
- Add approved verification-page settings to the aligned environment files; public `.env` remains a credential-free template. FE must implement the verification/confirmation page before backend enforcement is deployed.

Run the isolated `test:email-verification` suite plus existing onboarding/session/business and SSE regressions before rollout. No test should send real email or migrate a configured database. Existing-seller enforcement is immediate when the migrated backend is deployed; coordinate FE and backend releases.
