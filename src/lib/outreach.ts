import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { entities, outreach } from "@/db/schema";
import type { OutreachDraft } from "@/lib/types";

export async function createDraft(
  userId: string,
  params: {
    entityId: string;
    conversationId: string;
    channel: "email" | "linkedin";
    subject?: string | null;
    body: string;
  },
): Promise<OutreachDraft | null> {
  const [entity] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(
      and(
        eq(entities.id, params.entityId),
        eq(entities.userId, userId),
      ),
    )
    .limit(1);
  if (!entity) return null;

  const [row] = await db
    .insert(outreach)
    .values({
      userId,
      entityId: params.entityId,
      conversationId: params.conversationId,
      channel: params.channel,
      subject: params.subject ?? null,
      body: params.body,
      status: "drafted",
    })
    .returning();

  return {
    id: row.id,
    entityId: row.entityId,
    entityName: entity.name,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    status: row.status,
  };
}

export async function getDraft(userId: string, id: string) {
  const [row] = await db
    .select({
      outreach,
      entityName: entities.name,
      entityEmail: entities.email,
    })
    .from(outreach)
    .innerJoin(entities, eq(entities.id, outreach.entityId))
    .where(and(eq(outreach.id, id), eq(outreach.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function markOutreach(
  userId: string,
  id: string,
  patch: {
    status: "approved" | "sent" | "skipped" | "failed";
    error?: string | null;
    metadata?: Record<string, unknown>;
    sentAt?: Date | null;
  },
): Promise<void> {
  await db
    .update(outreach)
    .set({
      status: patch.status,
      error: patch.error ?? null,
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
      ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
    })
    .where(and(eq(outreach.id, id), eq(outreach.userId, userId)));
}

export async function updateDraftBody(
  userId: string,
  id: string,
  patch: { subject?: string | null; body?: string },
): Promise<void> {
  await db
    .update(outreach)
    .set({
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
    })
    .where(and(eq(outreach.id, id), eq(outreach.userId, userId)));
}

/** Entity ids from the given set that have already been successfully contacted. */
export async function alreadyContacted(
  userId: string,
  entityIds: string[],
  channel?: "email" | "linkedin",
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  const rows = await db
    .select({ entityId: outreach.entityId })
    .from(outreach)
    .where(
      and(
        eq(outreach.userId, userId),
        eq(outreach.status, "sent"),
        inArray(outreach.entityId, entityIds),
        ...(channel ? [eq(outreach.channel, channel)] : []),
      ),
    );

  return new Set(rows.map((row) => row.entityId));
}

export async function listDraftsForConversation(
  userId: string,
  conversationId: string,
): Promise<OutreachDraft[]> {
  const rows = await db
    .select({ outreach, entityName: entities.name })
    .from(outreach)
    .innerJoin(entities, eq(entities.id, outreach.entityId))
    .where(
      and(
        eq(outreach.userId, userId),
        eq(outreach.conversationId, conversationId),
      ),
    )
    .orderBy(desc(outreach.createdAt));

  return rows.map((row) => ({
    id: row.outreach.id,
    entityId: row.outreach.entityId,
    entityName: row.entityName,
    channel: row.outreach.channel,
    subject: row.outreach.subject,
    body: row.outreach.body,
    status: row.outreach.status,
  }));
}
