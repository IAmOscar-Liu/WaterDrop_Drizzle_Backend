# Staging account migration and schema comparison

Date: 2026-10-20 (Asia/Taipei)

## Completed operations

- Merged `development` at `fe5af21` into `stage`, preserving staging migration history. Merge commit: `444516a`; no conflicts.
- Generated, reviewed and applied `drizzle_stg/0015_overconfident_ghost_rider.sql` using `db:generate:stg` and `db:migrate:stg`. All previously recorded staging migration hashes were present in the repository before applying it.
- Added the account onboarding, recovery, session rotation and email verification schema to staging. Existing account data was preserved.
- Ran the existing seller-profile backfill on staging after checking its account against the profile validator. One valid seller received `profile_completed_at`; no email verification timestamp, credentials, roles or status were changed.
- Removed the completed rollout's `account:profile:audit:local` and `account:profile:backfill:local` package shortcuts. The underlying helper remains available for future environments, including production. Updated the FE handoff commands accordingly. Migration, test, chat and notification helper commands remain available.

## Actual database comparison

Read-only, repeatable-read catalog queries compared the `public` application schema in the three configured databases after migration.

| Object | Local | Development | Staging | Definitions match |
| --- | ---: | ---: | ---: | --- |
| Tables | 63 | 63 | 63 | Yes |
| Columns, types, defaults and nullability | 649 | 649 | 649 | Yes |
| Primary/foreign/unique/check constraints | 234 | 234 | 234 | Yes |
| Indexes, including predicates and uniqueness | 159 | 159 | 159 | Yes |
| Enums and ordered values | 31 | 31 | 31 | Yes |
| Sequence definitions | 1 | 1 | 1 | Yes |
| Views, public functions, user triggers and RLS policies | 0 | 0 | 0 | Yes |

All checked constraints are validated; all indexes are valid and ready. Each database has the same 454 NOT NULL columns. Local runs PostgreSQL 17.6; development and staging run 18.6. The catalog comparison accounts for the different representation of NOT NULL constraints by comparing column nullability separately.

Confirmed recorded migration hashes: local `0115_nasty_annihilus.sql`, development `0066_furry_tempest.sql`, staging `0015_overconfident_ghost_rider.sql`.

This confirms equivalent application schema definitions. Database versions, migration histories, owners/grants, physical column order, sequence current values and application data are not required to be identical. No application data was copied between environments. This audit does not establish integrity of every order, wallet or other business record.

## Account audit after backfill

| Environment | Seller accounts | Incomplete/invalid seller profiles | Unverified sellers |
| --- | ---: | ---: | ---: |
| Local | 2 | 0 | 2 |
| Development | 9 | 0 | 5 |
| Staging | 1 | 0 | 1 |

Unverified sellers must complete the email verification flow before business access. Admin accounts may have null profile/verification timestamps. No verification emails were sent during this operation and no account was marked verified by script.

Account checks found no duplicate normalized emails, empty email/password values, invalid credential revisions, missing employee parents, or orphan session/refresh/reset/verification-token records. Development retains the previously identified account group `98cfff42-dc84-40fb-b5ba-1a62c9b0bef4` whose parent is missing; it was not modified. Staging and local have no such orphan groups.

## Validation and release state

`npm run build` passed. Package script references resolve to existing commands/files. The merge was made locally; no push, API deployment or process restart was performed. The generated staging migration and package/documentation cleanup must be included in the next commit before release.

Deploy the merged backend with the FE onboarding/verification flow and the staging mail configuration. Existing backend accounts must log in again when moving from legacy tokens to session-backed access tokens. Migration alone does not deploy these API changes.
