ALTER TABLE "ai_usage" ADD COLUMN "provider" text DEFAULT 'byok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "tier" text DEFAULT 'routine' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cost_micro_usd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "external_updated_at" text;--> statement-breakpoint
CREATE INDEX "docs_external_idx" ON "source_documents" USING btree ("course_id","external_id");