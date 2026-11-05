CREATE TYPE "public"."account_role" AS ENUM('admin', 'seller', 'employee');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'inactive', 'banned');--> statement-breakpoint
CREATE TYPE "public"."advertisement_status" AS ENUM('active', 'paused', 'depleted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."chat_message_sender" AS ENUM('user', 'admin', 'seller');--> statement-breakpoint
CREATE TYPE "public"."chat_room_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."delivery_logistics_type" AS ENUM('CVS', 'home_delivery', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'shipped', 'ready_for_pickup', 'delivered', 'returned', 'cancelled', 'exception', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('system_alert', 'order_status', 'promotion', 'coins_earned', 'chat_message', 'other');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'apple', 'github', 'facebook', 'line', 'password', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('normal', 'refrigeration', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('deposit');--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"real_name" text NOT NULL,
	"role" "account_role" DEFAULT 'seller' NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"avatar_url" text,
	"account_group_id" uuid,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "account_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet_balance" double precision DEFAULT 0 NOT NULL,
	"total_revenue_cash" double precision DEFAULT 0 NOT NULL,
	"total_revenue_coin" double precision DEFAULT 0 NOT NULL,
	"locked_balance" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_wallets_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "ad_view_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertisement_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"total_spent" double precision DEFAULT 0 NOT NULL,
	"status" "advertisement_status" DEFAULT 'paused' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_stats_advertisement_id_unique" UNIQUE("advertisement_id")
);
--> statement-breakpoint
CREATE TABLE "advertisements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"video_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisements_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "advertisement_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"amount" double precision NOT NULL,
	"type" "transaction_type" DEFAULT 'deposit' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"checked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_message_id" uuid NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"name" text,
	"size" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_room_id" uuid NOT NULL,
	"sender_type" "chat_message_sender" NOT NULL,
	"content" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"product_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "chat_room_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"rtn_code" text,
	"rtn_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_trade_no" text,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"all_pay_logistics_id" text,
	"cvs_payment_no" text,
	"cvs_validation_no" text,
	"logistics_type" "delivery_logistics_type" NOT NULL,
	"logistics_sub_type" text,
	"rtn_code" text,
	"rtn_msg" text,
	"goods_amount" double precision NOT NULL,
	"metadata" jsonb,
	"cvs_store_info" jsonb,
	"home_delivery_data" jsonb,
	"fee" double precision DEFAULT 0,
	"fee_deduction" double precision DEFAULT 0,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fcm_token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_fcm_token_unique" UNIQUE("fcm_token")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_trade_no" text NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"cvs_store_info" jsonb,
	"shipping_cost" double precision DEFAULT 0,
	"shipping_cost_deduction" double precision DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delivery_id" uuid,
	"quantity" integer NOT NULL,
	"pending_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price_at_sale" double precision NOT NULL,
	"product_name_at_sale" text NOT NULL,
	"line_total" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"merchant_trade_no" text,
	"sub_total" double precision NOT NULL,
	"total_amount" double precision NOT NULL,
	"discount_coin" integer DEFAULT 0,
	"shipping_cost" double precision DEFAULT 0,
	"shipping_cost_deduction" double precision DEFAULT 0,
	"transaction_fee" double precision DEFAULT 0,
	"order_status" "order_status" DEFAULT 'pending' NOT NULL,
	"transaction_fee_rate_at_sale" double precision,
	"user_level_at_sale" text,
	"user_max_discount_at_sale" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"description" text NOT NULL,
	"price" double precision NOT NULL,
	"stock" integer NOT NULL,
	"sku" text,
	"reserve" integer DEFAULT 0 NOT NULL,
	"images" text[],
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"type" "product_type" DEFAULT 'normal' NOT NULL,
	"allow_home_delivery" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products_to_categories" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "products_to_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "shipping_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"home_delivery" double precision DEFAULT 60,
	"home_delivery_refrigeration" double precision DEFAULT 160,
	"okmart_low_temperature_c2c" double precision DEFAULT 160,
	"fami_c2c" double precision DEFAULT 69,
	"unimart_c2c" double precision DEFAULT 69,
	"hilife_c2c" double precision DEFAULT 58,
	"okmart_c2c" double precision DEFAULT 58
);
--> statement-breakpoint
CREATE TABLE "treasure_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"coins_awarded" double precision NOT NULL,
	"is_opened" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "user_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total_views" integer DEFAULT 0 NOT NULL,
	"viewed_ads" text[] DEFAULT '{}' NOT NULL,
	"treasure_boxes_earned" integer DEFAULT 0 NOT NULL,
	"can_watch_more" boolean DEFAULT true NOT NULL,
	"remaining_views" integer DEFAULT 20 NOT NULL,
	"next_treasure_box_in" integer DEFAULT 2 NOT NULL,
	"group_ad_views_count_yesterday" integer DEFAULT 20,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_daily_stats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_monthly_coin_stats" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"coins_earned" double precision DEFAULT 0 NOT NULL,
	"coins_spent" double precision DEFAULT 0 NOT NULL,
	"expired" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_monthly_coin_stats_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" DEFAULT 'system_alert' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"oauth_provider" "oauth_provider" NOT NULL,
	"oauth_id" text NOT NULL,
	"coins" double precision DEFAULT 0 NOT NULL,
	"referral_code" text NOT NULL,
	"name" text,
	"phone" text,
	"address" text,
	"avatar_url" text,
	"terms_accepted_at" timestamp with time zone,
	"group_id" uuid,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_group_id_account_groups_id_fk" FOREIGN KEY ("account_group_id") REFERENCES "public"."account_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD CONSTRAINT "ad_view_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD CONSTRAINT "ad_view_counts_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_stats" ADD CONSTRAINT "advertisement_stats_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD CONSTRAINT "advertisement_transactions_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_room_id_chat_rooms_id_fk" FOREIGN KEY ("chat_room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD CONSTRAINT "merchant_trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_to_categories" ADD CONSTRAINT "products_to_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_to_categories" ADD CONSTRAINT "products_to_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_fees" ADD CONSTRAINT "shipping_fees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD CONSTRAINT "treasure_boxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_daily_stats" ADD CONSTRAINT "user_daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_monthly_coin_stats" ADD CONSTRAINT "user_monthly_coin_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertisement_transactions_ad_id_idx" ON "advertisement_transactions" USING btree ("advertisement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_product_uk" ON "cart_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_order_uk" ON "chat_rooms" USING btree ("user_id","account_id","product_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_product_uk" ON "collections" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_user_device_uk" ON "device_tokens" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_product_uk" ON "order_items" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_fees_account_id_uk" ON "shipping_fees" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "user_notifications_user_read_idx" ON "user_notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oauth_provider_id_uk" ON "users" USING btree ("oauth_provider","oauth_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uk" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_timezone_idx" ON "users" USING btree ("timezone");