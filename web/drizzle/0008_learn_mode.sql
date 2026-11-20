CREATE TABLE "lm_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"ok" boolean NOT NULL,
	"hinted" boolean NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lm_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_ids" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"analysis" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lm_concept_state" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lm_concept_state_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "lm_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes" integer DEFAULT 10 NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"short" text DEFAULT '' NOT NULL,
	"alt_explanation" text DEFAULT '' NOT NULL,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formulas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructor_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"input_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lm_generators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"difficulty" integer DEFAULT 2 NOT NULL,
	"spec" jsonb NOT NULL,
	"solver_code" text,
	"solver_hash" text,
	"validated_at" timestamp with time zone,
	"validation_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lm_items" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"generator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stem_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lm_progress" (
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"cursor" jsonb,
	"miss" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seen_stems" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"correct_unaided" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lm_progress_user_id_course_id_pk" PRIMARY KEY("user_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "lm_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lm_answers" ADD CONSTRAINT "lm_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_answers" ADD CONSTRAINT "lm_answers_concept_id_lm_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."lm_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_builds" ADD CONSTRAINT "lm_builds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_builds" ADD CONSTRAINT "lm_builds_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_concept_state" ADD CONSTRAINT "lm_concept_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_concept_state" ADD CONSTRAINT "lm_concept_state_concept_id_lm_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."lm_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_concepts" ADD CONSTRAINT "lm_concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_concepts" ADD CONSTRAINT "lm_concepts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_concepts" ADD CONSTRAINT "lm_concepts_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_generators" ADD CONSTRAINT "lm_generators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_generators" ADD CONSTRAINT "lm_generators_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_generators" ADD CONSTRAINT "lm_generators_concept_id_lm_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."lm_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_items" ADD CONSTRAINT "lm_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_items" ADD CONSTRAINT "lm_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_items" ADD CONSTRAINT "lm_items_concept_id_lm_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."lm_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_items" ADD CONSTRAINT "lm_items_generator_id_lm_generators_id_fk" FOREIGN KEY ("generator_id") REFERENCES "public"."lm_generators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_progress" ADD CONSTRAINT "lm_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_progress" ADD CONSTRAINT "lm_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lm_reports" ADD CONSTRAINT "lm_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lm_answers_user_idx" ON "lm_answers" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "lm_builds_course_idx" ON "lm_builds" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lm_concepts_slug_uq" ON "lm_concepts" USING btree ("course_id","slug");--> statement-breakpoint
CREATE INDEX "lm_concepts_course_idx" ON "lm_concepts" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "lm_generators_concept_idx" ON "lm_generators" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lm_items_stem_uq" ON "lm_items" USING btree ("course_id","stem_hash");--> statement-breakpoint
CREATE INDEX "lm_items_concept_idx" ON "lm_items" USING btree ("concept_id","retired");