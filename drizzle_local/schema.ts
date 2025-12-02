import { pgTable, foreignKey, unique, uuid, text, timestamp, doublePrecision, integer, jsonb, uniqueIndex, index, boolean, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const accountRole = pgEnum("account_role", ['admin', 'seller'])
export const chatMessageSender = pgEnum("chat_message_sender", ['user', 'admin', 'seller'])
export const oauthProvider = pgEnum("oauth_provider", ['google', 'apple', 'github', 'facebook', 'line', 'password', 'other'])


export const advertisements = pgTable("advertisements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	title: text().notNull(),
	description: text(),
	videoUrl: text("video_url").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "advertisements_product_id_products_id_fk"
		}),
	unique("advertisements_product_id_unique").on(table.productId),
]);

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	avatar: text(),
	description: text().notNull(),
	price: doublePrecision().notNull(),
	stock: integer().notNull(),
	images: text().array(),
	status: text().default('active').notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sellerId: uuid("seller_id"),
}, (table) => [
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [accounts.id],
			name: "products_seller_id_accounts_id_fk"
		}).onDelete("set null"),
]);

export const adViewCounts = pgTable("ad_view_counts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	advertisementId: uuid("advertisement_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ad_view_counts_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.advertisementId],
			foreignColumns: [advertisements.id],
			name: "ad_view_counts_advertisement_id_advertisements_id_fk"
		}).onDelete("set null"),
]);

export const cartItems = pgTable("cart_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	quantity: integer().default(1).notNull(),
	userId: uuid("user_id").notNull(),
	productId: uuid("product_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("cart_items_user_product_uk").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "cart_items_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "cart_items_product_id_products_id_fk"
		}),
]);

export const groups = pgTable("groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: uuid("owner_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	password: text().notNull(),
	name: text(),
	role: accountRole().default('seller').notNull(),
	phone: text(),
	address: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("accounts_email_unique").on(table.email),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	oauthProvider: oauthProvider("oauth_provider").notNull(),
	oauthId: text("oauth_id").notNull(),
	coins: integer().default(0).notNull(),
	referralCode: text("referral_code").notNull(),
	name: text(),
	phone: text(),
	address: text(),
	groupId: uuid("group_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	timezone: text(),
	avatar: text(),
}, (table) => [
	uniqueIndex("users_oauth_provider_id_uk").using("btree", table.oauthProvider.asc().nullsLast().op("enum_ops"), table.email.asc().nullsLast().op("text_ops")),
	uniqueIndex("users_referral_code_uk").using("btree", table.referralCode.asc().nullsLast().op("text_ops")),
	index("users_timezone_idx").using("btree", table.timezone.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "users_group_id_groups_id_fk"
		}),
]);

export const userDailyStats = pgTable("user_daily_stats", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	totalViews: integer("total_views").default(0).notNull(),
	treasureBoxesEarned: integer("treasure_boxes_earned").default(0).notNull(),
	canWatchMore: boolean("can_watch_more").default(true).notNull(),
	remainingViews: integer("remaining_views").default(20).notNull(),
	nextTreasureBoxIn: integer("next_treasure_box_in").default(2).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_daily_stats_user_id_users_id_fk"
		}),
	unique("user_daily_stats_user_id_unique").on(table.userId),
]);

export const chatRooms = pgTable("chat_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	accountId: uuid("account_id").notNull(),
	productId: uuid("product_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("chat_rooms_user_account_product_uk").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.accountId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "chat_rooms_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "chat_rooms_account_id_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "chat_rooms_product_id_products_id_fk"
		}),
]);

export const chatMessages = pgTable("chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	chatRoomId: uuid("chat_room_id").notNull(),
	senderType: chatMessageSender("sender_type").notNull(),
	content: text().notNull(),
	isRead: boolean("is_read").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.chatRoomId],
			foreignColumns: [chatRooms.id],
			name: "chat_messages_chat_room_id_chat_rooms_id_fk"
		}).onDelete("cascade"),
]);

export const treasureBoxes = pgTable("treasure_boxes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	earnedAt: timestamp("earned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }),
	coinsAwarded: integer("coins_awarded").notNull(),
	isOpened: boolean("is_opened").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "treasure_boxes_user_id_users_id_fk"
		}),
]);

export const productsToCategories = pgTable("products_to_categories", {
	productId: uuid("product_id").notNull(),
	categoryId: uuid("category_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "products_to_categories_product_id_products_id_fk"
		}),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "products_to_categories_category_id_categories_id_fk"
		}),
	primaryKey({ columns: [table.productId, table.categoryId], name: "products_to_categories_product_id_category_id_pk"}),
]);
