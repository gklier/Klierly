import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, pgTable, uuid, text, timestamp, integer, boolean, jsonb, real, date, index, uniqueIndex, primaryKey, customType,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(), // Legacy data only. Password authentication is disabled.
  isAdmin: boolean("is_admin").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  reauthScope: text("reauth_scope"),
  reauthExpiresAt: timestamp("reauth_expires_at", { withTimezone: true }),
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const extensionTokens = pgTable("extension_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  createdAt: createdAt(),
});

export const courses = pgTable("courses", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  term: text("term"),
  goal: text("goal"),
  examDate: date("exam_date"), // tentative, user-entered
  allowExternalAi: boolean("allow_external_ai").notNull().default(true),
  integrityNote: text("integrity_note"),
  isSample: boolean("is_sample").notNull().default(false),
  /** The class (LMS course) this course is linked to, if the student linked it with the extension. */
  classId: uuid("class_id").references((): AnyPgColumn => classSpaces.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("courses_user_idx").on(t.userId)]);

export const modules = pgTable("modules", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("modules_course_idx").on(t.courseId)]);

export const sourceDocuments = pgTable("source_documents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
  /** Module number the document itself names, when it names exactly one ("Module 2: …"). */
  moduleHint: integer("module_hint"),
  title: text("title").notNull(),
  kind: text("kind").$type<"file" | "paste" | "web">().notNull(),
  filename: text("filename").notNull(),
  mime: text("mime"),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  originUrl: text("origin_url"),
  /** Stable id of the resource in the system it came from, e.g. "canvas:<host>:<course>:page:<id>". Used for sync. */
  externalId: text("external_id"),
  /** The source system's own last-modified stamp, as reported at import time. */
  externalUpdatedAt: text("external_updated_at"),
  status: text("status").$type<"queued" | "processing" | "ready" | "failed">().notNull().default("queued"),
  parser: text("parser"),
  parserConfidence: real("parser_confidence"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  error: text("error"),
  charCount: integer("char_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  permissionDeclaredAt: timestamp("permission_declared_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("docs_course_idx").on(t.courseId),
  uniqueIndex("docs_course_sha_uq").on(t.courseId, t.sha256),
  index("docs_external_idx").on(t.courseId, t.externalId),
]);

export const sourceChunks = pgTable("source_chunks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => sourceDocuments.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").$type<"text" | "table">().notNull().default("text"),
  text: text("text").notNull(),
  heading: text("heading"),
  page: integer("page"),
  slide: integer("slide"),
  tStartMs: integer("t_start_ms"),
  tEndMs: integer("t_end_ms"),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(
    sql`setweight(to_tsvector('english', coalesce(heading, '')), 'A') || setweight(to_tsvector('english', text), 'B')`,
  ),
}, (t) => [
  index("chunks_doc_idx").on(t.documentId, t.ordinal),
  index("chunks_course_idx").on(t.courseId),
  index("chunks_tsv_idx").using("gin", t.tsv),
]);

export type JobLogEntry = { at: string; msg: string };

export const importJobs = pgTable("import_jobs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => sourceDocuments.id, { onDelete: "cascade" }),
  status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  log: jsonb("log").$type<JobLogEntry[]>().notNull().default([]),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("jobs_status_idx").on(t.status, t.runAfter)]);

export type ProposalPayload =
  | { kind: "module"; name: string; number?: number }
  | { kind: "topic"; name: string; documentId?: string; via?: "ai" | "objective"; detail?: string }
  | { kind: "format"; label: string; examKey: string | null; questionCount?: number; minutes?: number; points?: number; types?: string[] }
  | { kind: "objective"; text: string; moduleNumber?: number }
  | { kind: "date"; label: string; date: string; dateKind: "exam" | "deadline"; modulesCovered?: number[]; yearAssumed?: boolean };

export const proposals = pgTable("proposals", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ProposalPayload["kind"]>().notNull(),
  payload: jsonb("payload").$type<ProposalPayload>().notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  evidenceChunkId: uuid("evidence_chunk_id").references(() => sourceChunks.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "accepted" | "dismissed">().notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("proposals_dedupe_uq").on(t.courseId, t.kind, t.dedupeKey)]);

export const topics = pgTable("topics", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  origin: text("origin").$type<"materials" | "manual" | "sample">().notNull().default("manual"),
  evidenceChunkId: uuid("evidence_chunk_id").references(() => sourceChunks.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("topics_course_idx").on(t.courseId)]);

export const learningObjectives = pgTable("learning_objectives", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  evidenceChunkId: uuid("evidence_chunk_id").references(() => sourceChunks.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("objectives_course_idx").on(t.courseId)]);

