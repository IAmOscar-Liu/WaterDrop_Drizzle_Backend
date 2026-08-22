# Refund Item Log Plan

## Goal

Add an append-only status history for each row in `refund_items`, modeled after
`delivery_logs`.

Required API behavior:

- `GET /api/admin/refund/:id` returns `logs` on the refund object.
- `GET /api/admin/order/:id` returns `logs` on every nested refund object.
- `GET /api/order/:id` returns the same nested refund logs for the authenticated
  Flutter user.
- `PATCH /api/admin/refund/:id/status` writes a refund log in the same database
  transaction as the refund update and its completion side effects.

Refund list APIs remain unchanged and do not load logs.

## Proposed Log Model

Add `refund_logs` to `src/db/schema.ts`:

```ts
{
  id: string;
  refundItemId: string;
  status: "pending" | "processing" | "completed" | "cancelled";
  message: string | null;
  createdAt: Date;
}
```

Schema details:

- `id`: UUID primary key with `defaultRandom()`.
- `refundItemId`: required foreign key to `refund_items.id` with
  `onDelete: "cascade"`.
- `status`: required `refundStatusEnum`; it records the refund status after the
  associated action.
- `message`: nullable, log-specific text. It is independent of
  `refund_items.note`.
- `createdAt`: required timestamp with timezone and `defaultNow()`.
- Add an index on `(refundItemId, createdAt)` for ordered history reads.
- Add `refundItem.logs` and `refundLog.refundItem` Drizzle relations.
- Export `RefundLog` and `NewRefundLog` inferred types.

The first version should stay append-only and should not expose update/delete
operations for individual log rows.

## Message Semantics

- `refund_items.note` keeps its current refund/application-level meaning and
  remains independently mutable through the PATCH endpoint.
- Add `message?: string` to `PATCH /api/admin/refund/:id/status` for the refund
  log message.
- `message` does not update or copy `refund_items.note`.
- A status-only log may have `message: null`.
- Validate a provided message as a non-empty string.

All refund log messages will be visible through the non-admin order detail API,
as explicitly requested. Do not place admin-only or sensitive messages in this
field.

## Creation and Existing Data

### New refunds

When either admin or Flutter creates a refund item, insert its initial log in
the same transaction:

```ts
{
  refundItemId: newRefundItem.id,
  status: newRefundItem.status,
  message: "申請退貨",
}
```

This ensures every new refund starts with a `pending` history entry. The
refund's application note remains on `refund_items.note` and is not copied into
the log message.

### Existing refunds

Do not backfill existing refund items. Existing refunds may return `logs: []`;
their history starts only after this feature is deployed and a qualifying
status/message update occurs.

## PATCH Write Path

Update `updateRefundItemStatus` in `src/repository/refund.ts`:

1. Keep the existing transaction and `FOR UPDATE` lock on the refund item.
2. Keep all current status, quantity, refund amount, stock-restock, and coin
   validation/side effects unchanged.
3. Keep request `note` mapped to `refund_items.note` and handle the new request
   `message` independently.
4. Apply the refund item update and completion side effects.
5. Read the latest refund log for message comparison, ordered by
   `createdAt DESC`.
6. Insert one `refund_logs` row before committing only when:
   - the refund item's status actually changed; or
   - `message` was provided and differs from the latest log's message.
7. The inserted row uses:
   - the resulting refund status;
   - the provided message, or `null` when the log is caused only by a status
     change;
   - the updated refund item ID.
8. A PATCH that changes only quantity, amounts, reason, refund-level `note`, or
   metadata must not insert a log unless it also changes status or supplies a
   changed log message.
9. If status and message are both unchanged, do not insert a duplicate log.
10. If any update, side effect, or log insertion fails, roll back everything.
11. Do not create a log for rejected requests.

For an existing refund with no logs, a new message creates its first log. An
explicit PATCH containing the same status as the refund item and no message
does not create a log.

Keep the PATCH response shape unchanged unless the frontend specifically asks
for the newly created log in the response; clients can reload the detail API to
obtain the ordered history.

## Notification Side Effects

Trigger notification work from `src/services/refund.ts` only after the
repository transaction commits. Every notification workflow must be
fire-and-forget with a concise `.catch(...)` error log.

On refund creation:

- send an FCM push notification;
- create the matching in-app `order_status` notification;
- send a refund-created email using the same environment-aware order deep link
  as the order-created email;
- use push data `{ command: "refund_updated", orderId, refundItemId }` so
  Flutter can open order detail.

