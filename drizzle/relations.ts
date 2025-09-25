import { relations } from "drizzle-orm/relations";
import { products, advertisements, accounts, users, adViewCounts, cartItems, groups, userDailyStats, chatRooms, chatMessages, treasureBoxes, productsToCategories, categories } from "./schema";

export const advertisementsRelations = relations(advertisements, ({one, many}) => ({
	product: one(products, {
		fields: [advertisements.productId],
		references: [products.id]
	}),
	adViewCounts: many(adViewCounts),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	advertisements: many(advertisements),
	account: one(accounts, {
		fields: [products.sellerId],
		references: [accounts.id]
	}),
	cartItems: many(cartItems),
	chatRooms: many(chatRooms),
	productsToCategories: many(productsToCategories),
}));

export const accountsRelations = relations(accounts, ({many}) => ({
	products: many(products),
	chatRooms: many(chatRooms),
}));

export const adViewCountsRelations = relations(adViewCounts, ({one}) => ({
	user: one(users, {
		fields: [adViewCounts.userId],
		references: [users.id]
	}),
	advertisement: one(advertisements, {
		fields: [adViewCounts.advertisementId],
		references: [advertisements.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	adViewCounts: many(adViewCounts),
	cartItems: many(cartItems),
	group: one(groups, {
		fields: [users.groupId],
		references: [groups.id]
	}),
	userDailyStats: many(userDailyStats),
	chatRooms: many(chatRooms),
	treasureBoxes: many(treasureBoxes),
}));

export const cartItemsRelations = relations(cartItems, ({one}) => ({
	user: one(users, {
		fields: [cartItems.userId],
		references: [users.id]
	}),
	product: one(products, {
		fields: [cartItems.productId],
		references: [products.id]
	}),
}));

export const groupsRelations = relations(groups, ({many}) => ({
	users: many(users),
}));

export const userDailyStatsRelations = relations(userDailyStats, ({one}) => ({
	user: one(users, {
		fields: [userDailyStats.userId],
		references: [users.id]
	}),
}));

export const chatRoomsRelations = relations(chatRooms, ({one, many}) => ({
	user: one(users, {
		fields: [chatRooms.userId],
		references: [users.id]
	}),
	account: one(accounts, {
		fields: [chatRooms.accountId],
		references: [accounts.id]
	}),
	product: one(products, {
		fields: [chatRooms.productId],
		references: [products.id]
	}),
	chatMessages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({one}) => ({
	chatRoom: one(chatRooms, {
		fields: [chatMessages.chatRoomId],
		references: [chatRooms.id]
	}),
}));

export const treasureBoxesRelations = relations(treasureBoxes, ({one}) => ({
	user: one(users, {
		fields: [treasureBoxes.userId],
		references: [users.id]
	}),
}));

export const productsToCategoriesRelations = relations(productsToCategories, ({one}) => ({
	product: one(products, {
		fields: [productsToCategories.productId],
		references: [products.id]
	}),
	category: one(categories, {
		fields: [productsToCategories.categoryId],
		references: [categories.id]
	}),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	productsToCategories: many(productsToCategories),
}));