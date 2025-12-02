CREATE TABLE "user_monthly_coin_stats" (
	"user_id" uuid NOT NULL,
	"month" timestamp with time zone NOT NULL,
	"coins_earned" double precision DEFAULT 0 NOT NULL,
	"coins_spent" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_monthly_coin_stats_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
ALTER TABLE "user_monthly_coin_stats" ADD CONSTRAINT "user_monthly_coin_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;