import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type { PlanStep } from "@/lib/types";

/**
 * An account. `passwordHash` is null for accounts created through Google, which
 * have no password to verify — the sign-in path must treat that as "wrong
 * credentials" rather than as an empty password.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    name: text("name"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Case-insensitive: "A@b.com" and "a@b.com" are the same account.
    uniqueIndex("users_email_idx").on(sql`lower(${table.email})`),
  ],
);

/**
 * Opaque, database-backed sessions rather than JWTs, so signing out and
 * revoking are a DELETE rather than a blocklist. Only the hash of the token is
 * stored: a database leak does not hand over live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt.desc(),
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    // Text, not uuid: these ids come from the AI SDK client, which generates
    // nanoid-style values rather than UUIDs.
    id: text("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    // Stored as the AI SDK parts array rather than a flat string, so tool calls
    // and reasoning blocks persist without a schema migration later.
    parts: jsonb("parts")
      .$type<UIMessagePart<UIDataTypes, UITools>[]>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

/**
 * The permanent, domain-agnostic facts about the user. Deliberately thin: only
 * fields that are true no matter what the user asks the assistant to do. Domain
 * specifics (ICP, cheque sizes, what a good match looks like) belong in
 * `memories`, not here, because the same user may use this tool for work that
 * has nothing to do with sales.
 */
export const userProfile = pgTable("user_profile", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name"),
  role: text("role"),
  company: text("company"),
  location: text("location"),
  timezone: text("timezone"),
  sendingEmail: text("sending_email"),
  emailSignature: text("email_signature"),
  calendarLink: text("calendar_link"),
  writingTone: text("writing_tone"),
  about: text("about"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const MEMORY_CATEGORIES = [
  "preference",
  "context",
  "constraint",
  "outcome",
] as const;

/**
 * One durable fact per row. Written both by the user (settings page) and by the
 * automatic extraction pass after a run. Kept as free text rather than typed
 * columns so it stays useful across unrelated domains.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    content: text("content").notNull(),
    category: text("category", { enum: MEMORY_CATEGORIES })
      .notNull()
      .default("context"),
    source: text("source", { enum: ["auto", "user"] }).notNull().default("auto"),
    confidence: integer("confidence").notNull().default(50),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("memories_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/**
 * The generic record of a person or organisation the assistant found. `type` is
 * free text and `attributes` is jsonb precisely so an investor, a supplier and a
 * prospective groom can all live here without a migration.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    organization: text("organization"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text("source"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("entities_user_type_idx").on(table.userId, table.type),
    index("entities_attributes_idx").using("gin", table.attributes),
    // Partial uniques: re-running the same search updates rather than duplicates,
    // but rows without an identifier are still allowed.
    uniqueIndex("entities_user_email_idx")
      .on(table.userId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    uniqueIndex("entities_user_linkedin_idx")
      .on(table.userId, sql`lower(${table.linkedinUrl})`)
      .where(sql`${table.linkedinUrl} is not null`),
  ],
);

/** A named result set produced by one run, e.g. "EV investors, Bangalore". */
export const entityLists = pgTable(
  "entity_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("entity_lists_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);

export const entityListItems = pgTable(
  "entity_list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => entityLists.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    rank: integer("rank"),
  },
  (table) => [
    primaryKey({ columns: [table.listId, table.entityId] }),
    index("entity_list_items_entity_idx").on(table.entityId),
  ],
);

export const OUTREACH_STATUSES = [
  "drafted",
  "approved",
  "sent",
  "skipped",
  "failed",
] as const;

/**
 * One attempted contact per row. This is what lets the assistant answer "have I
 * already reached out to this person?" across conversations.
 */
export const outreach = pgTable(
  "outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    channel: text("channel", { enum: ["email", "linkedin"] }).notNull(),
    status: text("status", { enum: OUTREACH_STATUSES })
      .notNull()
      .default("drafted"),
    subject: text("subject"),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("outreach_user_entity_idx").on(table.userId, table.entityId),
    index("outreach_status_idx").on(table.userId, table.status),
  ],
);

export const PLAN_STATUSES = [
  "proposed",
  "approved",
  "running",
  "done",
  "cancelled",
  "blocked",
] as const;

/**
 * The approval record. Tools with a real-world cost check for an approved plan
 * on the conversation before doing anything, so approval is enforced server-side
 * rather than by the model's good behaviour.
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    steps: jsonb("steps").$type<PlanStep[]>().notNull(),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    index("plans_conversation_created_idx").on(
      table.conversationId,
      table.createdAt.desc(),
    ),
  ],
);

/**
 * OAuth identities and tokens. Two distinct providers live here:
 * "google" is the gmail.send connection used for outbound mail, and
 * "google-login" is the sign-in identity, which carries no send scope.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    accountEmail: text("account_email"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revoked: boolean("revoked").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider] }),
    // Resolving a returning Google user goes provider + email -> userId, which
    // is the opposite direction from the primary key.
    index("oauth_accounts_provider_email_idx").on(
      table.provider,
      table.accountEmail,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type UserProfile = typeof userProfile.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityList = typeof entityLists.$inferSelect;
export type Outreach = typeof outreach.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