export const courseDates = pgTable("course_dates", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  date: date("date").notNull(),
  dateKind: text("date_kind").$type<"exam" | "deadline">().notNull(),
  modulesCovered: jsonb("modules_covered").$type<number[]>(),
  evidenceChunkId: uuid("evidence_chunk_id").references(() => sourceChunks.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("dates_course_idx").on(t.courseId)]);

export type ExamFormat = { confirmed: boolean; questionCount?: number; minutes?: number; notes?: string };

export const examPlans = pgTable("exam_plans", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  examDate: date("exam_date").notNull(),
  moduleIds: jsonb("module_ids").$type<string[]>().notNull().default([]),
  desiredGrade: text("desired_grade"),
  minutesPerDay: integer("minutes_per_day").notNull(),
  presentationMode: text("presentation_mode").$type<"practice-first" | "concise-reading" | "diagrams">().notNull().default("practice-first"),
  strengths: jsonb("strengths").$type<Record<string, number>>().notNull().default({}),
  examFormat: jsonb("exam_format").$type<ExamFormat>().notNull().default({ confirmed: false }),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("plans_course_uq").on(t.courseId)]);

export type PlanSessionKind = "learn" | "drill" | "mixed" | "review" | "mock" | "wrap";

export const planSessions = pgTable("plan_sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => examPlans.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  kind: text("kind").$type<PlanSessionKind>().notNull(),
  title: text("title").notNull(),
  topicIds: jsonb("topic_ids").$type<string[]>().notNull().default([]),
  minutes: integer("minutes").notNull(),
  status: text("status").$type<"planned" | "done" | "skipped">().notNull().default("planned"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("plan_sessions_plan_idx").on(t.planId, t.date)]);

export type Citation = { chunkId: string; documentId: string; quote: string; quoteVerified: boolean };
export type NumericCheck = { fn: string; args: Record<string, unknown> };

export const questions = pgTable("questions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  type: text("type").$type<"mcq" | "numeric">().notNull(),
  stem: text("stem").notNull(),
  choices: jsonb("choices").$type<string[]>(),
  correctIndex: integer("correct_index"),
  numericValue: text("numeric_value"), // stored as text to keep full double precision
  tolerance: text("tolerance"),
  unit: text("unit"),
  hint: text("hint"),
  explanation: text("explanation").notNull(),
  citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
  grounding: text("grounding").$type<"direct" | "extrapolated">().notNull().default("direct"),
  correctnessConfidence: text("correctness_confidence").$type<"verified-numeric" | "author-reviewed" | "model-asserted">().notNull(),
  explanationConfidence: text("explanation_confidence").$type<"quote-verified" | "source-linked" | "author-reviewed">().notNull(),
  check: jsonb("check").$type<NumericCheck>(),
  difficulty: integer("difficulty").notNull().default(2),
  origin: text("origin").$type<"ai" | "sample">().notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").$type<"active" | "reported">().notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [index("questions_course_idx").on(t.courseId, t.status), index("questions_topic_idx").on(t.topicId)]);

export const questionReports = pgTable("question_reports", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const practiceSessions = pgTable("practice_sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  mode: text("mode").$type<"drill" | "exam" | "review">().notNull(),
  status: text("status").$type<"active" | "submitted">().notNull().default("active"),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  timeLimitSec: integer("time_limit_sec"),
  planSessionId: uuid("plan_session_id").references(() => planSessions.id, { onDelete: "set null" }),
  correctCount: integer("correct_count"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
}, (t) => [index("psessions_course_idx").on(t.courseId, t.startedAt)]);

export type AnswerResponse = { choice?: number; value?: string };
export const ERROR_REASONS = ["knowledge-gap", "calculation-error", "incorrect-setup", "interpretation", "careless-error"] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number];

export const answers = pgTable("answers", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => practiceSessions.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  response: jsonb("response").$type<AnswerResponse>().notNull(),
  isCorrect: boolean("is_correct"), // null until graded (timed exam before submission)
  timeMs: integer("time_ms").notNull().default(0),
  hintUsed: boolean("hint_used").notNull().default(false),
  errorReason: text("error_reason").$type<ErrorReason>(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("answers_session_question_uq").on(t.sessionId, t.questionId),
  index("answers_course_idx").on(t.courseId, t.createdAt),
]);

export const topicMastery = pgTable("topic_mastery", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  score: real("score").notNull(),
  attempts: integer("attempts").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  intervalDays: integer("interval_days").notNull().default(1),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.topicId] })]);

