import { pgTable, text, uuid, timestamp, bigint, jsonb, integer } from "drizzle-orm/pg-core";
import { users } from "./schema";
import type { AuthenticatorTransport } from "@simplewebauthn/server";

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<AuthenticatorTransport[]>().notNull().default([]),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const accountInvitations = pgTable("account_invitations", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").$type<"login" | "enroll" | "add" | "stepup">().notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  invitationId: text("invitation_id"),
  sessionId: text("session_id"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const securityLimits = pgTable("security_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
