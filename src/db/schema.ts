// schema.ts
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "canceled",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
]);

export const advertisementStatusEnum = pgEnum("advertisement_status", [
  "active",
  "paused",
  "depleted",
  "archived",
]);
export const transactionTypeEnum = pgEnum("transaction_type", ["deposit"]);

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
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountTable.id),
    productId: uuid("product_id").references(() => productTable.id),
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
    chatRoomUnique: uniqueIndex("chat_rooms_user_account_product_order_uk").on(
      t.userId,
      t.accountId,
      t.productId,
      t.orderId,
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
  role: accountRoleEnum("role").notNull().default("seller"),
  phone: text("phone").notNull(),
  address: text("address"),
  avatar_url: text("avatar_url"),
  accountGroupId: uuid("account_group_id").references(
    () => accountGroupTable.id,
  ),
  status: accountStatusEnum("status").default("active").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const accountWalletTable = pgTable("account_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountTable.id)
    .unique(),
  walletBalance: doublePrecision("wallet_balance").default(0).notNull(),
  totalRevenueCash: doublePrecision("total_revenue_cash").default(0).notNull(),
  totalRevenueCoin: doublePrecision("total_revenue_coin").default(0).notNull(),
  lockedBalance: doublePrecision("locked_balance").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

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
});

export const categoryTable = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

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
  price: doublePrecision("price").notNull(),
  stock: integer("stock").notNull(),
  sku: text("sku"),
  reserve: integer("reserve").notNull().default(0),
  images: text("images").array(),
  status: productStatusEnum("status").default("active").notNull(),
  type: productTypeEnum("type").default("normal").notNull(),
  allowHomeDelivery: boolean("allow_home_delivery").default(false).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const advertisementTable = pgTable("advertisements", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => productTable.id)
    .unique(),
  title: text("title").notNull(),
  description: text("description"),
  video_url: text("video_url").notNull(),
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
  status: advertisementStatusEnum("status").default("paused").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const advertisementTransactionTable = pgTable(
  "advertisement_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementTable.id, { onDelete: "cascade" }),
    amount: doublePrecision("amount").notNull(),
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
    userProductUnique: uniqueIndex("cart_items_user_product_uk").on(
      t.userId,
      t.productId,
    ),
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

export const adViewCountTable = pgTable("ad_view_counts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "set null" }),
  advertisementId: uuid("advertisement_id")
    .notNull()
    .references(() => advertisementTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Add these tables to your schema.ts file

export const orderTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id), // The customer who placed the order
  accountId: uuid("account_id").references(() => accountTable.id), // Optional: Reference to a seller/admin if needed for the whole order
  merchantTradeNo: text("merchant_trade_no"),
  totalAmount: doublePrecision("total_amount").notNull(), // Final calculated total
  discountCoin: integer("discount_coin").default(0), // New field for discount coins used
  // Optionally add status (e.g., 'pending', 'shipped', 'delivered')
  orderStatus: orderStatusEnum("order_status").default("pending").notNull(),
  // Optionally add shipping address, payment details, etc.
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
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
    deliveryId: uuid("delivery_id").references(() => deliveryTable.id),

    quantity: integer("quantity").notNull(),
    pendingQuantity: integer("pending_quantity").notNull().default(0),

    // --- The key fields to handle price change ---
    // 1. Store the price at the time of sale:
    unitPriceAtSale: doublePrecision("unit_price_at_sale").notNull(),

    // 2. Store other static product details for historical accuracy (optional but recommended):
    productNameAtSale: text("product_name_at_sale").notNull(),

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
    orderItemUnique: uniqueIndex("order_items_order_product_uk").on(
      t.orderId,
      t.productId,
    ),
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
  LogisticsType: text("logistics_type").notNull(),
  LogisticsSubType: text("logistics_sub_type"),
  RtnCode: text("rtn_code"),
  RtnMsg: text("rtn_msg"),
  GoodsAmount: doublePrecision("goods_amount").notNull(),
  metadata: jsonb("metadata"),
  cvsStoreInfo: jsonb("cvs_store_info"),
  homeDeliveryData: jsonb("home_delivery_data"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const merchantTradeTable = pgTable("merchant_trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orderTable.id, { onDelete: "cascade" }),
  merchantTradeNo: text("merchant_trade_no").notNull(),
  productIds: uuid("product_ids").array().notNull(),
  cvsStoreInfo: jsonb("cvs_store_info"),
});

export const deviceTokenTable = pgTable("device_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  fcmToken: text("fcm_token").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
  ({ one }) => ({
    account: one(accountTable, {
      fields: [accountWalletTable.accountId],
      references: [accountTable.id],
    }),
  }),
);

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
}));

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

export const orderItemRelations = relations(orderItemTable, ({ one }) => ({
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
}));

export const deliveryRelations = relations(deliveryTable, ({ one, many }) => ({
  order: one(orderTable, {
    fields: [deliveryTable.orderId],
    references: [orderTable.id],
  }),
  items: many(orderItemTable), // A delivery can have many items
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

export type Delivery = typeof deliveryTable.$inferSelect;
export type NewDelivery = typeof deliveryTable.$inferInsert;

export type MerchantTrade = typeof merchantTradeTable.$inferSelect;
export type NewMerchantTrade = typeof merchantTradeTable.$inferInsert;

export type DeviceToken = typeof deviceTokenTable.$inferSelect;
export type NewDeviceToken = typeof deviceTokenTable.$inferInsert;

export type UserMonthlyCoinStat = typeof userMonthlyCoinStatTable.$inferSelect;
export type NewUserMonthlyCoinStat =
  typeof userMonthlyCoinStatTable.$inferInsert;

export type UserNotification = typeof userNotificationTable.$inferSelect;
export type NewUserNotification = typeof userNotificationTable.$inferInsert;
