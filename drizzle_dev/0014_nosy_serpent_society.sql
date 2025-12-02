CREATE TYPE "public"."chat_room_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "status" "chat_room_status" DEFAULT 'active' NOT NULL;