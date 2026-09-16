// schema.ts
import { relations, sql } from "drizzle-orm";
import { convertIndexToString } from "drizzle-orm/mysql-core";
import {
  boolean,
  bigserial,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { request } from "http";

// Optional: keep providers explicit (add/remove as you need)
export const oauthProviderEnum = pgEnum("oauth_provider", [
  "google",
  "apple",
  "github",
  "facebook",
  "line",
  "password",
  "other",
]);

export const accountRoleEnum = pgEnum("account_role", [
  "admin",
  "seller",
  "employee",
]);
export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "inactive",
  "banned",
]);

export const productStatusEnum = pgEnum("product_status", [
  "active",
  "inactive",
]);

export const productTypeEnum = pgEnum("product_type", [
  "normal",
  "refrigeration",
  "virtual",
]);

export const chatMessageSenderEnum = pgEnum("chat_message_sender", [
  "user",
  "admin",
  "seller",
]);

export const orderPaymentEnum = pgEnum("order_payment", ["Credit", "ATM"]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "payment-processing",
  "paid",
  "failed",
  "expired",
  "canceled",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "processing",
  "completed",
  "cancelled",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "shipped",
  "ready_for_pickup",
  "delivered",
  "returned",
  "cancelled",
  "exception",
  "unknown",
]);

export const deliveryLogisticsTypeEnum = pgEnum("delivery_logistics_type", [
  "CVS",
  "home_delivery",
  "virtual",
]);

export const advertisementStatusEnum = pgEnum("advertisement_status", [
  "active",
  "paused",
  "depleted",
  "archived",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "wallet_funding",
  "view_debit",
  "seller_return_credit",
  "balance_transfer_out",
  "balance_transfer_in",
  "manual_adjustment",
]);

export const accountWalletTransactionTypeEnum = pgEnum(
  "account_wallet_transaction_type",
  ["legacy_opening_balance", "admin_credit", "advertisement_funding_debit"],
);

export const adminSidebarSectionEnum = pgEnum("admin_sidebar_section", [
  "orders",
  "deliveries",
  "refunds",
  "advertisements",
  "chatrooms",
]);

export const coinFundingAccountStatusEnum = pgEnum(
  "coin_funding_account_status",
  ["active", "closing", "closed", "exception"],
);

export const coinSettlementCohortStatusEnum = pgEnum(
  "coin_settlement_cohort_status",
  ["open", "settling", "settled", "exception"],
);

export const advertisementAssignmentStatusEnum = pgEnum(
  "advertisement_assignment_status",
  ["issued", "completed", "expired", "cancelled"],
);

export const treasureBoxRewardCycleStatusEnum = pgEnum(
  "treasure_box_reward_cycle_status",
  ["collecting", "completed", "expired", "cancelled"],
);

export const treasureBoxAccountingStatusEnum = pgEnum(
  "treasure_box_accounting_status",
  ["claimable", "acquired", "unacquired", "zero_reward"],
);

export const treasureBoxRewardAllocationStatusEnum = pgEnum(
  "treasure_box_reward_allocation_status",
  ["demand", "acquired", "unacquired"],
);

export const coinFunderTypeEnum = pgEnum("coin_funder_type", [
  "seller",
  "platform",
]);

export const userCoinLotStatusEnum = pgEnum("user_coin_lot_status", [
  "active",
  "consumed",
  "expired",
]);

export const userCoinTransactionTypeEnum = pgEnum(
  "user_coin_transaction_type",
  [
    "acquire",
    "reserve",
    "spend",
    "reversal",
    "refund",
    "cash_refund_conversion",
    "expiry",
    "manual",
  ],
);

export const coinTransactionDirectionEnum = pgEnum(
  "coin_transaction_direction",
  ["credit", "debit"],
);

export const coinFundingTransactionTypeEnum = pgEnum(
  "coin_funding_transaction_type",
  [
    "view_funded",
    "reward_acquired_seller_funded",
    "platform_advance_created",
    "platform_advance_repaid",
    "funding_source_reclassified",
    "platform_advance_cancelled_expiry",
    "platform_advance_written_off_archive",
    "coin_consumed",
    "coin_consumption_reversed",
    "seller_surplus_returned",
    "seller_unused_returned",
    "seller_refund_after_expiry_returned",
    "manual_adjustment",
  ],
);

export const sellerCoinReturnReasonEnum = pgEnum(
  "seller_coin_return_reason",
  ["unacquired_surplus", "expired_unused", "refund_after_expiry", "manual"],
);

export const coinLedgerRunStatusEnum = pgEnum("coin_ledger_run_status", [
  "started",
  "completed",
  "failed",
]);

export const chatRoomStatusEnum = pgEnum("chat_room_status", [
  "active",
  "inactive",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "system_alert",
  "order_status",
  "promotion",
  "coins_earned",
  "chat_message", // Optional: To notify about a new chat
  "other",
]);

export const idempotencyKeyStatusEnum = pgEnum("idempotency_key_status", [
  "started",
  "completed",
  "failed",
]);

