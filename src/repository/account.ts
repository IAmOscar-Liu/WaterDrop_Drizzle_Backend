import bcrypt from "bcrypt";
import { count, eq, ilike, inArray, isNull, or, SQL, sql, and } from "drizzle-orm";
import {
  RECIPROCAL_ACCOUNT_GROUP_ASSIGNMENT_ERROR_MESSAGE,
} from "../constants/group";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";
import { recordAdminActivityWithTx } from "./adminActivity";
import { getActiveAdminAccount, requireNonEmployee } from "./adminScope";
import { initializeSidebarReadStatesWithTx } from "./sidebarNotification";

// Admin account password: test1234

/**
 * Creates a new account (seller or admin).
 * @param accountData The data for the new account.
 * @returns The newly created account.
 */
export async function createAccount(accountData: schema.NewAccount) {
  // In a real app, you would hash the password here.
  // For example, using bcrypt:
  const hashedPassword = await bcrypt.hash(accountData.password, 10);
  const dataToInsert = { ...accountData, password: hashedPassword };

  const newAccount = await db.transaction(async (tx) => {
    const [createdAccount] = await tx
      .insert(schema.accountTable)
      .values(dataToInsert)
      .returning();

    await tx.insert(schema.accountWalletTable).values({
      accountId: createdAccount.id,
    });
    await initializeSidebarReadStatesWithTx(
      tx,
      createdAccount.id,
      createdAccount.role === "admin" ? "platform" : createdAccount.id,
      createdAccount.createdAt,
    );

    return createdAccount;
  });

  return await getAccountById(newAccount.id);
}

/**
 * Retrieves an account by email and verifies the password.
 * @param email The account's email.
 * @param password The account's plain-text password.
 * @returns The account object without the password hash if credentials are valid.
 * @throws {CustomError} If the email is not found or the password does not match.
 */
export async function getAccountByEmailAndPassword(
  email: string,
  password: string
) {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.email, email));
  if (!account) {
    throw new CustomError("Invalid email or password", 404);
  }

  if (account.status !== "active" || account.deletedAt) {
    throw new CustomError("Account is inactive or no longer available", 403);
  }

  const isPasswordValid = await bcrypt.compare(password, account.password);

  if (!isPasswordValid) {
    throw new CustomError("Invalid email or password", 404);
  }

  return await getAccountById(account.id);
}

export type CreateSubAccountInput = {
  parentId?: string;
  name: string;
  realName: string;
  email: string;
  password: string;
  phone: string;
  address?: string;
};

export async function createSubAccount(
  requesterId: string,
  input: CreateSubAccountInput,
) {
  const requester = await requireNonEmployee(requesterId);
  const parentId = requester.role === "admin" ? input.parentId : requester.id;
  if (!parentId) {
    throw new CustomError("parentId is required for a platform admin", 400);
  }
  if (requester.role !== "admin" && input.parentId && input.parentId !== requester.id) {
    throw new CustomError("A seller may create employees only for itself", 403);
  }

  const parent = await getActiveAdminAccount(parentId);
  if (parent.role !== "seller") {
    throw new CustomError("The parent account must be an active seller", 400);
  }
  const hashedPassword = await bcrypt.hash(input.password, 10);

  try {
    const createdId = await db.transaction(async (tx) => {
      let [group] = await tx
        .select()
        .from(schema.accountGroupTable)
        .where(eq(schema.accountGroupTable.parentId, parentId))
        .for("update");
      if (!group) {
        [group] = await tx
          .insert(schema.accountGroupTable)
          .values({ parentId })
          .returning();
      }

      const [created] = await tx
        .insert(schema.accountTable)
        .values({
          name: input.name.trim(),
          realName: input.realName.trim(),
          email: input.email.trim().toLowerCase(),
          password: hashedPassword,
          phone: input.phone,
          address: input.address,
          role: "employee",
          status: "active",
          accountGroupId: group.id,
        })
        .returning();
      await tx.insert(schema.accountWalletTable).values({ accountId: created.id });
      await initializeSidebarReadStatesWithTx(
        tx,
        created.id,
        parentId,
        created.createdAt,
      );
      await recordAdminActivityWithTx(tx, {
        actorAccountId: requesterId,
        sellerId: parentId,
        eventType: "account.sub_account_created",
        entityType: "account",
        entityId: created.id,
        metadata: { email: created.email },
      });
      return created.id;
    });
    return getAccountById(createdId);
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      throw new CustomError("An account with this email already exists", 409);
    }
    throw error;
  }
}

