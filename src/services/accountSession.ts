import { createAccountSession, revokeAccountSession, rotateAccountRefreshToken } from "../repository/accountSession";
import { CustomError, handleServiceError } from "../lib/error";
import { generateAdminAccessToken, validateAdminAccessToken } from "../lib/token";

function sessionError(error: unknown) {
  if (error instanceof CustomError) return handleServiceError(error);
  console.error("[account-session] Session operation failed.");
  return { success: false as const, statusCode: 500, message: "Account session operation failed" };
}
function requireSigningConfiguration() {
  if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_NAME) throw new CustomError("Account sessions are not configured", 503);
}
function response(data: Awaited<ReturnType<typeof createAccountSession>>) {
  return { success: true as const, data: {
    token: generateAdminAccessToken({ id: data.session.accountId, credentialVersion: data.session.credentialVersion }, data.session.id, data.session.expiresAt),
    refreshToken: data.refreshToken, expiresAt: data.session.expiresAt,
  } };
}
export default {
  async start(accountId: string, credentialVersion: number) {
    try { requireSigningConfiguration(); return response(await createAccountSession(accountId, credentialVersion)); }
    catch (error) { return sessionError(error); }
  },
  async refresh(raw?: string) {
    try {
      requireSigningConfiguration();
      if (!raw) throw new CustomError("Refresh token doesn't exist", 401, "REFRESH_TOKEN_MISSING");
      return response(await rotateAccountRefreshToken(raw));
    } catch (error) { return sessionError(error); }
  },
  async logout(raw?: string, bearer?: string) {
    try {
      const payload = validateAdminAccessToken(bearer);
      await revokeAccountSession(raw, payload ? { accountId: payload.data.id, sessionId: payload.sid } : undefined);
      return { success: true as const, data: "OK" };
    } catch (error) { return sessionError(error); }
  },
};