On refund updates:

- notify only when the refund status actually changes;
- send the FCM push and matching in-app notification;
- do not send email for status changes;
- do not notify for message-only or other refund-field updates.

## Read Paths

### Admin refund detail

For `GET /api/admin/refund/:id`:

- Load logs only in the detail path, ordered by `createdAt DESC`.
- Return them at the refund object's root:

```ts
{
  ...refund,
  logs: RefundLog[],
  orderItem: { ... }
}
```

Do not add logs to the shared refund-list query. The current
`RefundWithOrderItem` Swagger component is also used by list responses, so add
a separate detail component or a detail-only schema extension rather than
claiming that refund list rows contain logs.

### Admin and Flutter order detail

`src/repository/order.ts#getOrderById` serves both admin and non-admin detail
flows through its options. Extend the nested relation once:

```ts
refundItems: {
  with: {
    logs: {
      orderBy: createdAt DESC,
    },
  },
  orderBy: refund createdAt DESC,
}
```

This should produce:

```ts
items[].refundItems[].logs: RefundLog[];
```

Verify both routes:

- `GET /api/admin/order/:id`
- `GET /api/order/:id`

No logs are required on order list endpoints.

## API Validation and Swagger

Update the admin refund PATCH validation and documentation together:

- Keep `note?: string | null` as the independently mutable refund-item note.
- Add `message?: string` as the optional non-empty refund-log message.
- Include `message` in the at-least-one-field validation.
- Document that a log is appended only when status actually changes or a
  provided message differs from the latest log message.

Add a reusable Swagger `RefundLog` schema with `id`, `refundItemId`, `status`,
`message`, and `createdAt`.

Update Swagger for:

- admin refund detail: detail-only `logs` array;
- admin order detail: `refundItems[].logs`;
- Flutter order detail: `refundItems[].logs`.

Update `PRODUCT_VARIANTS_API_CHANGES.md` and
`PRODUCT_VARIANTS_FRONTEND_API_CHANGES.md` only where their refund/order detail
handoff shapes need the new `logs` property. If this feature receives a
separate frontend handoff document, keep the shared files concise and link to
it.

## Files Expected to Change

- `src/db/schema.ts`
- `src/repository/refund.ts`
- `src/repository/order.ts`
- `src/controller/refund.ts` to pass the new PATCH `message`
- `src/middleware/admin/refund.ts`
- `src/routers/admin/admin-refund.ts`
- `src/routers/admin/admin-order.ts`
- `src/routers/order.ts`
- relevant frontend/API Markdown documentation
- generated migration files only when the migration-generation step is run

The service layer should need no structural change unless the PATCH response is
expanded to include the inserted log.

## Migration and Rollout Order

1. Add the refund log schema, relations, types, read paths, write paths,
   validation, Swagger, and Markdown documentation.
2. Run `npm run build` and focused repository/API checks.
3. Generate the additive migration for `refund_logs` and its index.
4. Run the schema migration in the target environment.
5. Deploy the API code that reads and writes refund logs. No data backfill is
   required.
6. Verify admin refund detail and both order-detail APIs return logs newest
   first.

## Verification Checklist

- [ ] Creating an admin refund inserts one initial `pending` log with message
      `申請退貨`.
- [ ] Creating a Flutter refund inserts one initial `pending` log with message
      `申請退貨`.
- [ ] Updating `pending -> processing` inserts one processing log.
- [ ] Updating `processing -> completed` inserts the completed log atomically
      with stock and coin side effects.
- [ ] A failed completion creates neither side effects nor a log.
- [ ] Refund creation returns without waiting for push, email, or in-app
      notification delivery.
- [ ] A real status change returns without waiting for push or in-app
      notification delivery and sends no email.
- [ ] Message-only and non-status updates send no notification.
- [ ] A changed message with unchanged status inserts one log using the current
      refund status.
- [ ] Repeating the latest status and message does not insert a duplicate log.
- [ ] Updating only refund-level `note` does not insert a log.
- [ ] Status-only updates insert a log with `message: null`.
- [ ] Multiple updates preserve every earlier log and message.
- [ ] Admin refund detail returns `logs` newest first.
- [ ] Admin order detail returns `logs` under each refund item.
- [ ] Flutter order detail returns the same nested logs.
- [ ] Refund and order list responses do not load logs.
- [ ] Existing refunds with no history return `logs: []` without errors.
- [ ] Deleting a refund item cascades to its logs.
- [x] `npm run build` passes before migration generation.
