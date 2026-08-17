CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"organization" text,
	"email" text,
	"linkedin_url" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_list_items" (
	"list_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"rank" integer,
	CONSTRAINT "entity_list_items_list_id_entity_id_pk" PRIMARY KEY("list_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "entity_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'context' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"account_email" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"scope" text,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"conversation_id" uuid,
	"channel" text NOT NULL,
	"status" text DEFAULT 'drafted' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"steps" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"role" text,
	"company" text,
	"location" text,
	"timezone" text,
	"sending_email" text,
	"email_signature" text,
	"calendar_link" text,
	"writing_tone" text,
	"about" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_list_items" ADD CONSTRAINT "entity_list_items_list_id_entity_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."entity_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_list_items" ADD CONSTRAINT "entity_list_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_lists" ADD CONSTRAINT "entity_lists_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_user_type_idx" ON "entities" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "entities_attributes_idx" ON "entities" USING gin ("attributes");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_user_email_idx" ON "entities" USING btree ("user_id",lower("email")) WHERE "entities"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_user_linkedin_idx" ON "entities" USING btree ("user_id",lower("linkedin_url")) WHERE "entities"."linkedin_url" is not null;--> statement-breakpoint
CREATE INDEX "entity_list_items_entity_idx" ON "entity_list_items" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_lists_user_created_idx" ON "entity_lists" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memories_user_created_idx" ON "memories" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outreach_user_entity_idx" ON "outreach" USING btree ("user_id","entity_id");--> statement-breakpoint
CREATE INDEX "outreach_status_idx" ON "outreach" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "plans_conversation_created_idx" ON "plans" USING btree ("conversation_id","created_at" DESC NULLS LAST);