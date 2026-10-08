CREATE TABLE "ai_contents" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"grounding" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_contents_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"kind" text NOT NULL,
	"cache_key" text,
	"locale" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"web_searches" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_generations_created_idx" ON "ai_generations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_device_created_idx" ON "ai_generations" USING btree ("device_id","created_at");