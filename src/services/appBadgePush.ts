import type { BatchResponse, MulticastMessage } from "firebase-admin/messaging";
import { reconcileBadge, pushTokenOwners, userPushTokens, BadgeSnapshot } from "../repository/appBadge";
import { sendRawMulticastPushNotification } from "../lib/sendNotification";

export const badgePushTransport = { send: sendRawMulticastPushNotification };
const invalidTokenCodes = new Set(["messaging/invalid-registration-token", "messaging/registration-token-not-registered"]);
export function badgePayload(payload: Omit<MulticastMessage, "tokens">, userId: string, badge: BadgeSnapshot) {
  return { ...payload, data: { ...payload.data, badgeUserId: userId, badgeVersion: String(badge.version), badgeTotal: String(badge.total) },
    apns: { ...payload.apns, headers: { ...payload.apns?.headers, "apns-push-type": "alert" },
      payload: { ...payload.apns?.payload, aps: { ...payload.apns?.payload?.aps, badge: badge.total } } } };
}
async function dispatch(message: MulticastMessage): Promise<BatchResponse> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([badgePushTransport.send(message), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Push timed out")), 15000);
    })]);
    if (!result) throw new Error("Push transport failed");
    return result;
  } finally { clearTimeout(timer); }
}

// Re-read token ownership immediately before dispatch. Queued provider deliveries
// cannot be recalled on logout, so Flutter must still reconcile after account switch.
export async function sendUserPush(userId: string, payload: Omit<MulticastMessage, "tokens">, onlyTokens?: string[]) {
  const badge = await reconcileBadge(userId);
  const tokens = [...new Set((await userPushTokens(userId, onlyTokens)).map(t => t.fcmToken))];
  let retry = false;
  const responses: BatchResponse["responses"] = [];
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const current = await userPushTokens(userId, tokens.slice(offset, offset + 500));
    if (!current.length) continue;
    const result = await dispatch({ ...badgePayload(payload, userId, badge), tokens: current.map(t => t.fcmToken) });
    responses.push(...result.responses);
    if (result.responses.some(r => !r.success && !invalidTokenCodes.has(r.error?.code ?? ""))) retry = true;
  }
  return { badge, retry, responses };
}

// Existing callers may pass mixed-user multicast lists. Resolve ownership before
// enrichment, preserve recipient selection, and never share a total across users.
export async function sendBadgeAwareMulticast(message: MulticastMessage): Promise<BatchResponse | void> {
  if (!message.tokens.length) return;
  try {
    const { tokens, ...payload } = message;
    const owners = await pushTokenOwners([...new Set(tokens)]);
    const groups = new Map<string, string[]>();
    for (const owner of owners) groups.set(owner.userId, [...(groups.get(owner.userId) ?? []), owner.fcmToken]);
    const responses: BatchResponse["responses"] = [];
    for (const [userId, selected] of groups) responses.push(...(await sendUserPush(userId, payload, selected)).responses);
    // Unregistered arbitrary-token admin pushes retain push-only behavior, without
    // invented badge metadata. Normal user workflows use registered tokens.
    const known = new Set(owners.map(o => o.fcmToken));
    const unknown = [...new Set(tokens)].filter(t => !known.has(t));
    for (let offset = 0; offset < unknown.length; offset += 500) {
      responses.push(...(await dispatch({ ...payload, tokens: unknown.slice(offset, offset + 500) })).responses);
    }
    return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length };
  } catch {
    console.error("[badge-push] Push failed; persisted badge work remains available.");
  }
}
