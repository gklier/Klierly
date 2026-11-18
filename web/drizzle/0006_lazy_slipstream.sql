ALTER TABLE "sessions" ADD COLUMN "reauth_scope" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauth_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "scope" text;