CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"data" bytea NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"route_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unused_since" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_unused_idx" ON "media" USING btree (coalesce("unused_since", "created_at")) WHERE "media"."route_id" is null;--> statement-breakpoint
CREATE INDEX "media_device_created_idx" ON "media" USING btree ("device_id","created_at");