export async function softDeleteSubAccount(
  requesterId: string,
  targetAccountId: string,
) {
  const requester = await requireNonEmployee(requesterId);
  return db.transaction(async (tx) => {
    const target = await tx.query.accountTable.findFirst({
      where: eq(schema.accountTable.id, targetAccountId),
      with: { group: true },
    });
    if (!target) throw new CustomError("Account not found", 404);
    if (target.role !== "employee") {
      throw new CustomError("Only employee sub-accounts can be deleted", 409);
    }
    const parentId = target.group?.parentId;
    if (!parentId) {
      throw new CustomError("Employee is not assigned to a seller", 409);
    }
    if (requester.role !== "admin" && requester.id !== parentId) {
      throw new CustomError("You cannot delete another seller's employee", 403);
    }
    if (target.deletedAt) {
      const { password: _, ...result } = target;
      return result;
    }

    const [updated] = await tx
      .update(schema.accountTable)
      .set({
        status: "inactive",
        deletedAt: new Date(),
        deletedByAccountId: requesterId,
        updatedAt: new Date(),
      })
      .where(eq(schema.accountTable.id, targetAccountId))
      .returning();
    await recordAdminActivityWithTx(tx, {
      actorAccountId: requesterId,
      sellerId: parentId,
      eventType: "account.sub_account_deleted",
      entityType: "account",
      entityId: targetAccountId,
    });
    const { password: _, ...result } = updated;
    return result;
  });
}

export async function getAccountById(accountId: string): Promise<
  Omit<schema.Account, "password"> & {
    parent?: Omit<schema.Account, "password"> | null;
  }
> {
  const account = await db.query.accountTable.findFirst({
    where: eq(schema.accountTable.id, accountId),
    with: {
      group: {
        with: {
          parent: true,
        },
      },
    },
  });

  if (!account) {
    throw new CustomError("Account not found", 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, group, ...accountInfo } = account;
  const { password: __, ...parentInfo } = account.group?.parent ?? {};
  return {
    ...accountInfo,
    parent:
      Object.keys(parentInfo).length > 0
        ? (parentInfo as Omit<schema.Account, "password">)
        : null,
  };
}

export async function isAccountAdmin(accountId: string): Promise<boolean> {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId));

  if (!account) return false;

  return account.role === "admin";
}

/**
 * Updates an account's profile information (excluding password).
 * @param accountId The ID of the account to update.
 * @param updates The fields to update.
 * @returns The updated account object.
 * @throws {CustomError} If the account is not found.
 */
export async function updateAccount(
  accountId: string,
  updates: Partial<
    Omit<
      schema.Account,
      | "id"
      | "accountGroupId"
      | "password"
      | "lastLoginAt"
      | "createdAt"
      | "updatedAt"
    >
  >
) {
  const [updatedAccount] = await db
    .update(schema.accountTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.accountTable.id, accountId))
    .returning();

  if (!updatedAccount) {
    throw new CustomError("Account not found", 404);
  }
  return await getAccountById(accountId);
}

export async function updateAccountLastLogin(accountId: string) {
  const [updatedAccount] = await db
    .update(schema.accountTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.accountTable.id, accountId))
    .returning();

  if (!updatedAccount) {
    throw new CustomError("Account not found", 404);
  }

  return await getAccountById(accountId);
}

export async function assignAccountParent(accountId: string, parentId: string) {
  if (accountId === parentId)
    throw new CustomError("accountId and parentId cannot be the same", 400);

  await db.transaction(async (tx) => {
    const lockedAccounts = new Map<string, schema.Account>();

    for (const id of [accountId, parentId].sort()) {
      const [account] = await tx
        .select()
        .from(schema.accountTable)
        .where(eq(schema.accountTable.id, id))
        .for("update");

      if (account) {
        lockedAccounts.set(account.id, account);
      }
    }

    const myAccount = lockedAccounts.get(accountId);
    const parentAccount = lockedAccounts.get(parentId);

    if (!myAccount) throw new CustomError("Account not found", 404);
    if (!parentAccount) {
      throw new CustomError(`Parent account "${parentId}" not found.`, 404);
    }
    if (myAccount.role !== "employee") {
      throw new CustomError(
        "Only employees can be assigned to a parent account",
        400,
      );
    }
    if (parentAccount.role !== "admin" && parentAccount.role !== "seller") {
      throw new CustomError(
        `Parent account "${parentId}" is not an admin or seller.`,
        400,
      );
    }

    const ownedAccountGroups = await tx
      .select({ id: schema.accountGroupTable.id })
      .from(schema.accountGroupTable)
      .where(eq(schema.accountGroupTable.parentId, myAccount.id))
      .for("update");

    if (
      ownedAccountGroups.some(
        (group) => group.id === parentAccount.accountGroupId,
      )
    ) {
      throw new CustomError(
        RECIPROCAL_ACCOUNT_GROUP_ASSIGNMENT_ERROR_MESSAGE,
        400,
      );
    }

    // 2. Find the account group by parentId.
    let [accountGroup] = await tx
      .select()
      .from(schema.accountGroupTable)
      .where(eq(schema.accountGroupTable.parentId, parentId))
      .for("update");

    // 3. If account group doesn't exist, create it.
    if (!accountGroup) {
      [accountGroup] = await tx
        .insert(schema.accountGroupTable)
        .values({ parentId: parentAccount.id })
        .returning();
    }

    if (myAccount.accountGroupId === accountGroup.id) return;

    // 4. Make current account join the group.
    const [updatedAccount] = await tx
      .update(schema.accountTable)
      .set({ accountGroupId: accountGroup.id })
      .where(eq(schema.accountTable.id, accountId))
      .returning();

    if (!updatedAccount) {
      throw new CustomError(`Account with id "${accountId}" not found.`, 404);
    }
  });

  return await getAccountById(accountId);
}

