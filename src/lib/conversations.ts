import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { ConversationSummary } from "@/lib/types";

export type { ConversationSummary };

export async function listConversations(
  userId: string,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));

  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function conversationExists(
  userId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.id, id), eq(conversations.userId, userId)),
    )
    .limit(1);
  return Boolean(row);
}

export async function loadMessages(
  userId: string,
  conversationId: string,
): Promise<UIMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
    })
    .from(messages)
    // Joined rather than filtered on the id alone: messages carry no user_id,
    // so without this any signed-in user could read another's thread by
    // guessing its UUID.
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(conversations.userId, userId),
      ),
    )
    .orderBy(asc(messages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: row.parts,
  })) as UIMessage[];
}

/**
 * Creates the conversation row on first message. Titles from the opening user
 * message; a model-generated title is a later refinement.
 *
 * Returns false when the id already belongs to someone else. The client mints
 * conversation ids, so this is the check that stops a posted id from appending
 * messages to another account's thread.
 */
export async function ensureConversation(
  userId: string,
  id: string,
  firstUserMessage: UIMessage | undefined,
): Promise<boolean> {
  await db
    .insert(conversations)
    .values({
      id,
      userId,
      title: firstUserMessage ? deriveTitle(firstUserMessage) : null,
    })
    .onConflictDoNothing({ target: conversations.id });

  return await conversationExists(userId, id);
}

export async function saveMessage(
  conversationId: string,
  message: UIMessage,
): Promise<void> {
  await db
    .insert(messages)
    .values({
      id: message.id,
      conversationId,
      role: message.role,
      parts: message.parts,
    })
    // The client may retry a request; the message id makes that idempotent.
    .onConflictDoNothing({ target: messages.id });

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(
  userId: string,
  id: string,
): Promise<void> {
  // Messages are removed by the cascading foreign key.
  await db
    .delete(conversations)
    .where(
      and(eq(conversations.id, id), eq(conversations.userId, userId)),
    );
}

const TITLE_MAX_LENGTH = 60;

function deriveTitle(message: UIMessage): string {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "New chat";
  return text.length > TITLE_MAX_LENGTH
    ? `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}...`
    : text;
}
