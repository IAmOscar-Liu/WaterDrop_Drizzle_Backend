import { z } from "zod";
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

export const accountValidation = {
  registerBody: z.object({
    name: nonEmptyString,
    realName: nonEmptyString,
    email: z.email(),
    password: nonEmptyString,
    phone: nonEmptyString,
    address: z.string().optional(),
    role: accountUpdateRole.optional(),
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
      role: accountUpdateRole.optional(),
      status: accountStatus.optional(),
    }),
    ["id"],
  ),
  changePasswordBody: z.object({
    id: uuid,
    oldPassword: nonEmptyString,
    newPassword: nonEmptyString,
  }),
  listQuery: paginationQuery.extend({
    search: z.string().optional(),
    role: accountRole.optional(),
    status: accountStatus.optional(),
  }),
  idParams,
  assignParentBody: z.object({
    parentId: uuid,
  }),
};
