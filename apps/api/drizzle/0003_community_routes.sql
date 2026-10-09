CREATE TABLE "route_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "moderation" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
-- Curated routes are public; every user route stays private until its owner publishes it.
UPDATE "routes" SET "visibility" = 'public' WHERE "source" = 'curated';--> statement-breakpoint
ALTER TABLE "route_reports" ADD CONSTRAINT "route_reports_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_reports_route_idx" ON "route_reports" USING btree ("route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_reports_open_idx" ON "route_reports" USING btree ("route_id","device_id") WHERE "route_reports"."resolved_at" is null;