export async function listAccountEmployees(accountId: string) {
  const [accountGroup] = await db
    .select()
    .from(schema.accountGroupTable)
    .where(eq(schema.accountGroupTable.parentId, accountId));

  if (!accountGroup) return [];

  const employees = await db
    .select()
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.accountGroupId, accountGroup.id),
        isNull(schema.accountTable.deletedAt),
      ),
    );

  return employees.map(({ password, ...accountInfo }) => accountInfo);
}

/**
 * Updates an account's password.
 * @param accountId The ID of the account to update.
 * @param oldPassword The current plain-text password for verification.
 * @param newPassword The new plain-text password.
 * @returns The updated account object.
 * @throws {CustomError} If the account is not found.
 */
export async function changeAccountPassword(
  accountId: string,
  oldPassword: string,
  newPassword: string
) {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId));

  if (!account) {
    throw new CustomError("Account not found", 404);
  }

  const isOldPasswordValid = await bcrypt.compare(
    oldPassword,
    account.password
  );
  if (!isOldPasswordValid) {
    throw new CustomError("Incorrect old password", 401);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const [updatedAccount] = await db
    .update(schema.accountTable)
    .set({ password: hashedPassword, updatedAt: new Date() })
    .where(eq(schema.accountTable.id, accountId))
    .returning();

  if (!updatedAccount) throw new CustomError("Account not found", 404);

  return await getAccountById(accountId);
}

export interface ListAccountsParams extends PaginationParams {
  search?: string;
  role?: schema.NewAccount["role"];
  status?: schema.NewAccount["status"];
  sellerId?: string;
  accountGroupId?: string;
  parentId?: string;
}

export async function listAccounts({
  page = 1,
  limit = 10,
  search,
  role,
  status,
  sellerId,
  accountGroupId,
  parentId,
}: ListAccountsParams) {
  const pagination = getPagination(page, limit);
  const conditions: Array<SQL | undefined> = [];
  conditions.push(isNull(schema.accountTable.deletedAt));

  if (search) {
    conditions.push(
      or(
        ilike(schema.accountTable.email, `%${search}%`),
        ilike(schema.accountTable.name, `%${search}%`),
      ),
    );
  }

  if (role) {
    conditions.push(eq(schema.accountTable.role, role));
  }

  if (status) {
    conditions.push(eq(schema.accountTable.status, status));
  }

  if (sellerId && parentId && sellerId !== parentId) {
    throw new CustomError(
      "sellerId and parentId must match when both are provided.",
      400,
    );
  }

  if (accountGroupId) {
    conditions.push(eq(schema.accountTable.accountGroupId, accountGroupId));
  }

  const effectiveParentId = parentId ?? sellerId;
  if (effectiveParentId) {
    const parentGroups = await db
      .select({ id: schema.accountGroupTable.id })
      .from(schema.accountGroupTable)
      .where(eq(schema.accountGroupTable.parentId, effectiveParentId));
    conditions.push(
      parentGroups.length > 0
        ? inArray(
            schema.accountTable.accountGroupId,
            parentGroups.map(({ id }) => id),
          )
        : sql`false`,
    );
  }

  const whereClause = compactConditions(conditions);

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.accountTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // Query for the paginated accounts
  const accountsWithPassword = await db.query.accountTable.findMany({
    where: whereClause,
    with: {
      group: {
        with: {
          parent: true,
        },
      },
    },
    limit: pagination.limit,
    offset: pagination.offset,
    orderBy: (accounts, { desc }) => [desc(accounts.createdAt)],
  });

  const accounts = accountsWithPassword.map(
    ({ password, group, ...accountInfo }) => {
      const { password: __, ...parentInfo } = group?.parent ?? {};
      return {
        ...accountInfo,
        parent:
          Object.keys(parentInfo).length > 0
            ? (parentInfo as Omit<schema.Account, "password">)
            : group?.parent ?? null,
      };
    },
  );

  return {
    accounts,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}
