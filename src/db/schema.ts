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

export const accountRoleEnum = pgEnum("account_role", ["admin", "seller"]);

export const chatMessageSenderEnum = pgEnum("chat_message_sender", [
  "user",
  "admin",
  "seller",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    chatRoomUnique: uniqueIndex("chat_rooms_user_account_product_uk").on(
      t.userId,
      t.accountId,
      t.productId
    ),
  })
);

export const chatMessageTable = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatRoomId: uuid("chat_room_id")
    .notNull()
    .references(() => chatRoomTable.id, { onDelete: "cascade" }),
  senderType: chatMessageSenderEnum("sender_type").notNull(),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const accountTable = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // This should store a hashed password
  name: text("name"),
  role: accountRoleEnum("role").notNull().default("seller"),
  phone: text("phone"),
  address: text("address"),
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

    coins: integer("coins").notNull().default(0),

    referralCode: text("referral_code").notNull(),
    name: text("name"),
    phone: text("phone"),
    address: text("address"),
    avatar_url: text("avatar_url"),

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
        table.email
      ),
      byReferral: uniqueIndex("users_referral_code_uk").on(table.referralCode),
      byTimezone: index("users_timezone_idx").on(table.timezone),
      // Optional helpful indexes:
    };
  }
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
  coinsAwarded: integer("coins_awarded").notNull(),
  isOpened: boolean("is_opened").default(false).notNull(),
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
  sellerId: uuid("seller_id").references(() => accountTable.id, {
    onDelete: "set null",
  }),

  name: text("name").notNull(),
  avatar: text("avatar"),
  description: text("description").notNull(),
  price: doublePrecision("price").notNull(),
  stock: integer("stock").notNull(),
  images: text("images").array(),
  status: text("status").default("active").notNull(),
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
      t.productId
    ),
  })
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
      t.productId
    ),
  })
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
  })
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

    quantity: integer("quantity").notNull(),

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
  },
  (t) => ({
    orderItemUnique: uniqueIndex("order_items_order_product_uk").on(
      t.orderId,
      t.productId
    ),
  })
);

// Relations
export const accountRelations = relations(accountTable, ({ many }) => ({
  products: many(productTable),
  chatRooms: many(chatRoomTable),
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
}));

export const groupsRelations = relations(groupTable, ({ one, many }) => ({
  owner: one(userTable, {
    fields: [groupTable.ownerId],
    references: [userTable.id],
  }),
  users: many(userTable),
}));

export const userDailyStatRelations = relations(
  userDailyStatTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userDailyStatTable.userId],
      references: [userTable.id],
    }),
  })
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
  messages: many(chatMessageTable),
}));

export const chatMessageRelations = relations(chatMessageTable, ({ one }) => ({
  chatRoom: one(chatRoomTable, {
    fields: [chatMessageTable.chatRoomId],
    references: [chatRoomTable.id],
  }),
}));

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
  })
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
  })
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
  items: many(orderItemTable),
}));

export const orderItemRelations = relations(orderItemTable, ({ one }) => ({
  order: one(orderTable, {
    fields: [orderItemTable.orderId],
    references: [orderTable.id],
  }),
  product: one(productTable, {
    fields: [orderItemTable.productId],
    references: [productTable.id],
  }),
}));

// Convenient TS types
export type User = typeof userTable.$inferSelect;
export type NewUser = typeof userTable.$inferInsert;

export type Group = typeof groupTable.$inferSelect;
export type NewGroup = typeof groupTable.$inferInsert;

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

export type ProductToCategory = typeof productsToCategoriesTable.$inferSelect;
export type NewProductToCategory =
  typeof productsToCategoriesTable.$inferInsert;

export type CartItem = typeof cartItemTable.$inferSelect;
export type NewCartItem = typeof cartItemTable.$inferInsert;

export type Collection = typeof collectionTable.$inferSelect;
export type NewCollection = typeof collectionTable.$inferInsert;

export type Account = typeof accountTable.$inferSelect;
export type NewAccount = typeof accountTable.$inferInsert;

export type ChatRoom = typeof chatRoomTable.$inferSelect;
export type NewChatRoom = typeof chatRoomTable.$inferInsert;

export type ChatMessage = typeof chatMessageTable.$inferSelect;
export type NewChatMessage = typeof chatMessageTable.$inferInsert;

export type AdViewCount = typeof adViewCountTable.$inferSelect;
export type NewAdViewCount = typeof adViewCountTable.$inferInsert;

export type Order = typeof orderTable.$inferSelect;
export type NewOrder = typeof orderTable.$inferInsert;

export type OrderItem = typeof orderItemTable.$inferSelect;
export type NewOrderItem = typeof orderItemTable.$inferInsert;
