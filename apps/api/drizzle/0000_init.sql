CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"run_id" uuid,
	"name" text NOT NULL,
	"props" jsonb NOT NULL,
	"client_ts" timestamp with time zone,
	"server_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" text,
	"pwa_installed" boolean
);
--> statement-breakpoint
CREATE TABLE "point_contents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"content_ref" text NOT NULL,
	"locale" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_version" integer NOT NULL,
	"spec_hash" text NOT NULL,
	"name" jsonb NOT NULL,
	"summary" jsonb,
	"mode" text NOT NULL,
	"activity" text NOT NULL,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"locales" jsonb NOT NULL,
	"cover_image" jsonb,
	"point_count" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"est_minutes" integer NOT NULL,
	"centroid_lat" double precision NOT NULL,
	"centroid_lng" double precision NOT NULL,
	"bbox" jsonb NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"owner_device_id" uuid,
	"owner_user_id" text,
	"edit_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" text NOT NULL,
	"spec_hash" text NOT NULL,
	"device_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"elapsed_ms" integer,
	"completed_points" integer,
	"total_points" integer,
	"score" integer,
	"client_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "point_contents" ADD CONSTRAINT "point_contents_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_ts_idx" ON "analytics_events" USING btree ("name","server_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "point_contents_ref_locale_idx" ON "point_contents" USING btree ("route_id","content_ref","locale");--> statement-breakpoint
CREATE INDEX "routes_listing_idx" ON "routes" USING btree ("status","source","mode");--> statement-breakpoint
CREATE INDEX "runs_route_started_idx" ON "runs" USING btree ("route_id","started_at");