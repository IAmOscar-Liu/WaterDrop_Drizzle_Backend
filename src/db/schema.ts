// schema.ts
import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
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

// Convenient TS types
export type User = typeof userTable.$inferSelect;
export type NewUser = typeof userTable.$inferInsert;

export type Group = typeof groupTable.$inferSelect;
export type NewGroup = typeof groupTable.$inferInsert;

export type UserDailyStat = typeof userDailyStatTable.$inferSelect;
export type NewUserDailyStat = typeof userDailyStatTable.$inferInsert;

export type TreasureBox = typeof treasureBoxTable.$inferSelect;
export type NewTreasureBox = typeof treasureBoxTable.$inferInsert;
