CREATE TABLE "delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"rtn_code" text,
	"rtn_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."delivery_status";--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'shipped', 'delivered', 'returned', 'cancelled', 'exception', 'unknown');--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;