export const providerSettings = pgTable("provider_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  preset: text("preset").$type<"openai-compatible" | "navigator-experimental" | "google-ai-studio">().notNull().default("openai-compatible"),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(),
  keyHint: text("key_hint").notNull(),
  dailyRequestLimit: integer("daily_request_limit").notNull().default(60),
  disclosureAckAt: timestamp("disclosure_ack_at", { withTimezone: true }).notNull(),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiUsage = pgTable("ai_usage", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  /** "managed" = Klierly's own provider (counts against the free quota); "byok" = the user's key. */
  provider: text("provider").$type<"managed" | "byok">().notNull().default("byok"),
  tier: text("tier").$type<"routine" | "strong">().notNull().default("routine"),
  /** Estimated cost in millionths of a US dollar, from configured prices (managed provider only). */
  costMicroUsd: integer("cost_micro_usd").notNull().default(0),
  cached: boolean("cached").notNull().default(false),
  ok: boolean("ok").notNull(),
  createdAt: createdAt(),
}, (t) => [index("usage_user_idx").on(t.userId, t.createdAt)]);

export const aiCache = pgTable("ai_cache", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  response: jsonb("response").notNull(),
  createdAt: createdAt(),
});

export type LearnNoteBody = {
  summary: string;
  keyPoints: { text: string; citations: Citation[] }[];
};

export const learnNotes = pgTable("learn_notes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  body: jsonb("body").$type<LearnNoteBody>().notNull(),
  origin: text("origin").$type<"ai" | "sample">().notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("learn_notes_topic_uq").on(t.topicId)]);

/** Exam structure found in the student's own materials (usually the syllabus). Never assumed; the student confirms it in the study plan. */
export const examFormats = pgTable("exam_formats", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  /** "exam 1", "midterm", "final"; null when the text describes exams in general. */
  examKey: text("exam_key"),
  label: text("label").notNull(),
  questionCount: integer("question_count"),
  minutes: integer("minutes"),
  points: integer("points"),
  types: jsonb("types").$type<string[]>().notNull().default([]),
  evidenceChunkId: uuid("evidence_chunk_id").references(() => sourceChunks.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("exam_formats_course_idx").on(t.courseId)]);

export type SupplementBody = { covered: string; gaps: { point: string; explanation: string }[]; verify: string[] };

/** AI-written explanation of what a topic's notes leave out. General knowledge, NOT from the course: always shown labelled as such. */
export const learnSupplements = pgTable("learn_supplements", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  body: jsonb("body").$type<SupplementBody>().notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("learn_supplements_topic_uq").on(t.topicId)]);

/**
 * What the account holder did and what the system did on their behalf: events, counts and the titles of
 * sources and topics. Never document text, prompts, answers, passwords or keys. Kept for the account (deleted with it);
 * course_id has no foreign key on purpose so history survives deleting a course.
 */
export const activityLog = pgTable("activity_log", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").$type<"web" | "extension" | "server">().notNull().default("server"),
  event: text("event").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("activity_user_at_idx").on(t.userId, t.at)]);

/** A class: one course shell in an LMS (for example Canvas course 123456 on a given host). */
export const classSpaces = pgTable("class_spaces", {
  id: id(),
  lms: text("lms").notNull(),
  host: text("host").notNull(),
  externalCourseId: text("external_course_id").notNull(),
  label: text("label").notNull(),
  /** Operator switch: turn sharing off for a class (for example when an instructor asks). */
  sharingEnabled: boolean("sharing_enabled").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("class_spaces_ident_uq").on(t.lms, t.host, t.externalCourseId)]);

/**
 * Who has linked their course to a class. Membership is claimed through the extension while the student has the
 * LMS course open. It is NOT verified with the LMS (no LMS API is used), so it is an honour system with friction,
 * and everything shared must be safe to be seen by someone who is not really enrolled.
 */
export const classMembers = pgTable("class_members", {
  approved: boolean("approved").notNull().default(false),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classSpaces.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.classId] })]);

export type SummaryBody = { overview: string; points: { text: string; where: string | null }[] };

/** A student's private AI summary of one of their sources, in their own words. */
export const sourceSummaries = pgTable("source_summaries", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => sourceDocuments.id, { onDelete: "cascade" }),
  body: jsonb("body").$type<SummaryBody>().notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("source_summaries_doc_uq").on(t.documentId)]);

/** A summary a student chose to share with their class: a copy, with no source text, quotes or file names. */
export const sharedItems = pgTable("shared_items", {
  id: id(),
  classId: uuid("class_id").notNull().references(() => classSpaces.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceSummaryId: uuid("source_summary_id").references(() => sourceSummaries.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  moduleName: text("module_name"),
  body: jsonb("body").$type<SummaryBody>().notNull(),
  aiGenerated: boolean("ai_generated").notNull().default(true),
  termsVersion: text("terms_version").notNull(),
  /** hidden = taken down automatically after reports, or by the operator, pending review. */
  status: text("status").$type<"active" | "hidden">().notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [index("shared_items_class_idx").on(t.classId, t.status)]);

export const sharedReports = pgTable("shared_reports", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => sharedItems.id, { onDelete: "cascade" }),
  reporterUserId: uuid("reporter_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("shared_reports_once_uq").on(t.itemId, t.reporterUserId)]);