export const groupTable = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const accountGroupTable = pgTable("account_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentId: uuid("parent_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const chatRoomTable = pgTable(
  "chat_rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id),
    accountId: uuid("account_id").references(() => accountTable.id),
    productId: uuid("product_id").references(() => productTable.id),
    productVariantId: uuid("product_variant_id").references(
      () => productVariantTable.id,
    ),
    orderId: uuid("order_id").references(() => orderTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    status: chatRoomStatusEnum("status").default("active").notNull(),
  },
  (t) => ({
    chatRoomProductVariantCheck: check(
      "chat_rooms_product_variant_pair_ck",
      sql`(${t.productId} is null and ${t.productVariantId} is null) or (${t.productId} is not null and ${t.productVariantId} is not null)`,
    ),
    chatRoomUnique: uniqueIndex(
      "chat_rooms_user_account_product_variant_order_uk",
    ).on(
      t.userId,
      sql`coalesce(${t.accountId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.productVariantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.orderId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    productVariantIdx: index("chat_rooms_product_variant_id_idx").on(
      t.productVariantId,
    ),
  }),
);

export const chatMessageTable = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatRoomId: uuid("chat_room_id")
    .notNull()
    .references(() => chatRoomTable.id, { onDelete: "cascade" }),
  senderType: chatMessageSenderEnum("sender_type").notNull(),
  content: text("content"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const chatMessageAttachmentTable = pgTable("chat_message_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatMessageId: uuid("chat_message_id")
    .notNull()
    .references(() => chatMessageTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  name: text("name"),
  size: doublePrecision("size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const accountTable = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // This should store a hashed password
  name: text("name"),
  realName: text("real_name").notNull(),
  role: accountRoleEnum("role").notNull().default("seller"),
  phone: text("phone").notNull(),
  address: text("address"),
  avatar_url: text("avatar_url"),
  accountGroupId: uuid("account_group_id").references(
    () => accountGroupTable.id,
  ),
  status: accountStatusEnum("status").default("active").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Kept as an audit identifier instead of a cascading FK: deleting or
  // anonymizing the actor must not erase who performed the soft deletion.
  deletedByAccountId: uuid("deleted_by_account_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const accountWalletTable = pgTable(
  "account_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountTable.id)
      .unique(),
    walletBalance: numeric("wallet_balance", { precision: 18, scale: 2 })
      .default("0")
      .notNull(),
    totalRevenueCash: numeric("total_revenue_cash", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    totalRevenueCoin: numeric("total_revenue_coin", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    lockedBalance: numeric("locked_balance", { precision: 18, scale: 2 })
      .default("0")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check("account_wallets_balance_nonnegative", sql`${t.walletBalance} >= 0`),
    check(
      "account_wallets_revenue_cash_nonnegative",
      sql`${t.totalRevenueCash} >= 0`,
    ),
    check(
      "account_wallets_revenue_coin_nonnegative",
      sql`${t.totalRevenueCoin} >= 0`,
    ),
    check("account_wallets_locked_nonnegative", sql`${t.lockedBalance} >= 0`),
    check(
      "account_wallets_locked_not_above_balance",
      sql`${t.lockedBalance} <= ${t.walletBalance}`,
    ),
  ],
);

export const userTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    email: text("email").notNull(), // not unique to allow same email across providers if needed
    oauthProvider: oauthProviderEnum("oauth_provider").notNull(),
    oauthId: text("oauth_id").notNull(),

    coins: doublePrecision("coins").notNull().default(0),

    referralCode: text("referral_code").notNull(),
    name: text("name"),
    phone: text("phone"),
    address: text("address"),
    avatar_url: text("avatar_url"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),

    groupId: uuid("group_id").references(() => groupTable.id),
    timezone: text("timezone"),
    bankCode: text("bank_code"),
    bankAccount: text("bank_account"),
    bankAccountUpdatedAt: timestamp("bank_account_updated_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      // Composite uniqueness on (oauthProvider, oauthId)
      oauthCompositeUnique: uniqueIndex("users_oauth_provider_id_uk").on(
        table.oauthProvider,
        table.oauthId,
        table.email,
      ),
      byReferral: uniqueIndex("users_referral_code_uk").on(table.referralCode),
      byTimezone: index("users_timezone_idx").on(table.timezone),
      // Optional helpful indexes:
    };
  },
);

export const userDailyStatTable = pgTable("user_daily_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id)
    .unique(),
  totalViews: integer("total_views").default(0).notNull(),
  viewedAds: text("viewed_ads").array().default([]).notNull(),
  treasureBoxesEarned: integer("treasure_boxes_earned").default(0).notNull(),
  canWatchMore: boolean("can_watch_more").default(true).notNull(),
  remainingViews: integer("remaining_views").default(20).notNull(),
  nextTreasureBoxIn: integer("next_treasure_box_in").default(2).notNull(),
  groupAdViewsCountYesterday: integer("group_ad_views_count_yesterday").default(
    20,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const treasureBoxTable = pgTable("treasure_boxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id),
  earnedAt: timestamp("earned_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  coinsAwarded: doublePrecision("coins_awarded").notNull(),
  isOpened: boolean("is_opened").default(false).notNull(),
  isActive: boolean("is_active").default(true),
  rewardCycleId: uuid("reward_cycle_id"),
  accountingStatus: treasureBoxAccountingStatusEnum("accounting_status"),
  timezoneSnapshot: text("timezone_snapshot"),
  userLocalDate: date("user_local_date"),
  localClaimDeadlineAt: timestamp("local_claim_deadline_at", {
    withTimezone: true,
  }),
  archiveGraceDeadlineAt: timestamp("archive_grace_deadline_at", {
    withTimezone: true,
  }),
  claimDeadlineAt: timestamp("claim_deadline_at", { withTimezone: true }),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  rewardRuleVersion: text("reward_rule_version"),
  rewardInputSnapshot: jsonb("reward_input_snapshot"),
});

export const categoryTable = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("categories_name_case_insensitive_uk").on(sql`lower(${t.name})`),
  ],
);

export const productTable = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => accountTable.id, {
      onDelete: "set null",
    }),
  name: text("name").notNull(),
  avatar: text("avatar"),
  description: text("description").notNull(),
  images: text("images").array(),
  status: productStatusEnum("status").default("active").notNull(),
  type: productTypeEnum("type").default("normal").notNull(),
  allowHomeDelivery: boolean("allow_home_delivery").default(false).notNull(),
  metadata: jsonb("metadata"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByAccountId: uuid("deleted_by_account_id").references(
    () => accountTable.id,
    { onDelete: "restrict" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const productVariantTable = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id, { onDelete: "cascade" }),
    name: text("name"),
    sku: text("sku"),
    price: doublePrecision("price").notNull(),
    images: text("images").array(),
    optionValues: jsonb("option_values").notNull().default({}),
    stock: integer("stock").notNull(),
    reserve: integer("reserve").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    status: productStatusEnum("status").default("active").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    productIdIdx: index("product_variants_product_id_idx").on(t.productId),
    productStatusIdx: index("product_variants_product_status_idx").on(
      t.productId,
      t.status,
    ),
    productSkuUnique: uniqueIndex("product_variants_product_sku_uk").on(
      t.productId,
      t.sku,
    ),
    stockNonNegativeCheck: check(
      "product_variants_stock_non_negative_ck",
      sql`${t.stock} >= 0`,
    ),
    reserveNonNegativeCheck: check(
      "product_variants_reserve_non_negative_ck",
      sql`${t.reserve} >= 0`,
    ),
    reserveNotExceedStockCheck: check(
      "product_variants_reserve_not_exceed_stock_ck",
      sql`${t.reserve} <= ${t.stock}`,
    ),
  }),
);

export const advertisementTable = pgTable("advertisements", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => productTable.id),
  title: text("title").notNull(),
  description: text("description"),
  video_url: text("video_url").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archiveGraceEndsAt: timestamp("archive_grace_ends_at", {
    withTimezone: true,
  }),
  financiallyClosedAt: timestamp("financially_closed_at", {
    withTimezone: true,
  }),
  replacementOfAdvertisementId: uuid("replacement_of_advertisement_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const advertisementStatsTable = pgTable("advertisement_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  advertisementId: uuid("advertisement_id")
    .notNull()
    .references(() => advertisementTable.id, { onDelete: "cascade" })
    .unique(),
  balance: doublePrecision("balance").notNull().default(0),
  totalSpent: doublePrecision("total_spent").notNull().default(0),
  sellerReturnedCurrencyAmount: numeric("seller_returned_currency_amount", {
    precision: 18,
    scale: 2,
  })
    .default("0")
    .notNull(),
  returnedCoinAmount: numeric("returned_coin_amount", {
    precision: 18,
    scale: 2,
  })
    .default("0")
    .notNull(),
  netSettledSpentAmount: numeric("net_settled_spent_amount", {
    precision: 18,
    scale: 2,
  })
    .default("0")
    .notNull(),
  status: advertisementStatusEnum("status").default("paused").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const accountWalletTransactionTable = pgTable(
  "account_wallet_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequence: bigserial("sequence", { mode: "number" }).notNull().unique(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => accountWalletTable.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    actorAccountId: uuid("actor_account_id").references(() => accountTable.id, {
      onDelete: "restrict",
    }),
    advertisementId: uuid("advertisement_id").references(
      () => advertisementTable.id,
      { onDelete: "restrict" },
    ),
    type: accountWalletTransactionTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    balanceBefore: numeric("balance_before", { precision: 18, scale: 2 })
      .notNull(),
    balanceAfter: numeric("balance_after", { precision: 18, scale: 2 })
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    reason: text("reason"),
    externalReference: text("external_reference"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("account_wallet_transactions_wallet_sequence_idx").on(
      t.walletId,
      t.sequence,
    ),
    index("account_wallet_transactions_account_created_idx").on(
      t.accountId,
      t.createdAt,
    ),
    check("account_wallet_transactions_amount_nonzero", sql`${t.amount} <> 0`),
    check(
      "account_wallet_transactions_before_nonnegative",
      sql`${t.balanceBefore} >= 0`,
    ),
    check(
      "account_wallet_transactions_after_nonnegative",
      sql`${t.balanceAfter} >= 0`,
    ),
    check(
      "account_wallet_transactions_balance_math",
      sql`${t.balanceAfter} = ${t.balanceBefore} + ${t.amount}`,
    ),
    check(
      "account_wallet_transactions_type_sign",
      sql`(
        ${t.type} in ('legacy_opening_balance', 'admin_credit')
        and ${t.amount} > 0
      ) or (
        ${t.type} = 'advertisement_funding_debit'
        and ${t.amount} < 0
      )`,
    ),
    check(
      "account_wallet_transactions_funding_ad_required",
      sql`${t.type} <> 'advertisement_funding_debit' or ${t.advertisementId} is not null`,
    ),
    check(
      "account_wallet_transactions_admin_actor_required",
      sql`${t.type} <> 'admin_credit' or ${t.actorAccountId} is not null`,
    ),
  ],
);

export const adminActivityEventTable = pgTable(
  "admin_activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorAccountId: uuid("actor_account_id").references(
      () => accountTable.id,
      { onDelete: "restrict" },
    ),
    sellerId: uuid("seller_id").references(() => accountTable.id, {
      onDelete: "restrict",
    }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("admin_activity_events_seller_created_idx").on(
      t.sellerId,
      t.createdAt,
    ),
    index("admin_activity_events_actor_created_idx").on(
      t.actorAccountId,
      t.createdAt,
    ),
  ],
);

export const adminSidebarReadStateTable = pgTable(
  "admin_sidebar_read_states",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "cascade" }),
    // "platform" for an unfiltered platform-admin view, otherwise seller UUID.
    scopeKey: text("scope_key").notNull(),
    section: adminSidebarSectionEnum("section").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.scopeKey, t.section] }),
    index("admin_sidebar_read_states_account_idx").on(t.accountId),
  ],
);

export const advertisementTransactionTable = pgTable(
  "advertisement_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "cascade" }),
    amount: doublePrecision("amount").notNull(),
    coinAmount: numeric("coin_amount", { precision: 18, scale: 2 }),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    }),
    sourceSellerId: uuid("source_seller_id").references(() => accountTable.id, {
      onDelete: "restrict",
    }),
    adViewCountId: uuid("ad_view_count_id"),
    balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }),
    balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }),
    idempotencyKey: text("idempotency_key"),
    accountWalletTransactionId: uuid("account_wallet_transaction_id").references(
      () => accountWalletTransactionTable.id,
      { onDelete: "restrict" },
    ),
    type: transactionTypeEnum("type").default("deposit").notNull(),
    metadata: jsonb("metadata"), // For payment details, etc.
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Index for quickly finding transactions for an advertisement
    adIdIdx: index("advertisement_transactions_ad_id_idx").on(
      t.advertisementId,
    ),
    idempotencyKeyUnique: uniqueIndex(
      "advertisement_transactions_idempotency_key_uk",
    )
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    accountWalletTransactionUnique: uniqueIndex(
      "advertisement_transactions_wallet_transaction_uk",
    )
      .on(t.accountWalletTransactionId)
      .where(sql`${t.accountWalletTransactionId} is not null`),
  }),
);

export const cartItemTable = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quantity: integer("quantity").notNull().default(1),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariantTable.id),
    checked: boolean("checked").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userProductVariantUnique: uniqueIndex(
      "cart_items_user_product_variant_uk",
    ).on(t.userId, t.productVariantId),
  }),
);

export const collectionTable = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userProductUnique: uniqueIndex("collections_user_product_uk").on(
      t.userId,
      t.productId,
    ),
  }),
);

export const productsToCategoriesTable = pgTable(
  "products_to_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoryTable.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.productId, t.categoryId] }),
  }),
);

export const adViewCountTable = pgTable(
  "ad_view_counts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "set null" }),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id"),
    rewardCycleId: uuid("reward_cycle_id"),
    fundingAccountId: uuid("funding_account_id"),
    settlementCohortId: uuid("settlement_cohort_id"),
    advertisementTransactionId: uuid("advertisement_transaction_id"),
    viewChargeAmount: numeric("view_charge_amount", {
      precision: 18,
      scale: 2,
    }),
    fundedCoinAmount: numeric("funded_coin_amount", {
      precision: 18,
      scale: 2,
    }),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    }),
    completionIdempotencyKey: text("completion_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    completionIdempotencyUnique: uniqueIndex(
      "ad_view_counts_completion_idempotency_key_uk",
    )
      .on(t.completionIdempotencyKey)
      .where(sql`${t.completionIdempotencyKey} is not null`),
  }),
);

// Add these tables to your schema.ts file

export const orderTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id), // The customer who placed the order
  accountId: uuid("account_id").references(() => accountTable.id), // Optional: Reference to a seller/admin if needed for the whole order
  merchantTradeNo: text("merchant_trade_no"),
  subTotal: doublePrecision("sub_total").notNull(),
  totalAmount: doublePrecision("total_amount").notNull(), // Final calculated total
  discountCoin: doublePrecision("discount_coin").default(0),
  shippingCost: doublePrecision("shipping_cost").default(0), // New field for shipping cost
  shippingCostDeduction: doublePrecision("shipping_cost_deduction").default(0),
  transactionFee: doublePrecision("transaction_fee").default(0), // New field for tax amount
  orderStatus: orderStatusEnum("order_status").default("pending").notNull(),
  orderPayment: orderPaymentEnum("order_payment").default("Credit").notNull(),
  completeEmailSent: boolean("complete_email_sent").default(false).notNull(),

  transactionFeeRateAtSale: doublePrecision("transaction_fee_rate_at_sale"),
  userLevelAtSale: text("user_level_at_sale"),
  userMaxDiscountAtSale: integer("user_max_discount_at_sale"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  shippingInfo: jsonb("shipping_info"),
  paymentInfo: jsonb("payment_info"),
  coinInfo: jsonb("coin_info"), // To store details about coins used/earned in the order
  metadata: jsonb("metadata"), // Optional: Store additional info like payment method, shipping info, etc.
});

export const orderItemTable = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orderTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariantTable.id),
    deliveryId: uuid("delivery_id").references(() => deliveryTable.id),

    quantity: integer("quantity").notNull(),
    pendingQuantity: integer("pending_quantity").notNull().default(0),

    // --- The key fields to handle price change ---
    // 1. Store the price at the time of sale:
    unitPriceAtSale: doublePrecision("unit_price_at_sale").notNull(),

    // 2. Store other static product details for historical accuracy (optional but recommended):
    productNameAtSale: text("product_name_at_sale").notNull(),
    variantNameAtSale: text("variant_name_at_sale"),
    variantSkuAtSale: text("variant_sku_at_sale"),
    variantOptionValuesAtSale: jsonb("variant_option_values_at_sale"),

    // 3. Calculated total for the line item:
    lineTotal: doublePrecision("line_total").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    orderItemUnique: uniqueIndex("order_items_order_variant_uk").on(
      t.orderId,
      t.productVariantId,
    ),
    productVariantIdx: index("order_items_product_variant_id_idx").on(
      t.productVariantId,
    ),
  }),
);

export const refundItemTable = pgTable(
  "refund_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItemTable.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    status: refundStatusEnum("status").default("pending").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    refundAmount: doublePrecision("refund_amount"),
    paidRefundAmount: doublePrecision("paid_refund_amount"), // product refund amount after coin deduction
    extraRefundAmount: doublePrecision("extra_refund_amount")
      .default(0)
      .notNull(),
    cashRefundAmount: integer("cash_refund_amount"),
    cashRemainderCoins: doublePrecision("cash_remainder_coins")
      .default(0)
      .notNull(),
    coins: doublePrecision("coins").default(0).notNull(),
    returnableCoins: doublePrecision("returnable_coins"),
    metadata: jsonb("metadata"),
    summary: jsonb("summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    orderItemIdIdx: index("refund_items_order_item_id_idx").on(t.orderItemId),
  }),
);

export const refundLogTable = pgTable(
  "refund_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    refundItemId: uuid("refund_item_id")
      .notNull()
      .references(() => refundItemTable.id, { onDelete: "cascade" }),
    status: refundStatusEnum("status").default("pending").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    refundItemCreatedAtIdx: index(
      "refund_logs_refund_item_id_created_at_idx",
    ).on(t.refundItemId, t.createdAt),
  }),
);

export const deliveryTable = pgTable("deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orderTable.id),
  merchantTradeNo: text("merchant_trade_no"),
  status: deliveryStatusEnum("status").default("pending").notNull(),
  AllPayLogisticsID: text("all_pay_logistics_id"),
  CVSPaymentNo: text("cvs_payment_no"),
  CVSValidationNo: text("cvs_validation_no"),
  LogisticsType: deliveryLogisticsTypeEnum("logistics_type").notNull(),
  LogisticsSubType: text("logistics_sub_type"),
  RtnCode: text("rtn_code"),
  RtnMsg: text("rtn_msg"),
  GoodsAmount: doublePrecision("goods_amount").notNull(),
  metadata: jsonb("metadata"),
  cvsStoreInfo: jsonb("cvs_store_info"),
  homeDeliveryData: jsonb("home_delivery_data"),
  fee: doublePrecision("fee").default(0),
  feeDeduction: doublePrecision("fee_deduction").default(0),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const deliveryLogTable = pgTable("delivery_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  deliveryId: uuid("delivery_id")
    .notNull()
    .references(() => deliveryTable.id, { onDelete: "cascade" }),
  status: deliveryStatusEnum("status").default("pending").notNull(),
  RtnCode: text("rtn_code"),
  RtnMsg: text("rtn_msg"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const merchantTradeTable = pgTable(
  "merchant_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orderTable.id, { onDelete: "cascade" }),
    merchantTradeNo: text("merchant_trade_no").notNull(),
    productIds: uuid("product_ids").array().notNull(),
    variantIds: uuid("variant_ids").array().default([]).notNull(),
    cvsStoreInfo: jsonb("cvs_store_info"),
    shippingCost: doublePrecision("shipping_cost").default(0),
    shippingCostDeduction: doublePrecision("shipping_cost_deduction").default(0),
  },
  (t) => ({
    productVariantLengthCheck: check(
      "merchant_trades_product_variant_length_ck",
      sql`cardinality(${t.productIds}) = cardinality(${t.variantIds})`,
    ),
  }),
);

export const shippingFeeTable = pgTable(
  "shipping_fees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "cascade" }),
    homeDelivery: doublePrecision("home_delivery").default(60),
    homeDeliveryRefrig: doublePrecision("home_delivery_refrigeration").default(
      160,
    ),
    OKMART_LOW_TMP_C2C: doublePrecision("okmart_low_temperature_c2c").default(
      160,
    ),
    FAMIC2C: doublePrecision("fami_c2c").default(69),
    UNIMARTC2C: doublePrecision("unimart_c2c").default(69),
    HILIFEC2C: doublePrecision("hilife_c2c").default(58),
    OKMARTC2C: doublePrecision("okmart_c2c").default(58),
  },
  (t) => ({
    accountIdUnique: uniqueIndex("shipping_fees_account_id_uk").on(t.accountId),
  }),
);

export const deviceTokenTable = pgTable(
  "device_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fcmToken: text("fcm_token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userDeviceUnique: uniqueIndex("device_tokens_user_device_uk").on(
      t.userId,
      t.deviceId,
    ),
    lastUsedAtIdx: index("device_tokens_last_used_at_idx").on(t.lastUsedAt),
  }),
);

export const userMonthlyCoinStatTable = pgTable(
  "user_monthly_coin_stats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),

    // Stores the month in 'YYYY-MM' format
    month: text("month").notNull(),

    coinsEarned: doublePrecision("coins_earned").notNull().default(0),
    coinsSpent: doublePrecision("coins_spent").notNull().default(0),
    expired: boolean("expired").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    // Composite primary key ensures one entry per user per month
    pk: primaryKey({ columns: [t.userId, t.month] }),
  }),
);

export const userNotificationTable = pgTable(
  "user_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull().default("system_alert"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    orderId: uuid("order_id").references(() => orderTable.id, {
      onDelete: "set null",
    }),
    // A generic metadata field for other links (e.g., product, URL)
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    // Index for quickly finding all unread notifications for a user
    userReadIdx: index("user_notifications_user_read_idx").on(
      t.userId,
      t.isRead,
    ),
  }),
);

export const idempotencyKeyTable = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull().unique(),
    requestPath: text("request_path").notNull(),
    requestData: jsonb("request_data").notNull(),
    responseData: jsonb("response_data"),
    status: idempotencyKeyStatusEnum("status").default("started").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    updatedAtIdx: index("idempotency_keys_updated_at_idx").on(t.updatedAt),
  }),
);

export const advertisementCoinFundingAccountTable = pgTable(
  "advertisement_coin_funding_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "restrict" }),
    sourceSellerId: uuid("source_seller_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    })
      .default("10")
      .notNull(),
    sellerFundingAvailableAmount: numeric("seller_funding_available_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    platformAdvanceOutstandingAmount: numeric(
      "platform_advance_outstanding_amount",
      { precision: 18, scale: 2 },
    )
      .default("0")
      .notNull(),
    platformFundedConsumedAmount: numeric("platform_funded_consumed_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    platformPromotionalExpenseAmount: numeric(
      "platform_promotional_expense_amount",
      { precision: 18, scale: 2 },
    )
      .default("0")
      .notNull(),
    status: coinFundingAccountStatusEnum("status").default("active").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    advertisementUnique: uniqueIndex(
      "advertisement_coin_funding_accounts_advertisement_id_uk",
    ).on(t.advertisementId),
    outstandingAdvanceIdx: index(
      "advertisement_coin_funding_accounts_outstanding_advance_idx",
    ).on(t.status, t.platformAdvanceOutstandingAmount),
    amountsNonNegativeCheck: check(
      "advertisement_coin_funding_accounts_amounts_non_negative_ck",
      sql`${t.platformAdvanceOutstandingAmount} >= 0 and
          ${t.sellerFundingAvailableAmount} >= 0 and
          ${t.platformFundedConsumedAmount} >= 0 and
          ${t.platformPromotionalExpenseAmount} >= 0 and
          ${t.coinToCurrencyRate} > 0`,
    ),
  }),
);

export const advertisementCoinSettlementCohortTable = pgTable(
  "advertisement_coin_settlement_cohorts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fundingAccountId: uuid("funding_account_id")
      .notNull()
      .references(() => advertisementCoinFundingAccountTable.id, {
        onDelete: "restrict",
      }),
    businessDate: date("business_date").notNull(),
    claimSettlementAt: timestamp("claim_settlement_at", {
      withTimezone: true,
    }),
    openingPlatformAdvanceAmount: numeric("opening_platform_advance_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    sellerFundedAmount: numeric("seller_funded_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    acquiredRewardAmount: numeric("acquired_reward_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    advanceCreatedAmount: numeric("advance_created_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    advanceRepaidAmount: numeric("advance_repaid_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    advanceCancelledAtExpiryAmount: numeric(
      "advance_cancelled_at_expiry_amount",
      { precision: 18, scale: 2 },
    )
      .default("0")
      .notNull(),
    sellerSurplusReturnedAmount: numeric("seller_surplus_returned_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    closingPlatformAdvanceAmount: numeric("closing_platform_advance_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    status: coinSettlementCohortStatusEnum("status")
      .default("open")
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    accountBusinessDateUnique: uniqueIndex(
      "advertisement_coin_settlement_cohorts_account_date_uk",
    ).on(t.fundingAccountId, t.businessDate),
    settlementIdx: index(
      "advertisement_coin_settlement_cohorts_status_claim_at_idx",
    ).on(t.status, t.claimSettlementAt),
    amountsNonNegativeCheck: check(
      "advertisement_coin_settlement_cohorts_amounts_non_negative_ck",
      sql`${t.openingPlatformAdvanceAmount} >= 0 and
          ${t.sellerFundedAmount} >= 0 and
          ${t.acquiredRewardAmount} >= 0 and
          ${t.advanceCreatedAmount} >= 0 and
          ${t.advanceRepaidAmount} >= 0 and
          ${t.advanceCancelledAtExpiryAmount} >= 0 and
          ${t.sellerSurplusReturnedAmount} >= 0 and
          ${t.closingPlatformAdvanceAmount} >= 0`,
    ),
  }),
);

export const advertisementAssignmentTable = pgTable(
  "advertisement_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "restrict" }),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "restrict" }),
    sourceSellerId: uuid("source_seller_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    assignmentBatchId: uuid("assignment_batch_id").notNull(),
    userLocalDate: date("user_local_date").notNull(),
    timezoneSnapshot: text("timezone_snapshot").notNull(),
    assignmentTokenHash: text("assignment_token_hash"),
    status: advertisementAssignmentStatusEnum("status")
      .default("issued")
      .notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionIdempotencyKey: text("completion_idempotency_key"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    batchUserAdvertisementUnique: uniqueIndex(
      "advertisement_assignments_batch_user_advertisement_uk",
    ).on(t.assignmentBatchId, t.userId, t.advertisementId),
    userAdvertisementLocalDateUnique: uniqueIndex(
      "advertisement_assignments_user_advertisement_local_date_uk",
    ).on(t.userId, t.advertisementId, t.userLocalDate),
    completionIdempotencyUnique: uniqueIndex(
      "advertisement_assignments_completion_idempotency_uk",
    )
      .on(t.completionIdempotencyKey)
      .where(sql`${t.completionIdempotencyKey} is not null`),
    userAdvertisementStatusIdx: index(
      "advertisement_assignments_user_advertisement_status_idx",
    ).on(t.userId, t.advertisementId, t.status, t.assignedAt),
    statusLocalDateIdx: index(
      "advertisement_assignments_status_local_date_idx",
    ).on(t.status, t.userLocalDate),
    statusCompletedAtIdx: index(
      "advertisement_assignments_status_completed_at_idx",
    ).on(t.status, t.completedAt),
    statusUpdatedAtIdx: index(
      "advertisement_assignments_status_updated_at_idx",
    ).on(t.status, t.updatedAt),
  }),
);

export const treasureBoxRewardCycleTable = pgTable(
  "treasure_box_reward_cycles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "restrict" }),
    status: treasureBoxRewardCycleStatusEnum("status")
      .default("collecting")
      .notNull(),
    requiredViewCount: integer("required_view_count").default(2).notNull(),
    completedViewCount: integer("completed_view_count").default(0).notNull(),
    accountingBusinessDate: date("accounting_business_date").notNull(),
    userLocalDate: date("user_local_date").notNull(),
    timezoneSnapshot: text("timezone_snapshot").notNull(),
    claimDeadlineAt: timestamp("claim_deadline_at", { withTimezone: true }),
    treasureBoxId: uuid("treasure_box_id").references(
      () => treasureBoxTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userStatusLocalDateIdx: index(
      "treasure_box_reward_cycles_user_status_local_date_idx",
    ).on(t.userId, t.status, t.userLocalDate),
    viewCountsCheck: check(
      "treasure_box_reward_cycles_view_counts_ck",
      sql`${t.requiredViewCount} > 0 and
          ${t.completedViewCount} >= 0 and
          ${t.completedViewCount} <= ${t.requiredViewCount}`,
    ),
  }),
);

export const treasureBoxRewardAllocationTable = pgTable(
  "treasure_box_reward_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    treasureBoxId: uuid("treasure_box_id")
      .notNull()
      .references(() => treasureBoxTable.id, { onDelete: "restrict" }),
    fundingAccountId: uuid("funding_account_id").references(
      () => advertisementCoinFundingAccountTable.id,
      { onDelete: "restrict" },
    ),
    settlementCohortId: uuid("settlement_cohort_id").references(
      () => advertisementCoinSettlementCohortTable.id,
      { onDelete: "restrict" },
    ),
    advertisementId: uuid("advertisement_id").references(
      () => advertisementTable.id,
      { onDelete: "restrict" },
    ),
    sourceSellerId: uuid("source_seller_id").references(
      () => accountTable.id,
      { onDelete: "restrict" },
    ),
    legacySource: text("legacy_source"),
    attributedCoinAmount: numeric("attributed_coin_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    acquiredCoinAmount: numeric("acquired_coin_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    sellerFundedCoinAmount: numeric("seller_funded_coin_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    platformAdvancedCoinAmount: numeric("platform_advanced_coin_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    platformRepaidCoinAmount: numeric("platform_repaid_coin_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    status: treasureBoxRewardAllocationStatusEnum("status")
      .default("demand")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    boxAdvertisementUnique: uniqueIndex(
      "treasure_box_reward_allocations_box_advertisement_uk",
    ).on(t.treasureBoxId, t.advertisementId),
    accountStatusIdx: index(
      "treasure_box_reward_allocations_account_status_idx",
    ).on(t.fundingAccountId, t.status),
    amountsNonNegativeCheck: check(
      "treasure_box_reward_allocations_amounts_non_negative_ck",
      sql`${t.attributedCoinAmount} >= 0 and
          ${t.acquiredCoinAmount} >= 0 and
          ${t.sellerFundedCoinAmount} >= 0 and
          ${t.platformAdvancedCoinAmount} >= 0 and
          ${t.platformRepaidCoinAmount} >= 0`,
    ),
  }),
);

export const userCoinLotTable = pgTable(
  "user_coin_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "restrict" }),
    rewardAllocationId: uuid("reward_allocation_id").references(
      () => treasureBoxRewardAllocationTable.id,
      { onDelete: "restrict" },
    ),
    fundingAccountId: uuid("funding_account_id").references(
      () => advertisementCoinFundingAccountTable.id,
      { onDelete: "restrict" },
    ),
    advertisementId: uuid("advertisement_id").references(
      () => advertisementTable.id,
      { onDelete: "restrict" },
    ),
    sourceSellerId: uuid("source_seller_id").references(
      () => accountTable.id,
      { onDelete: "restrict" },
    ),
    sourceRefundId: uuid("source_refund_id").references(
      () => refundItemTable.id,
      { onDelete: "restrict" },
    ),
    legacySource: text("legacy_source"),
    currentFunderType: coinFunderTypeEnum("current_funder_type").notNull(),
    originalAmount: numeric("original_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    availableAmount: numeric("available_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    reservedAmount: numeric("reserved_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    consumedAmount: numeric("consumed_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    expiredAmount: numeric("expired_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    returnedAmount: numeric("returned_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    timezoneSnapshot: text("timezone_snapshot").notNull(),
    earningLocalMonth: text("earning_local_month").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: userCoinLotStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userSpendOrderIdx: index("user_coin_lots_user_spend_order_idx").on(
      t.userId,
      t.status,
      t.expiresAt,
      t.createdAt,
    ),
    sourceAdvertisementIdx: index(
      "user_coin_lots_source_advertisement_idx",
    ).on(t.advertisementId, t.currentFunderType),
    sourceRefundUnique: uniqueIndex("user_coin_lots_source_refund_id_uk")
      .on(t.sourceRefundId)
      .where(sql`${t.sourceRefundId} is not null`),
    amountsNonNegativeCheck: check(
      "user_coin_lots_amounts_non_negative_ck",
      sql`${t.originalAmount} >= 0 and
          ${t.availableAmount} >= 0 and
          ${t.reservedAmount} >= 0 and
          ${t.consumedAmount} >= 0 and
          ${t.expiredAmount} >= 0 and
          ${t.returnedAmount} >= 0`,
    ),
    amountControlCheck: check(
      "user_coin_lots_amount_control_ck",
      sql`${t.originalAmount} = ${t.availableAmount} + ${t.reservedAmount} +
          ${t.consumedAmount} + ${t.expiredAmount} + ${t.returnedAmount}`,
    ),
  }),
);

export const orderCoinAllocationTable = pgTable(
  "order_coin_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orderTable.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => userCoinLotTable.id, { onDelete: "restrict" }),
    allocatedAmount: numeric("allocated_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    reservedAmount: numeric("reserved_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    consumedAmount: numeric("consumed_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    reversedAmount: numeric("reversed_amount", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    orderLotUnique: uniqueIndex("order_coin_allocations_order_lot_uk").on(
      t.orderId,
      t.lotId,
    ),
    lotIdx: index("order_coin_allocations_lot_idx").on(t.lotId),
    amountsCheck: check(
      "order_coin_allocations_amounts_ck",
      sql`${t.allocatedAmount} >= 0 and
          ${t.reservedAmount} >= 0 and
          ${t.consumedAmount} >= 0 and
          ${t.reversedAmount} >= 0 and
          ${t.reservedAmount} + ${t.consumedAmount} <= ${t.allocatedAmount} and
          ${t.reversedAmount} <= ${t.consumedAmount}`,
    ),
  }),
);

export const userCoinTransactionTable = pgTable(
  "user_coin_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id").references(() => userCoinLotTable.id, {
      onDelete: "restrict",
    }),
    type: userCoinTransactionTypeEnum("type").notNull(),
    direction: coinTransactionDirectionEnum("direction").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    orderId: uuid("order_id").references(() => orderTable.id, {
      onDelete: "restrict",
    }),
    refundId: uuid("refund_id").references(() => refundItemTable.id, {
      onDelete: "restrict",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex(
      "user_coin_transactions_idempotency_key_uk",
    ).on(t.idempotencyKey),
    userCreatedAtIdx: index("user_coin_transactions_user_created_at_idx").on(
      t.userId,
      t.createdAt,
    ),
    amountPositiveCheck: check(
      "user_coin_transactions_amount_positive_ck",
      sql`${t.amount} > 0`,
    ),
  }),
);

export const productSellerCoinReturnTransactionTable = pgTable(
  "product_seller_coin_return_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSellerId: uuid("source_seller_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    sourceRefundId: uuid("source_refund_id")
      .notNull()
      .references(() => refundItemTable.id, { onDelete: "restrict" }),
    userCoinLotId: uuid("user_coin_lot_id")
      .notNull()
      .references(() => userCoinLotTable.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    coinAmount: numeric("coin_amount", { precision: 18, scale: 2 }).notNull(),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    })
      .default("10")
      .notNull(),
    currencyEquivalent: numeric("currency_equivalent", {
      precision: 18,
      scale: 2,
    }).notNull(),
    destinationType: text("destination_type")
      .default("product_seller_refund_credit")
      .notNull(),
    destinationReferenceId: uuid("destination_reference_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex(
      "product_seller_coin_returns_idempotency_key_uk",
    ).on(t.idempotencyKey),
    sellerCreatedAtIdx: index(
      "product_seller_coin_returns_seller_created_at_idx",
    ).on(t.sourceSellerId, t.createdAt),
    refundIdx: index("product_seller_coin_returns_refund_id_idx").on(
      t.sourceRefundId,
    ),
    amountsPositiveCheck: check(
      "product_seller_coin_returns_amounts_positive_ck",
      sql`${t.coinAmount} > 0 and
          ${t.coinToCurrencyRate} > 0 and
          ${t.currencyEquivalent} > 0`,
    ),
  }),
);

export const sellerCoinReturnTransactionTable = pgTable(
  "seller_coin_return_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSellerId: uuid("source_seller_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "restrict" }),
    fundingAccountId: uuid("funding_account_id")
      .notNull()
      .references(() => advertisementCoinFundingAccountTable.id, {
        onDelete: "restrict",
      }),
    settlementCohortId: uuid("settlement_cohort_id").references(
      () => advertisementCoinSettlementCohortTable.id,
      { onDelete: "restrict" },
    ),
    rewardAllocationId: uuid("reward_allocation_id").references(
      () => treasureBoxRewardAllocationTable.id,
      { onDelete: "restrict" },
    ),
    userCoinLotId: uuid("user_coin_lot_id").references(
      () => userCoinLotTable.id,
      { onDelete: "restrict" },
    ),
    reason: sellerCoinReturnReasonEnum("reason").notNull(),
    coinAmount: numeric("coin_amount", { precision: 18, scale: 2 }).notNull(),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    }).notNull(),
    currencyEquivalent: numeric("currency_equivalent", {
      precision: 18,
      scale: 2,
    }).notNull(),
    destinationType: text("destination_type")
      .default("advertisement_balance")
      .notNull(),
    destinationReferenceId: uuid("destination_reference_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex(
      "seller_coin_return_transactions_idempotency_key_uk",
    ).on(t.idempotencyKey),
    sellerCreatedAtIdx: index(
      "seller_coin_return_transactions_seller_created_at_idx",
    ).on(t.sourceSellerId, t.createdAt),
    amountsPositiveCheck: check(
      "seller_coin_return_transactions_amounts_positive_ck",
      sql`${t.coinAmount} > 0 and
          ${t.coinToCurrencyRate} > 0 and
          ${t.currencyEquivalent} >= 0`,
    ),
  }),
);

export const advertisementBalanceTransferTable = pgTable(
  "advertisement_balance_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceAdvertisementId: uuid("source_advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "restrict" }),
    destinationAdvertisementId: uuid("destination_advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "restrict" }),
    sourceSellerId: uuid("source_seller_id")
      .notNull()
      .references(() => accountTable.id, { onDelete: "restrict" }),
    coinAmount: numeric("coin_amount", { precision: 18, scale: 2 }).notNull(),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    }).notNull(),
    currencyAmount: numeric("currency_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    sourceBalanceBefore: numeric("source_balance_before", {
      precision: 18,
      scale: 2,
    }).notNull(),
    sourceBalanceAfter: numeric("source_balance_after", {
      precision: 18,
      scale: 2,
    }).notNull(),
    destinationBalanceBefore: numeric("destination_balance_before", {
      precision: 18,
      scale: 2,
    }).notNull(),
    destinationBalanceAfter: numeric("destination_balance_after", {
      precision: 18,
      scale: 2,
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex(
      "advertisement_balance_transfers_idempotency_key_uk",
    ).on(t.idempotencyKey),
    sourceCreatedAtIdx: index(
      "advertisement_balance_transfers_source_created_at_idx",
    ).on(t.sourceAdvertisementId, t.createdAt),
    differentAdsCheck: check(
      "advertisement_balance_transfers_different_ads_ck",
      sql`${t.sourceAdvertisementId} <> ${t.destinationAdvertisementId}`,
    ),
    amountsPositiveCheck: check(
      "advertisement_balance_transfers_amounts_positive_ck",
      sql`${t.coinAmount} > 0 and
          ${t.coinToCurrencyRate} > 0 and
          ${t.currencyAmount} > 0`,
    ),
  }),
);

export const advertisementCoinFundingTransactionTable = pgTable(
  "advertisement_coin_funding_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fundingAccountId: uuid("funding_account_id")
      .notNull()
      .references(() => advertisementCoinFundingAccountTable.id, {
        onDelete: "restrict",
      }),
    settlementCohortId: uuid("settlement_cohort_id").references(
      () => advertisementCoinSettlementCohortTable.id,
      { onDelete: "restrict" },
    ),
    type: coinFundingTransactionTypeEnum("type").notNull(),
    coinAmount: numeric("coin_amount", { precision: 18, scale: 2 }).notNull(),
    currencyEquivalent: numeric("currency_equivalent", {
      precision: 18,
      scale: 2,
    }),
    coinToCurrencyRate: numeric("coin_to_currency_rate", {
      precision: 18,
      scale: 6,
    }).notNull(),
    adViewCountId: uuid("ad_view_count_id").references(
      () => adViewCountTable.id,
      { onDelete: "restrict" },
    ),
    treasureBoxRewardAllocationId: uuid(
      "treasure_box_reward_allocation_id",
    ).references(() => treasureBoxRewardAllocationTable.id, {
      onDelete: "restrict",
    }),
    userCoinLotId: uuid("user_coin_lot_id").references(
      () => userCoinLotTable.id,
      { onDelete: "restrict" },
    ),
    sellerReturnTransactionId: uuid("seller_return_transaction_id").references(
      () => sellerCoinReturnTransactionTable.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex(
      "advertisement_coin_funding_transactions_idempotency_key_uk",
    ).on(t.idempotencyKey),
    accountCreatedAtIdx: index(
      "advertisement_coin_funding_transactions_account_created_at_idx",
    ).on(t.fundingAccountId, t.createdAt),
    amountPositiveCheck: check(
      "advertisement_coin_funding_transactions_amount_positive_ck",
      sql`${t.coinAmount} > 0 and ${t.coinToCurrencyRate} > 0`,
    ),
  }),
);

export const coinLedgerJobRunTable = pgTable(
  "coin_ledger_job_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobName: text("job_name").notNull(),
    scopeKey: text("scope_key").notNull(),
    status: coinLedgerRunStatusEnum("status").default("started").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    jobScopeUnique: uniqueIndex("coin_ledger_job_runs_job_scope_uk").on(
      t.jobName,
      t.scopeKey,
    ),
    statusScheduledIdx: index(
      "coin_ledger_job_runs_status_scheduled_for_idx",
    ).on(t.status, t.scheduledFor),
    scheduledForIdx: index("coin_ledger_job_runs_scheduled_for_idx").on(
      t.scheduledFor,
    ),
  }),
);

export const coinLedgerBackfillCheckpointTable = pgTable(
  "coin_ledger_backfill_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    checkpoint: text("checkpoint"),
    status: coinLedgerRunStatusEnum("status").default("started").notNull(),
    metadata: jsonb("metadata"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex("coin_ledger_backfill_checkpoints_name_uk").on(
      t.name,
    ),
  }),
);

// Relations
export const accountRelations = relations(accountTable, ({ one, many }) => ({
  products: many(productTable),
  chatRooms: many(chatRoomTable),
  group: one(accountGroupTable, {
    fields: [accountTable.accountGroupId],
    references: [accountGroupTable.id],
  }),
  wallet: one(accountWalletTable, {
    fields: [accountTable.id],
    references: [accountWalletTable.accountId],
  }),
  walletTransactions: many(accountWalletTransactionTable, {
    relationName: "walletTransactionAccount",
  }),
  actedWalletTransactions: many(accountWalletTransactionTable, {
    relationName: "walletTransactionActor",
  }),
  shippingFee: one(shippingFeeTable, {
    fields: [accountTable.id],
    references: [shippingFeeTable.accountId],
  }),
}));

export const usersRelations = relations(userTable, ({ one, many }) => ({
  group: one(groupTable, {
    fields: [userTable.groupId],
    references: [groupTable.id],
  }),
  dailyStat: one(userDailyStatTable, {
    fields: [userTable.id],
    references: [userDailyStatTable.userId],
  }),
  treasureBoxes: many(treasureBoxTable),
  cartItems: many(cartItemTable),
  chatRooms: many(chatRoomTable),
  collections: many(collectionTable),
  adViews: many(adViewCountTable),
  orders: many(orderTable),
  deviceTokens: many(deviceTokenTable),
  monthlyCoinStats: many(userMonthlyCoinStatTable),
  notifications: many(userNotificationTable),
}));

export const groupsRelations = relations(groupTable, ({ one, many }) => ({
  owner: one(userTable, {
    fields: [groupTable.ownerId],
    references: [userTable.id],
  }),
  users: many(userTable),
}));

export const accountGroupRelations = relations(
  accountGroupTable,
  ({ one, many }) => ({
    parent: one(accountTable, {
      fields: [accountGroupTable.parentId],
      references: [accountTable.id],
    }),
    accounts: many(accountTable),
  }),
);

export const accountWalletRelations = relations(
  accountWalletTable,
  ({ one, many }) => ({
    account: one(accountTable, {
      fields: [accountWalletTable.accountId],
      references: [accountTable.id],
    }),
    transactions: many(accountWalletTransactionTable),
  }),
);

export const accountWalletTransactionRelations = relations(
  accountWalletTransactionTable,
  ({ one }) => ({
    wallet: one(accountWalletTable, {
      fields: [accountWalletTransactionTable.walletId],
      references: [accountWalletTable.id],
    }),
    account: one(accountTable, {
      fields: [accountWalletTransactionTable.accountId],
      references: [accountTable.id],
      relationName: "walletTransactionAccount",
    }),
    actor: one(accountTable, {
      fields: [accountWalletTransactionTable.actorAccountId],
      references: [accountTable.id],
      relationName: "walletTransactionActor",
    }),
    advertisement: one(advertisementTable, {
      fields: [accountWalletTransactionTable.advertisementId],
      references: [advertisementTable.id],
    }),
  }),
);

export const shippingFeeRelations = relations(shippingFeeTable, ({ one }) => ({
  account: one(accountTable, {
    fields: [shippingFeeTable.accountId],
    references: [accountTable.id],
  }),
}));

export const userDailyStatRelations = relations(
  userDailyStatTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userDailyStatTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const treasureBoxRelations = relations(treasureBoxTable, ({ one }) => ({
  user: one(userTable, {
    fields: [treasureBoxTable.userId],
    references: [userTable.id],
  }),
}));

export const cartItemRelations = relations(cartItemTable, ({ one }) => ({
  user: one(userTable, {
    fields: [cartItemTable.userId],
    references: [userTable.id],
  }),
  product: one(productTable, {
    fields: [cartItemTable.productId],
    references: [productTable.id],
  }),
  variant: one(productVariantTable, {
    fields: [cartItemTable.productVariantId],
    references: [productVariantTable.id],
  }),
}));

export const chatRoomRelations = relations(chatRoomTable, ({ one, many }) => ({
  user: one(userTable, {
    fields: [chatRoomTable.userId],
    references: [userTable.id],
  }),
  account: one(accountTable, {
    fields: [chatRoomTable.accountId],
    references: [accountTable.id],
  }),
  product: one(productTable, {
    fields: [chatRoomTable.productId],
    references: [productTable.id],
  }),
  variant: one(productVariantTable, {
    fields: [chatRoomTable.productVariantId],
    references: [productVariantTable.id],
  }),
  order: one(orderTable, {
    fields: [chatRoomTable.orderId],
    references: [orderTable.id],
  }),
  messages: many(chatMessageTable),
}));

export const chatMessageRelations = relations(
  chatMessageTable,
  ({ one, many }) => ({
    chatRoom: one(chatRoomTable, {
      fields: [chatMessageTable.chatRoomId],
      references: [chatRoomTable.id],
    }),
    attachments: many(chatMessageAttachmentTable),
  }),
);

export const chatMessageAttachmentRelations = relations(
  chatMessageAttachmentTable,
  ({ one }) => ({
    message: one(chatMessageTable, {
      fields: [chatMessageAttachmentTable.chatMessageId],
      references: [chatMessageTable.id],
    }),
  }),
);

export const productRelations = relations(productTable, ({ one, many }) => ({
  seller: one(accountTable, {
    fields: [productTable.sellerId],
    references: [accountTable.id],
  }),
  advertisement: one(advertisementTable, {
    fields: [productTable.id],
    references: [advertisementTable.productId],
  }),
  productsToCategories: many(productsToCategoriesTable),
  cartItems: many(cartItemTable),
  chatRooms: many(chatRoomTable),
  collections: many(collectionTable),
  orderItems: many(orderItemTable),
  variants: many(productVariantTable),
}));

export const productVariantRelations = relations(
  productVariantTable,
  ({ one, many }) => ({
    product: one(productTable, {
      fields: [productVariantTable.productId],
      references: [productTable.id],
    }),
    cartItems: many(cartItemTable),
    orderItems: many(orderItemTable),
  }),
);

export const advertisementRelations = relations(
  advertisementTable,
  ({ one, many }) => ({
    product: one(productTable, {
      fields: [advertisementTable.productId],
      references: [productTable.id],
    }),
    views: many(adViewCountTable),
    stats: one(advertisementStatsTable),
    transactions: many(advertisementTransactionTable),
    walletTransactions: many(accountWalletTransactionTable),
  }),
);

export const categoryRelations = relations(categoryTable, ({ many }) => ({
  productsToCategories: many(productsToCategoriesTable),
}));

export const productsToCategoriesRelations = relations(
  productsToCategoriesTable,
  ({ one }) => ({
    product: one(productTable, {
      fields: [productsToCategoriesTable.productId],
      references: [productTable.id],
    }),
    category: one(categoryTable, {
      fields: [productsToCategoriesTable.categoryId],
      references: [categoryTable.id],
    }),
  }),
);

export const adViewCountRelations = relations(adViewCountTable, ({ one }) => ({
  user: one(userTable, {
    fields: [adViewCountTable.userId],
    references: [userTable.id],
  }),
  advertisement: one(advertisementTable, {
    fields: [adViewCountTable.advertisementId],
    references: [advertisementTable.id],
  }),
}));

export const advertisementStatsRelations = relations(
  advertisementStatsTable,
  ({ one }) => ({
    advertisement: one(advertisementTable, {
      fields: [advertisementStatsTable.advertisementId],
      references: [advertisementTable.id],
    }),
  }),
);

export const advertisementTransactionRelations = relations(
  advertisementTransactionTable,
  ({ one }) => ({
    advertisement: one(advertisementTable, {
      fields: [advertisementTransactionTable.advertisementId],
      references: [advertisementTable.id],
    }),
    walletTransaction: one(accountWalletTransactionTable, {
      fields: [advertisementTransactionTable.accountWalletTransactionId],
      references: [accountWalletTransactionTable.id],
    }),
  }),
);

export const collectionRelations = relations(collectionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [collectionTable.userId],
    references: [userTable.id],
  }),
  product: one(productTable, {
    fields: [collectionTable.productId],
    references: [productTable.id],
  }),
}));

export const orderRelations = relations(orderTable, ({ one, many }) => ({
  user: one(userTable, {
    fields: [orderTable.userId],
    references: [userTable.id],
  }),
  account: one(accountTable, {
    fields: [orderTable.accountId],
    references: [accountTable.id],
  }),
  chatRooms: many(chatRoomTable),
  items: many(orderItemTable), // An order can have many items
  deliveries: many(deliveryTable), // An order can have deliveries
  merchantTrades: many(merchantTradeTable),
}));

export const merchantTradeRelations = relations(
  merchantTradeTable,
  ({ one }) => ({
    order: one(orderTable, {
      fields: [merchantTradeTable.orderId],
      references: [orderTable.id],
    }),
  }),
);

export const orderItemRelations = relations(
  orderItemTable,
  ({ one, many }) => ({
    order: one(orderTable, {
      fields: [orderItemTable.orderId],
      references: [orderTable.id],
    }),
    delivery: one(deliveryTable, {
      fields: [orderItemTable.deliveryId],
      references: [deliveryTable.id],
    }),
    product: one(productTable, {
      fields: [orderItemTable.productId],
      references: [productTable.id],
    }),
    variant: one(productVariantTable, {
      fields: [orderItemTable.productVariantId],
      references: [productVariantTable.id],
    }),
    refundItems: many(refundItemTable),
  }),
);

export const refundItemRelations = relations(
  refundItemTable,
  ({ one, many }) => ({
    orderItem: one(orderItemTable, {
      fields: [refundItemTable.orderItemId],
      references: [orderItemTable.id],
    }),
    logs: many(refundLogTable),
  }),
);

export const refundLogRelations = relations(refundLogTable, ({ one }) => ({
  refundItem: one(refundItemTable, {
    fields: [refundLogTable.refundItemId],
    references: [refundItemTable.id],
  }),
}));

export const deliveryRelations = relations(deliveryTable, ({ one, many }) => ({
  order: one(orderTable, {
    fields: [deliveryTable.orderId],
    references: [orderTable.id],
  }),
  items: many(orderItemTable), // A delivery can have many items
  logs: many(deliveryLogTable),
}));

export const deliveryLogRelations = relations(deliveryLogTable, ({ one }) => ({
  delivery: one(deliveryTable, {
    fields: [deliveryLogTable.deliveryId],
    references: [deliveryTable.id],
  }),
}));

export const deviceTokenRelations = relations(deviceTokenTable, ({ one }) => ({
  user: one(userTable, {
    fields: [deviceTokenTable.userId],
    references: [userTable.id],
  }),
}));

export const userMonthlyCoinStatRelations = relations(
  userMonthlyCoinStatTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userMonthlyCoinStatTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const userNotificationRelations = relations(
  userNotificationTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userNotificationTable.userId],
      references: [userTable.id],
    }),
    order: one(orderTable, {
      fields: [userNotificationTable.orderId],
      references: [orderTable.id],
    }),
  }),
);

// Convenient TS types
export type User = typeof userTable.$inferSelect;
export type NewUser = typeof userTable.$inferInsert;

export type Group = typeof groupTable.$inferSelect;
export type NewGroup = typeof groupTable.$inferInsert;

export type AccountGroup = typeof accountGroupTable.$inferSelect;
export type NewAccountGroup = typeof accountGroupTable.$inferInsert;

export type UserDailyStat = typeof userDailyStatTable.$inferSelect;
export type NewUserDailyStat = typeof userDailyStatTable.$inferInsert;

export type TreasureBox = typeof treasureBoxTable.$inferSelect;
export type NewTreasureBox = typeof treasureBoxTable.$inferInsert;

export type Category = typeof categoryTable.$inferSelect;
export type NewCategory = typeof categoryTable.$inferInsert;

export type Product = typeof productTable.$inferSelect;
export type NewProduct = typeof productTable.$inferInsert;

export type ProductVariant = typeof productVariantTable.$inferSelect;
export type NewProductVariant = typeof productVariantTable.$inferInsert;

export type Advertisement = typeof advertisementTable.$inferSelect;
export type NewAdvertisement = typeof advertisementTable.$inferInsert;

export type AdvertisementStats = typeof advertisementStatsTable.$inferSelect;
export type NewAdvertisementStats = typeof advertisementStatsTable.$inferInsert;

export type AdvertisementTransaction =
  typeof advertisementTransactionTable.$inferSelect;
export type NewAdvertisementTransaction =
  typeof advertisementTransactionTable.$inferInsert;

export type ProductToCategory = typeof productsToCategoriesTable.$inferSelect;
export type NewProductToCategory =
  typeof productsToCategoriesTable.$inferInsert;

export type CartItem = typeof cartItemTable.$inferSelect;
export type NewCartItem = typeof cartItemTable.$inferInsert;

export type Collection = typeof collectionTable.$inferSelect;
export type NewCollection = typeof collectionTable.$inferInsert;

export type Account = typeof accountTable.$inferSelect;
export type NewAccount = typeof accountTable.$inferInsert;

export type AccountWallet = typeof accountWalletTable.$inferSelect;
export type NewAccountWallet = typeof accountWalletTable.$inferInsert;
export type AccountWalletTransaction =
  typeof accountWalletTransactionTable.$inferSelect;
export type NewAccountWalletTransaction =
  typeof accountWalletTransactionTable.$inferInsert;
export type AdminActivityEvent = typeof adminActivityEventTable.$inferSelect;
export type NewAdminActivityEvent = typeof adminActivityEventTable.$inferInsert;
export type AdminSidebarReadState =
  typeof adminSidebarReadStateTable.$inferSelect;
export type NewAdminSidebarReadState =
  typeof adminSidebarReadStateTable.$inferInsert;

export type ChatRoom = typeof chatRoomTable.$inferSelect;
export type NewChatRoom = typeof chatRoomTable.$inferInsert;

export type ChatMessage = typeof chatMessageTable.$inferSelect;
export type NewChatMessage = typeof chatMessageTable.$inferInsert;

export type ChatMessageAttachment =
  typeof chatMessageAttachmentTable.$inferSelect;
export type NewChatMessageAttachment =
  typeof chatMessageAttachmentTable.$inferInsert;

export type AdViewCount = typeof adViewCountTable.$inferSelect;
export type NewAdViewCount = typeof adViewCountTable.$inferInsert;

export type Order = typeof orderTable.$inferSelect;
export type NewOrder = typeof orderTable.$inferInsert;

export type OrderItem = typeof orderItemTable.$inferSelect;
export type NewOrderItem = typeof orderItemTable.$inferInsert;

export type RefundItem = typeof refundItemTable.$inferSelect;
export type NewRefundItem = typeof refundItemTable.$inferInsert;
export type RefundLog = typeof refundLogTable.$inferSelect;
export type NewRefundLog = typeof refundLogTable.$inferInsert;

export type Delivery = typeof deliveryTable.$inferSelect;
export type NewDelivery = typeof deliveryTable.$inferInsert;

export type DeliveryLog = typeof deliveryLogTable.$inferSelect;
export type NewDeliveryLog = typeof deliveryLogTable.$inferInsert;

export type MerchantTrade = typeof merchantTradeTable.$inferSelect;
export type NewMerchantTrade = typeof merchantTradeTable.$inferInsert;

export type ShippingFee = typeof shippingFeeTable.$inferSelect;
export type NewShippingFee = typeof shippingFeeTable.$inferInsert;

export type DeviceToken = typeof deviceTokenTable.$inferSelect;
export type NewDeviceToken = typeof deviceTokenTable.$inferInsert;

export type UserMonthlyCoinStat = typeof userMonthlyCoinStatTable.$inferSelect;
export type NewUserMonthlyCoinStat =
  typeof userMonthlyCoinStatTable.$inferInsert;

export type UserNotification = typeof userNotificationTable.$inferSelect;
export type NewUserNotification = typeof userNotificationTable.$inferInsert;

export type AdvertisementCoinFundingAccount =
  typeof advertisementCoinFundingAccountTable.$inferSelect;
export type NewAdvertisementCoinFundingAccount =
  typeof advertisementCoinFundingAccountTable.$inferInsert;

export type AdvertisementCoinSettlementCohort =
  typeof advertisementCoinSettlementCohortTable.$inferSelect;
export type NewAdvertisementCoinSettlementCohort =
  typeof advertisementCoinSettlementCohortTable.$inferInsert;

export type AdvertisementAssignment =
  typeof advertisementAssignmentTable.$inferSelect;
export type NewAdvertisementAssignment =
  typeof advertisementAssignmentTable.$inferInsert;

export type TreasureBoxRewardCycle =
  typeof treasureBoxRewardCycleTable.$inferSelect;
export type NewTreasureBoxRewardCycle =
  typeof treasureBoxRewardCycleTable.$inferInsert;

export type TreasureBoxRewardAllocation =
  typeof treasureBoxRewardAllocationTable.$inferSelect;
export type NewTreasureBoxRewardAllocation =
  typeof treasureBoxRewardAllocationTable.$inferInsert;

export type UserCoinLot = typeof userCoinLotTable.$inferSelect;
export type NewUserCoinLot = typeof userCoinLotTable.$inferInsert;

export type UserCoinTransaction =
  typeof userCoinTransactionTable.$inferSelect;
export type NewUserCoinTransaction =
  typeof userCoinTransactionTable.$inferInsert;

export type ProductSellerCoinReturnTransaction =
  typeof productSellerCoinReturnTransactionTable.$inferSelect;
export type NewProductSellerCoinReturnTransaction =
  typeof productSellerCoinReturnTransactionTable.$inferInsert;

export type OrderCoinAllocation = typeof orderCoinAllocationTable.$inferSelect;
export type NewOrderCoinAllocation =
  typeof orderCoinAllocationTable.$inferInsert;

export type SellerCoinReturnTransaction =
  typeof sellerCoinReturnTransactionTable.$inferSelect;
export type NewSellerCoinReturnTransaction =
  typeof sellerCoinReturnTransactionTable.$inferInsert;

export type AdvertisementBalanceTransfer =
  typeof advertisementBalanceTransferTable.$inferSelect;
export type NewAdvertisementBalanceTransfer =
  typeof advertisementBalanceTransferTable.$inferInsert;

export type AdvertisementCoinFundingTransaction =
  typeof advertisementCoinFundingTransactionTable.$inferSelect;
export type NewAdvertisementCoinFundingTransaction =
  typeof advertisementCoinFundingTransactionTable.$inferInsert;

export type CoinLedgerJobRun = typeof coinLedgerJobRunTable.$inferSelect;
export type NewCoinLedgerJobRun = typeof coinLedgerJobRunTable.$inferInsert;

export type CoinLedgerBackfillCheckpoint =
  typeof coinLedgerBackfillCheckpointTable.$inferSelect;
export type NewCoinLedgerBackfillCheckpoint =
  typeof coinLedgerBackfillCheckpointTable.$inferInsert;
