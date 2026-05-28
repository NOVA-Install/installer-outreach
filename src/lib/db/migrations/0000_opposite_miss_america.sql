CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"metadata" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies_house_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"company_number" text,
	"company_status" text,
	"incorporation_date" text,
	"company_type" text,
	"sic_codes" text,
	"registered_address" text,
	"last_accounts_date" text,
	"account_category" text,
	"employee_count" integer,
	"officers" text,
	"persons_of_control" text,
	"latest_accounts_url" text,
	"latest_accounts_type" text,
	"has_insolvency_history" boolean,
	"has_charges" boolean,
	"charges_count" integer,
	"fetched_at" text NOT NULL,
	CONSTRAINT "companies_house_data_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "dataforseo_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"task_id" text NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"search_term" text,
	"result_summary" text,
	"raw_result" text,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "enrichment_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"total_items" integer,
	"processed_items" integer,
	"error_count" integer,
	"error_log" text,
	"started_at" text,
	"completed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_ads_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"advertiser_id" text,
	"advertiser_name" text,
	"is_verified" boolean,
	"total_ads" integer,
	"text_ads" integer,
	"image_ads" integer,
	"video_ads" integer,
	"platforms" text,
	"first_ad_seen" text,
	"last_ad_seen" text,
	"sample_ad_titles" text,
	"transparency_urls" text,
	"fetched_at" text NOT NULL,
	CONSTRAINT "google_ads_data_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "google_business_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"place_id" text,
	"title" text,
	"phone" text,
	"website_domain" text,
	"main_category" text,
	"address" text,
	"city" text,
	"postal_code" text,
	"latitude" real,
	"longitude" real,
	"total_photos" integer,
	"is_claimed" boolean,
	"current_status" text,
	"work_hours" text,
	"price_level" text,
	"additional_categories" text,
	"fetched_at" text NOT NULL,
	CONSTRAINT "google_business_info_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "google_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"place_id" text,
	"rating" real,
	"review_count" integer,
	"reviews_per_month" real,
	"business_status" text,
	"fetched_at" text NOT NULL,
	CONSTRAINT "google_reviews_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "installer_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"reputation_score" real,
	"marketing_activity_score" real,
	"overall_score" real,
	"tier" text,
	"last_calculated_at" text NOT NULL,
	CONSTRAINT "installer_scores_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "installer_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_identifier" text NOT NULL,
	"source_company_name" text,
	"source_postcode" text,
	"imported_at" text NOT NULL,
	CONSTRAINT "uq_source_identifier" UNIQUE("source","source_identifier")
);
--> statement-breakpoint
CREATE TABLE "installer_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"tag_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installers" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" text,
	"company_name" text NOT NULL,
	"alternative_names" text,
	"legal_entity_name" text,
	"legal_entity_number" text,
	"website_status" text,
	"certification_number" text,
	"certification_body" text,
	"email" text,
	"telephone" text,
	"website" text,
	"address" text,
	"county" text,
	"postcode" text,
	"country" text,
	"latitude" real,
	"longitude" real,
	"website_sources" text,
	"email_sources" text,
	"telephone_sources" text,
	"address_sources" text,
	"company_name_sources" text,
	"in_nova" boolean,
	"in_mcs" boolean,
	"in_trustmark" boolean,
	"source_count" integer,
	"boiler_upgrade_scheme" text,
	"technologies_certified" text,
	"regions_covered" text,
	"nova_year_started" text,
	"nova_battery_storage" text,
	"nova_location_area" text,
	"nova_incorporated_name" text,
	"nova_enf_profile_url" text,
	"trustmark_tmln" text,
	"trustmark_district" text,
	"trustmark_region" text,
	"trustmark_national_coverage" text,
	"trustmark_scheme_providers" text,
	"trustmark_member_since" text,
	"trustmark_description" text,
	"trustmark_profile_url" text,
	"trustmark_status" text,
	"is_shortlisted" boolean DEFAULT false,
	"priority" integer,
	"priority_note" text,
	"pipeline_stage" text DEFAULT 'uncontacted',
	"pipeline_stage_updated_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "installers_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"total_postings" integer,
	"postings" text,
	"is_hiring" boolean,
	"fetched_at" text NOT NULL,
	CONSTRAINT "job_postings_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "keyword_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"keyword" text NOT NULL,
	"search_volume" integer,
	"cpc" real,
	"competition" text,
	"competition_index" integer,
	"low_top_of_page_bid" real,
	"high_top_of_page_bid" real,
	"monthly_searches" text,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linkedin_company_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"linkedin_url" text NOT NULL,
	"company_slug" text,
	"last_searched_at" text,
	CONSTRAINT "linkedin_company_tracking_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"has_meta_ads" boolean,
	"meta_ad_count" integer,
	"meta_ad_last_seen" text,
	"has_google_analytics" boolean,
	"has_google_ads" boolean,
	"has_meta_pixel" boolean,
	"has_crm_tool" boolean,
	"crm_tool_name" text,
	"has_live_chat" boolean,
	"live_chat_tool" text,
	"detected_technologies" text,
	"estimated_monthly_traffic" integer,
	"estimated_ad_spend" real,
	"facebook_url" text,
	"instagram_url" text,
	"linkedin_url" text,
	"twitter_url" text,
	"youtube_url" text,
	"detection_version" integer DEFAULT 3,
	"fetched_at" text NOT NULL,
	CONSTRAINT "marketing_signals_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"source" text NOT NULL,
	"rating" real,
	"review_text" text,
	"reviewer_name" text,
	"review_date" text,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"domain_authority" integer,
	"backlinks_count" integer,
	"referring_domains" integer,
	"organic_keywords" integer,
	"fetched_at" text NOT NULL,
	CONSTRAINT "seo_data_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "social_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"post_id" text NOT NULL,
	"post_url" text,
	"post_text" text,
	"author_name" text,
	"author_headline" text,
	"author_profile_url" text,
	"author_profile_id" text,
	"posted_at" text,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"signal_type" text NOT NULL,
	"fetched_at" text NOT NULL,
	CONSTRAINT "social_signals_post_id_unique" UNIQUE("post_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "traffic_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"google_organic_etv" real,
	"google_organic_count" integer,
	"google_organic_traffic_cost" real,
	"google_paid_etv" real,
	"google_paid_count" integer,
	"google_paid_traffic_cost" real,
	"google_featured_snippet_etv" real,
	"google_local_pack_etv" real,
	"google_organic_pos_1" integer,
	"google_organic_pos_2_3" integer,
	"google_organic_pos_4_10" integer,
	"google_organic_pos_11_20" integer,
	"google_organic_is_new" integer,
	"google_organic_is_up" integer,
	"google_organic_is_down" integer,
	"google_organic_is_lost" integer,
	"google_paid_pos_1" integer,
	"google_paid_pos_2_3" integer,
	"google_paid_pos_4_10" integer,
	"bing_organic_etv" real,
	"bing_organic_count" integer,
	"bing_paid_etv" real,
	"bing_paid_count" integer,
	"source" text,
	"fetched_at" text NOT NULL,
	CONSTRAINT "traffic_data_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "trustpilot_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"trustpilot_url" text,
	"rating" real,
	"review_count" integer,
	"trust_score" real,
	"fetched_at" text NOT NULL,
	CONSTRAINT "trustpilot_reviews_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
CREATE TABLE "website_quality" (
	"id" serial PRIMARY KEY NOT NULL,
	"installer_id" integer NOT NULL,
	"performance_score" integer,
	"accessibility_score" integer,
	"best_practices_score" integer,
	"seo_score" integer,
	"form_type" text,
	"form_details" text,
	"site_builder" text,
	"has_social_links" boolean,
	"has_favicon" boolean,
	"is_mobile_responsive" boolean,
	"has_privacy_policy" boolean,
	"has_cookie_consent" boolean,
	"copyright_year" integer,
	"has_schema_markup" boolean,
	"has_blog" boolean,
	"wordpress_version" text,
	"broken_image_count" integer,
	"image_count" integer,
	"has_generic_email" boolean,
	"agency_name" text,
	"response_time_ms" integer,
	"is_https" boolean,
	"enrichment_version" integer,
	"fetched_at" text NOT NULL,
	CONSTRAINT "website_quality_installer_id_unique" UNIQUE("installer_id")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies_house_data" ADD CONSTRAINT "companies_house_data_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataforseo_tasks" ADD CONSTRAINT "dataforseo_tasks_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_ads_data" ADD CONSTRAINT "google_ads_data_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_business_info" ADD CONSTRAINT "google_business_info_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reviews" ADD CONSTRAINT "google_reviews_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installer_scores" ADD CONSTRAINT "installer_scores_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installer_sources" ADD CONSTRAINT "installer_sources_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installer_tags" ADD CONSTRAINT "installer_tags_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installer_tags" ADD CONSTRAINT "installer_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_data" ADD CONSTRAINT "keyword_data_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkedin_company_tracking" ADD CONSTRAINT "linkedin_company_tracking_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_signals" ADD CONSTRAINT "marketing_signals_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_data" ADD CONSTRAINT "seo_data_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_data" ADD CONSTRAINT "traffic_data_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trustpilot_reviews" ADD CONSTRAINT "trustpilot_reviews_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_quality" ADD CONSTRAINT "website_quality_installer_id_installers_id_fk" FOREIGN KEY ("installer_id") REFERENCES "public"."installers"("id") ON DELETE no action ON UPDATE no action;