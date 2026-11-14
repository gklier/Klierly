CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'server' NOT NULL,
	"event" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"exam_key" text,
	"label" text NOT NULL,
	"question_count" integer,
	"minutes" integer,
	"points" integer,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn_supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_formats" ADD CONSTRAINT "exam_formats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_formats" ADD CONSTRAINT "exam_formats_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_formats" ADD CONSTRAINT "exam_formats_evidence_chunk_id_source_chunks_id_fk" FOREIGN KEY ("evidence_chunk_id") REFERENCES "public"."source_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn_supplements" ADD CONSTRAINT "learn_supplements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn_supplements" ADD CONSTRAINT "learn_supplements_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn_supplements" ADD CONSTRAINT "learn_supplements_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_at_idx" ON "activity_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "exam_formats_course_idx" ON "exam_formats" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learn_supplements_topic_uq" ON "learn_supplements" USING btree ("topic_id");