import { z } from "zod";
import { validatePassword, validateRealName, validateCellPhone } from "../../lib/accountProfile";
import {
  idParams,
  nonEmptyString,
  paginationQuery,
  requireAtLeastOneUpdateField,
  uuid,
} from "./common";

const accountRole = z.enum(["admin", "seller", "employee"]);
const accountUpdateRole = z.enum(["seller", "employee"]);
const accountStatus = z.enum(["active", "inactive", "banned"]);

const password = nonEmptyString.refine(validatePassword, "Password must be 8+ characters, at most 72 UTF-8 bytes, and include uppercase, lowercase, number and special character.");
const profile = z.object({
  name: nonEmptyString,
  realName: nonEmptyString.refine((value) => !validateRealName(value), "Invalid realName"),
  phone: nonEmptyString.refine((value) => !validateCellPhone(value), "Invalid phone"),
  address: z.string().optional(),
});

export const accountValidation = {
  resendVerificationBody: z.object({ callbackUrl: z.url().max(2048).optional() }).strict().default({}),
  verifyEmailBody: z.object({ token: z.string().max(256) }).strict(),
  requestEmailChangeBody: z.object({ newEmail: z.email().max(320), password: z.string().min(1).max(256), callbackUrl: z.url().max(2048).optional() }).strict(),
  registerBody: profile.partial().extend({ email: z.email(), password }).superRefine((value, context) => {
    const supplied = [value.name, value.realName, value.phone].filter((v) => v !== undefined).length;
    if ((supplied > 0 && supplied < 3) || (value.address !== undefined && supplied !== 3)) {
      context.addIssue({ code: "custom", message: "Provide all of name, realName and phone, or omit all profile fields." });
    }
  }),
  completeProfileBody: profile.strict(),
  forgotPasswordBody: z.object({ email: z.email().max(320), callbackUrl: z.url().max(2048).optional() }).strict(),
  resetPasswordBody: z.object({ token: z.string().max(256), newPassword: password }).strict(),
  subAccountCreateBody: z.object({
    parentId: uuid.optional(),
    name: nonEmptyString,
    realName: nonEmptyString,
    email: z.email(),
    password: nonEmptyString,
    phone: nonEmptyString,
    address: z.string().optional(),
  }),
  loginBody: z.object({
    email: z.email(),
    password: nonEmptyString,
  }),
  updateBody: requireAtLeastOneUpdateField(
    z.object({
      id: uuid,
      name: nonEmptyString.optional(),
      realName: nonEmptyString.optional(),
      email: z.email().optional(),
      phone: nonEmptyString.optional(),
      address: z.string().optional(),
      avatarUrl: z.url().nullable().optional(),
      avatar_url: z.url().nullable().optional(),
      role: accountUpdateRole.optional(),
      status: accountStatus.optional(),
    }),
    ["id"],
  ),
  changePasswordBody: z.object({
    id: uuid,
    oldPassword: nonEmptyString,
    newPassword: password,
  }),
  listQuery: paginationQuery.extend({
    search: z.string().optional(),
    role: accountRole.optional(),
    status: accountStatus.optional(),
    sellerId: uuid.optional(),
    accountGroupId: uuid.optional(),
    parentId: uuid.optional(),
  }),
  idParams,
  assignParentBody: z.object({
    parentId: uuid,
  }),
};
