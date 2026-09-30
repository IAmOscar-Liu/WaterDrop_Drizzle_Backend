# Group Join Cycle Prevention Plan

## Implementation Status

Implemented without a database schema change or migration:

- deterministic user-row locking and reciprocal user-group prevention;
- idempotent same-group joins;
- shared Traditional Chinese error constants;
- defensive reciprocal account-group prevention;
- Swagger documentation for both affected endpoints.

Existing database rows were not modified. The read-only data audit remains an
optional deployment check.

## Problem

`POST /api/auth/join-group` currently prevents only self-referral.

Given two users:

1. User B joins the group owned by user A.
2. User A then uses user B's referral code.
3. The repository creates or finds B's group and assigns A to it.

This leaves B in A's group and A in B's group, creating a reciprocal referral
cycle. The cycle can incorrectly make both users count each other as referrals
and can affect group-derived level and ad-view calculations.

## Required Invariant

Before assigning joining user A to referrer B's group, reject the request when
B is already a member of any group owned by A.

Expected behavior:

- B joins A's group: allowed.
- A later tries to join B's group: rejected.
- A uses A's own referral code: remains rejected.
- A joins an unrelated user's group: remains allowed.
- A changes from one unrelated group to another: preserve the current behavior.
- A joins the group they already belong to: treat as an idempotent success.

The join endpoint remains the authoritative validation point. The public
referral-code lookup only confirms that a code exists because it does not know
the authenticated joining user.

## Root Cause

The current `joinGroupByReferralCode` transaction in
`src/repository/user.ts`:

1. loads and locks the referrer;
2. blocks only `referrer.id === userId`;
3. finds or creates the referrer's group;
4. overwrites the joining user's `groupId`.

It never checks whether the referrer already points to a group owned by the
joining user. It also locks the two user rows in request-dependent order, so
simultaneous `A -> B` and `B -> A` requests can deadlock instead of resolving
predictably.

## Implementation Plan

### 1. Make user locking deterministic

Update `joinGroupByReferralCode` to:

- resolve the referrer from the referral code;
- lock the joining user and referrer rows in sorted user-ID order inside the
  existing transaction;
- validate that both locked users still exist and that the referral code still
  belongs to the expected referrer.

This serializes competing joins involving the same two users and avoids the
current opposite lock ordering.

### 2. Add the reciprocal-membership guard

While both users are locked:

- find whether the joining user owns a group;
- compare that owned group ID with the referrer's current `groupId`;
- if they match, throw a `CustomError` before creating a new group or updating
  membership.

Use a clear client-facing error such as:

```text
無法加入此群組，因為該群組的擁有者已經是您群組的成員。
```

Store this shared text in a group-specific constants file, for example:

```ts
export const RECIPROCAL_GROUP_JOIN_ERROR_MESSAGE =
  "無法加入此群組，因為該群組的擁有者已經是您群組的成員。";
```

Keep the existing API error convention unless the implementation review elects
to formalize this state conflict as HTTP `409`.

### 3. Preserve idempotent and existing join behavior

After finding or creating the referrer's group:

- if the joining user's `groupId` already equals the target group ID, return the
  current user without issuing a redundant update;
- otherwise update `groupId` exactly as today;
- do not change referral-count response fields or group ad-view calculations.

No database migration is required for this logic fix.

### 4. Review existing data without automatically rewriting it

Add a read-only audit query for reciprocal pairs where:

- A owns the group containing B; and
- B owns the group containing A.

Report any existing pairs before deployment. Do not automatically detach either
user because choosing which membership to preserve is a business/data decision.

### 5. Document the join rule

Document the new rejection behavior for `POST /api/auth/join-group` in the
relevant API/Flutter handoff documentation. The request and successful response
shapes do not change.

### 6. Defensively protect account groups

The exact account sequence is normally blocked by the current role rules:

- only an `employee` can be assigned to an account group;
- only an `admin` or `seller` can own the target account group.

However, account roles can be updated after assignment, and `updateAccount`
does not reconcile or validate existing `accountGroupId` and owned-group state.
The following sequence can therefore recreate the same bug:

1. Employee B joins seller/admin A's account group.
2. B is changed to `seller` and A is changed to `employee`.
3. A is assigned to B's account group.

Add a defensive reciprocal check to `assignAccountParent` even though the role
checks cover ordinary assignments:

- find any account group owned by the joining account;
- reject when the requested parent already belongs to that group;
- perform the check before creating the requested parent's group or changing
  `accountGroupId`;
- keep the existing sorted account-row locking, which already avoids opposite
  lock order for the two directly involved accounts;
- use a separate Traditional Chinese account-group error constant so the
  wording can refer to parent/employee account semantics clearly.

Also add a read-only audit for reciprocal account-group pairs. Do not silently
change account roles or memberships as part of this bug fix.

Role-transition cleanup is a related integrity problem but needs an explicit
product decision: changing an employee to seller may need to detach it from its
current parent, while changing a seller/admin with employees to employee may
need to be rejected. Record and handle that as a follow-up rather than choosing
a destructive policy in this fix.

## Verification Matrix

- [ ] Self-referral is rejected.
- [ ] B can join A's group when neither relationship exists.
- [ ] After B joins A, A cannot join B.
- [ ] After A joins B, B cannot join A.
- [ ] Rejoining the same group succeeds without changing membership.
- [ ] Switching between unrelated groups continues to work.
- [ ] A failed reciprocal join does not create an unnecessary group for the
      referrer.
- [ ] Simultaneous `A -> B` and `B -> A` requests result in exactly one
      successful membership and one rejected request, without deadlock.
- [ ] User profile `referralCount`, member level, and group ad-view aggregation
      remain correct after allowed joins.
- [ ] The existing-cycle audit query identifies reciprocal pairs without
      mutating them.
- [ ] A valid employee can still be assigned to an unrelated seller/admin
      account group.
- [ ] Account self-assignment remains rejected.
- [ ] A reciprocal account-group assignment is rejected when legacy or
      role-transitioned data makes the state possible.
- [ ] The account reciprocal-pair audit is read-only.
- [ ] `git diff --check` passes.
- [ ] `npm run build` passes.

## Out of Scope

- Automatically repairing existing reciprocal memberships.
- Preventing longer multi-user cycles such as `A -> B -> C -> A`; this plan
  addresses the reported direct reciprocal bug. If the product rule is that the
  entire referral graph must be acyclic, add transitive cycle detection as a
  separate requirement before implementation.
- Changing how referral counts, levels, coins, or group ad views are calculated.
- Adding or removing groups through a migration.
- Automatically detaching account employees or dissolving account groups when
  an account role changes.
