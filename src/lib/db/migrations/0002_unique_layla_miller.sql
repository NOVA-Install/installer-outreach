CREATE TABLE "mystery_shop_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"zones" text,
	"system_spec" text,
	"property_config" text,
	"total_targets" integer DEFAULT 0,
	"processed_targets" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"started_at" text,
	"completed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mystery_shop_email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text NOT NULL,
	"phone_number" text,
	"zone_id" text,
	"is_active" boolean DEFAULT true,
	"last_used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "mystery_shop_email_accounts_email_address_unique" UNIQUE("email_address")
);
--> statement-breakpoint
CREATE TABLE "mystery_shop_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_id" integer NOT NULL,
	"option_label" text,
	"total_price" real,
	"summary" text,
	"details" text,
	"raw_ai_output" text,
	"confidence" real,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mystery_shop_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"installer_id" integer NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"burner_email" text,
	"submitted_at" text,
	"first_response_at" text,
	"response_time_hours" real,
	"response_format" text,
	"form_data" text,
	"raw_response_data" text,
	"ai_parse_status" text,
	"error_log" text,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_campaign_installer" UNIQUE("campaign_id","installer_id")
);
--> statement-breakpoint
CREATE TABLE "mystery_shop_zone_properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"zone_id" text NOT NULL,
	"address" text NOT NULL,
	"postcode" text NOT NULL,
	"details" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "mystery_shop_zone_properties_zone_id_unique" UNIQUE("zone_id")
);
--> statement-breakpoint
ALTER TABLE "mystery_shop_quotes" ADD CONSTRAINT "mystery_shop_quotes_target_id_mystery_shop_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."mystery_shop_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mystery_shop_targets" ADD CONSTRAINT "mystery_shop_targets_campaign_id_mystery_shop_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mystery_shop_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mystery_shop_targets" ADD CONSTRAINT "mystery_shop_targets_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;