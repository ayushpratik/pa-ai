import "server-only";
import { generateObject } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memories, MEMORY_CATEGORIES } from "@/db/schema";
import { chatModel } from "@/lib/model";
import type { MemoryCategory, MemoryItem } from "@/lib/types";

/**
 * Upper bound on how many facts are injected into the system prompt. Memory is
 * supposed to make runs cheaper, so it must not grow without limit.
 */
const PROMPT_MEMORY_LIMIT = 40;

export async function listMemories(userId: string): Promise<MemoryItem[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt));

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    category: row.category,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Cheap near-duplicate check: same words, ignoring order, casing and filler. */
function fingerprint(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .sort()
    .join(" ");
}

export async function addMemory(
  userId: string,
  content: string,
  category: MemoryCategory = "context",
  source: "auto" | "user" = "user",
  confidence = 50,
): Promise<MemoryItem | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const existing = await db
    .select({ id: memories.id, content: memories.content })
    .from(memories)
    .where(eq(memories.userId, userId));

  const incoming = fingerprint(trimmed);
  if (existing.some((row) => fingerprint(row.content) === incoming)) {
    return null;
  }

  const [row] = await db
    .insert(memories)
    .values({
      userId,
      content: trimmed,
      category,
      source,
      confidence,
    })
    .returning();

  return {
    id: row.id,
    content: row.content,
    category: row.category,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

export async function renderMemoriesForPrompt(
  userId: string,
  limit = PROMPT_MEMORY_LIMIT,
): Promise<string> {
  const rows = await db
    .select({ content: memories.content, category: memories.category })
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  if (rows.length === 0) return "";

  const lines = rows.map((row) => `- (${row.category}) ${row.content}`);
  return `## What you have learned about this user\nThese were inferred from past runs. Treat them as defaults the user can override, not as rules.\n${lines.join("\n")}`;
}

const extractionSchema = z.object({
  facts: z
    .array(
      z.object({
        content: z
          .string()
          .describe("One durable fact, written as a standalone sentence."),
        category: z.enum(MEMORY_CATEGORIES),
        confidence: z.number().min(0).max(100),
      }),
    )
    .max(5),
});

/**
 * Extracts durable preferences from the tail of a conversation.
 *
 * Runs on the same cheap model as chat, and only after turns that actually did
 * something (tool calls or a plan approval) — running it on every message would
 * roughly double the token cost of small talk for almost no signal.
 */
export async function extractMemories(
  userId: string,
  transcript: string,
): Promise<number> {
  if (transcript.trim().length < 80) return 0;

  try {
    const { object } = await generateObject({
      model: chatModel(),
      schema: extractionSchema,
      system: `Extract only durable facts about this user that would change how you help them NEXT time.

Good: "Prefers outreach emails under 4 sentences", "Runs an agency placing startup founders with investors", "Excludes corporate VCs from investor searches".
Bad: anything about this specific request, names of individual prospects, one-off instructions, or restating what a tool returned.

Return an empty array when nothing durable was revealed. That is the common case and is always acceptable.`,
      prompt: transcript.slice(-6000),
    });

    let saved = 0;
    for (const fact of object.facts) {
      if (fact.confidence < 55) continue;
      const created = await addMemory(
        userId,
        fact.content,
        fact.category,
        "auto",
        Math.round(fact.confidence),
      );
      if (created) saved += 1;
    }
    return saved;
  } catch (error) {
    // Memory extraction is best-effort; never fail the chat response over it.
    console.error("Memory extraction failed", error);
    return 0;
  }
}
