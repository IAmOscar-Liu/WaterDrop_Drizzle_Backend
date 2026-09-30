CREATE TYPE "public"."admin_sidebar_section" AS ENUM('orders', 'deliveries', 'refunds', 'advertisements', 'chatrooms');--> statement-breakpoint
CREATE TABLE "admin_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_account_id" uuid,
	"seller_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sidebar_read_states" (
	"account_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"section" "admin_sidebar_section" NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sidebar_read_states_account_id_scope_key_section_pk" PRIMARY KEY("account_id","scope_key","section")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleted_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "deleted_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_activity_events" ADD CONSTRAINT "admin_activity_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_events" ADD CONSTRAINT "admin_activity_events_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sidebar_read_states" ADD CONSTRAINT "admin_sidebar_read_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_activity_events_seller_created_idx" ON "admin_activity_events" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_activity_events_actor_created_idx" ON "admin_activity_events" USING btree ("actor_account_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_sidebar_read_states_account_idx" ON "admin_sidebar_read_states" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_deleted_by_account_id_accounts_id_fk" FOREIGN KEY ("deleted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_case_insensitive_uk" ON "categories" USING btree (lower("name"));