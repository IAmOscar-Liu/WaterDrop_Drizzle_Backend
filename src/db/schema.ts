// schema.ts
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
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

    groupId: uuid("group_id").references(() => groupTable.id),
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

// Relations
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

export const productRelations = relations(productTable, ({ one, many }) => ({
  advertisement: one(advertisementTable, {
    fields: [productTable.id],
    references: [advertisementTable.productId],
  }),
  productsToCategories: many(productsToCategoriesTable),
  cartItems: many(cartItemTable),
}));

export const advertisementRelations = relations(
  advertisementTable,
  ({ one }) => ({
    product: one(productTable, {
      fields: [advertisementTable.productId],
      references: [productTable.id],
    }),
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
