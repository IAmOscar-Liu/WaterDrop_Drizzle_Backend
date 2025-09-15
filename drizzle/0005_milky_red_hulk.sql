CREATE TABLE "treasure_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"coins_awarded" integer NOT NULL,
	"is_opened" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD CONSTRAINT "treasure_boxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;