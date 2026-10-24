import { CustomError } from "./error";

/** Bounded process-local protection, not persistent or cross-instance deduplication. */
export function createLogisticsVerificationLimit(now = Date.now) {
  const users = new Map<string, { startedAt: number; count: number; active: boolean }>();
  let active = 0;
  return (userId: string) => {
    const time = now();
    for (const [id, entry] of users) {
      if (!entry.active && time - entry.startedAt >= 60_000) users.delete(id);
    }
    const entry = users.get(userId) ?? { startedAt: time, count: 0, active: false };
    if (entry.active || entry.count >= 5 || active >= 20 || (!users.has(userId) && users.size >= 10_000)) {
      throw new CustomError("驗證請求過於頻繁，請稍後重試", 429, "LOGISTICS_VERIFICATION_LIMIT");
    }
    entry.count++;
    entry.active = true;
    users.set(userId, entry);
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active = false;
      active--;
    };
  };
}
