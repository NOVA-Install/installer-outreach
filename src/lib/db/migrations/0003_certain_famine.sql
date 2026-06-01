CREATE TABLE "price_scrape_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"postcode" text NOT NULL,
	"property_config" text,
	"panel_only_price" real,
	"recommended_price" real,
	"price_per_panel" real,
	"recommended_panel_count" integer,
	"panel_model" text,
	"price_matrix" text,
	"screenshot_path" text,
	"error_log" text,
	"scraped_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_scrape_results" ADD CONSTRAINT "price_scrape_results_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;