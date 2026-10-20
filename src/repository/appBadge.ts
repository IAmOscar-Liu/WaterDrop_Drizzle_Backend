import { and, asc, eq, inArray, sql } from "drizzle-orm";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BadgeSnapshot = {
  version: number; total: number; claimableUnopenedBoxes: number;
  unreadNotifications: number; unreadChatMessages: number; nextReconcileAt: string | null;
};
export async function invalidateBadge(tx: Tx, userId: string, forceDelivery = false) {
  await tx.insert(schema.userBadgeWorkTable).values({ userId, forceDelivery });
}

export async function reconcileBadge(userId: string): Promise<BadgeSnapshot> {
  return db.transaction(async (tx) => {
    // Only reconcilers acquire this lock. They never acquire domain/feed locks.
    // READ COMMITTED + one aggregate statement AFTER the lock avoids stale
    // snapshots from transactions that waited for another reconciler to commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`badge:${userId}`}, 0))`);
    const user = await tx.query.userTable.findFirst({ columns: { id: true }, where: eq(schema.userTable.id, userId) });
    if (!user) throw new CustomError("App user required", 401);
    await tx.insert(schema.userBadgeStateTable).values({ userId }).onConflictDoNothing();
    const [state] = await tx.select().from(schema.userBadgeStateTable).where(eq(schema.userBadgeStateTable.userId, userId)).for("update");
    // One PostgreSQL statement supplies a consistent cross-domain read point.
    // The evaluation clock is taken after waiting for the reconciliation lock.
    const [counts] = await tx.execute<{
      boxes: number; notifications: number; chats: number; boundary: string | null;
    }>(sql`
      with moment as materialized (select clock_timestamp() as at),
      owner as (select coalesce((select name from pg_timezone_names where lower(name) = lower(u.timezone) limit 1), 'Asia/Taipei') as tz
        from users u where u.id = ${userId}),
      candidates as (
        select b.*, m.at,
          case when b.user_local_date is not null and b.timezone_snapshot is not null
            then coalesce((select name from pg_timezone_names where lower(name)=lower(b.timezone_snapshot) limit 1), o.tz)
            else o.tz end as tz,
          b.user_local_date is not null and b.timezone_snapshot is not null as has_snapshot
        from treasure_boxes b cross join moment m cross join owner o
        where b.user_id=${userId} and b.is_active=true and b.is_opened=false
          and (b.accounting_status is null or b.accounting_status in ('claimable','zero_reward'))
          and (b.claim_deadline_at is null or b.claim_deadline_at > m.at)
      ), eligible as (
        select * from candidates where
          (case when has_snapshot then user_local_date else (earned_at at time zone tz)::date end) = (at at time zone tz)::date
      )
      select (select count(*)::integer from eligible) as boxes,
        (select min(least(claim_deadline_at, (((at at time zone tz)::date + 1)::timestamp at time zone tz)))::text from eligible) as boundary,
        (select count(*)::integer from user_notifications where user_id=${userId} and is_read=false and deleted_at is null) as notifications,
        (select count(*)::integer from chat_messages m join chat_rooms r on r.id=m.chat_room_id
          where r.user_id=${userId} and r.status='active' and m.is_read=false and m.sender_type <> 'user') as chats
    `);
    const changed = state.version === 0 || state.claimableUnopenedBoxes !== counts.boxes
      || state.unreadNotifications !== counts.notifications || state.unreadChatMessages !== counts.chats;
    const version = state.version + (changed ? 1 : 0);
    const next = counts.boundary ? new Date(counts.boundary) : null;
    if (changed || (state.nextReconcileAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      await tx.update(schema.userBadgeStateTable).set({ version, claimableUnopenedBoxes: counts.boxes,
        unreadNotifications: counts.notifications, unreadChatMessages: counts.chats, nextReconcileAt: next,
      }).where(eq(schema.userBadgeStateTable.userId, userId));
    }
    return { version, total: counts.boxes + counts.notifications + counts.chats,
      claimableUnopenedBoxes: counts.boxes, unreadNotifications: counts.notifications,
      unreadChatMessages: counts.chats, nextReconcileAt: next?.toISOString() ?? null };
  });
}

export async function badgeWorkUsers(limit = 50) {
  // Pending domain writes, elapsed deadlines, REST-discovered changes and rollout
  // bootstrap all reach the same worker. No reliance on an active app session.
  return db.execute<{ id: string }>(sql`
    select u.id from users u left join user_badge_states s on s.user_id=u.id
    where (s.retry_at is null or s.retry_at <= clock_timestamp()) and
      (s.user_id is null or s.next_reconcile_at <= clock_timestamp() or s.version > s.last_sent_version
       or exists(select 1 from user_badge_work w where w.user_id=u.id))
    order by coalesce(s.retry_at, s.next_reconcile_at, '-infinity'::timestamptz), u.id limit ${limit}
  `);
}
export async function captureBadgeWork(userId: string) {
  const work = await db.select().from(schema.userBadgeWorkTable).where(eq(schema.userBadgeWorkTable.userId, userId))
    .orderBy(asc(schema.userBadgeWorkTable.createdAt)).limit(1000);
  const state = await db.query.userBadgeStateTable.findFirst({ where: eq(schema.userBadgeStateTable.userId, userId) });
  return { work, lastSentVersion: state?.lastSentVersion ?? 0 };
}
export async function finishBadgeWork(userId: string, ids: string[], version: number) {
  await db.transaction(async (tx) => {
    // Do not acknowledge concurrent inserts (including new-device registrations).
    if (ids.length) await tx.delete(schema.userBadgeWorkTable).where(and(eq(schema.userBadgeWorkTable.userId, userId), inArray(schema.userBadgeWorkTable.id, ids)));
    await tx.update(schema.userBadgeStateTable).set({ lastSentVersion: sql`greatest(${schema.userBadgeStateTable.lastSentVersion}, ${version})`, failures: 0, retryAt: null })
      .where(eq(schema.userBadgeStateTable.userId, userId));
  });
}
export async function retryBadgeWork(userId: string) {
  await db.update(schema.userBadgeStateTable).set({ failures: sql`least(${schema.userBadgeStateTable.failures}+1, 10)`,
    retryAt: sql`clock_timestamp() + least(900, 30 * power(2, least(${schema.userBadgeStateTable.failures}, 5))) * interval '1 second'`,
  }).where(eq(schema.userBadgeStateTable.userId, userId));
}

export async function userPushTokens(userId: string, onlyTokens?: string[]) {
  return db.select({ fcmToken: schema.deviceTokenTable.fcmToken }).from(schema.deviceTokenTable)
    .where(and(eq(schema.deviceTokenTable.userId, userId), onlyTokens ? inArray(schema.deviceTokenTable.fcmToken, onlyTokens) : undefined));
}
export async function pushTokenOwners(tokens: string[]) {
  if (!tokens.length) return [];
  return db.select({ userId: schema.deviceTokenTable.userId, fcmToken: schema.deviceTokenTable.fcmToken })
    .from(schema.deviceTokenTable).where(inArray(schema.deviceTokenTable.fcmToken, tokens));
}
