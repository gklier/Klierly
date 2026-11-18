CREATE TABLE "class_members" (
	"user_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_members_user_id_class_id_pk" PRIMARY KEY("user_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "class_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lms" text NOT NULL,
	"host" text NOT NULL,
	"external_course_id" text NOT NULL,
	"label" text NOT NULL,
	"sharing_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"source_summary_id" uuid,
	"title" text NOT NULL,
	"module_name" text,
	"body" jsonb NOT NULL,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"terms_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "class_id" uuid;--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_class_id_class_spaces_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_items" ADD CONSTRAINT "shared_items_class_id_class_spaces_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_items" ADD CONSTRAINT "shared_items_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_items" ADD CONSTRAINT "shared_items_source_summary_id_source_summaries_id_fk" FOREIGN KEY ("source_summary_id") REFERENCES "public"."source_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_reports" ADD CONSTRAINT "shared_reports_item_id_shared_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shared_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_reports" ADD CONSTRAINT "shared_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_summaries" ADD CONSTRAINT "source_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_summaries" ADD CONSTRAINT "source_summaries_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_summaries" ADD CONSTRAINT "source_summaries_document_id_source_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_spaces_ident_uq" ON "class_spaces" USING btree ("lms","host","external_course_id");--> statement-breakpoint
CREATE INDEX "shared_items_class_idx" ON "shared_items" USING btree ("class_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_reports_once_uq" ON "shared_reports" USING btree ("item_id","reporter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_summaries_doc_uq" ON "source_summaries" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_class_id_class_spaces_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class_spaces"("id") ON DELETE set null ON UPDATE no action;