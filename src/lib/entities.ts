import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  entityListItems,
  entityLists,
  outreach,
} from "@/db/schema";
import type { EntitySummary } from "@/lib/types";

export type EntityInput = {
  type: string;
  name: string;
  organization?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  attributes?: Record<string, unknown>;
  source?: string | null;
  sourceUrl?: string | null;
};

function toSummary(row: typeof entities.$inferSelect): EntitySummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    organization: row.organization,
    email: row.email,
    linkedinUrl: row.linkedinUrl,
    attributes: row.attributes,
    sourceUrl: row.sourceUrl,
  };
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Saves records, matching an existing row on whichever identifier is present:
 * email, then LinkedIn URL, then name + organisation.
 *
 * Done as an explicit lookup rather than ON CONFLICT because the identifier
 * varies per row. The partial unique indexes on the table remain the backstop.
 */
export async function saveEntities(
  userId: string,
  input: EntityInput[],
): Promise<EntitySummary[]> {
  const saved: EntitySummary[] = [];

  for (const item of input) {
    const email = normalize(item.email);
    const linkedinUrl = normalize(item.linkedinUrl);
    const values = {
      userId,
      type: item.type.trim() || "person",
      name: item.name.trim(),
      organization: item.organization?.trim() || null,
      email,
      linkedinUrl,
      attributes: item.attributes ?? {},
      source: item.source ?? null,
      sourceUrl: item.sourceUrl ?? null,
      updatedAt: new Date(),
    };
    if (!values.name) continue;

    const match = email
      ? eq(entities.email, email)
      : linkedinUrl
        ? eq(entities.linkedinUrl, linkedinUrl)
        : and(
            eq(entities.name, values.name),
            values.organization
              ? eq(entities.organization, values.organization)
              : sql`${entities.organization} is null`,
          );

    const [existing] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.userId, userId), match))
      .limit(1);

    let row: typeof entities.$inferSelect | undefined;

    if (existing) {
      // Merge rather than replace, so an enrichment pass does not discard what
      // the original search found.
      [row] = await db
        .update(entities)
        .set({
          organization: values.organization ?? existing.organization,
          email: values.email ?? existing.email,
          linkedinUrl: values.linkedinUrl ?? existing.linkedinUrl,
          attributes: { ...existing.attributes, ...values.attributes },
          sourceUrl: values.sourceUrl ?? existing.sourceUrl,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, existing.id))
        .returning();
    } else {
      [row] = await db.insert(entities).values(values).returning();
    }

    if (row) saved.push(toSummary(row));
  }

  return await annotateContacted(userId, saved);
}

/** Marks anyone who already has a sent outreach record, on any channel. */
export async function annotateContacted(
  userId: string,
  items: EntitySummary[],
): Promise<EntitySummary[]> {
  if (items.length === 0) return items;

  const rows = await db
    .select({ entityId: outreach.entityId })
    .from(outreach)
    .where(
      and(
        eq(outreach.userId, userId),
        eq(outreach.status, "sent"),
        inArray(
          outreach.entityId,
          items.map((item) => item.id),
        ),
      ),
    );

  const contacted = new Set(rows.map((row) => row.entityId));
  return items.map((item) => ({ ...item, contacted: contacted.has(item.id) }));
}

export async function listEntities(
  userId: string,
  options: { type?: string; limit?: number },
): Promise<EntitySummary[]> {
  const rows = await db
    .select()
    .from(entities)
    .where(
      options.type
        ? and(
            eq(entities.userId, userId),
            eq(entities.type, options.type),
          )
        : eq(entities.userId, userId),
    )
    .orderBy(desc(entities.updatedAt))
    .limit(options.limit ?? 25);

  return await annotateContacted(userId, rows.map(toSummary));
}

export async function getEntities(
  userId: string,
  ids: string[],
): Promise<EntitySummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, ids)));
  return rows.map(toSummary);
}

export async function updateEntityContact(
  userId: string,
  id: string,
  patch: { email?: string | null; linkedinUrl?: string | null; attributes?: Record<string, unknown> },
): Promise<EntitySummary | null> {
  const [existing] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, id), eq(entities.userId, userId)))
    .limit(1);
  if (!existing) return null;

  const [row] = await db
    .update(entities)
    .set({
      email: normalize(patch.email) ?? existing.email,
      linkedinUrl: normalize(patch.linkedinUrl) ?? existing.linkedinUrl,
      attributes: { ...existing.attributes, ...(patch.attributes ?? {}) },
      updatedAt: new Date(),
    })
    .where(eq(entities.id, id))
    .returning();

  return row ? toSummary(row) : null;
}

/** Names a result set so a later conversation can refer back to it. */
export async function createEntityList(
  userId: string,
  name: string,
  conversationId: string,
  entityIds: string[],
): Promise<string> {
  const [list] = await db
    .insert(entityLists)
    .values({ userId, conversationId, name })
    .returning();

  if (entityIds.length > 0) {
    await db
      .insert(entityListItems)
      .values(
        entityIds.map((entityId, index) => ({
          listId: list.id,
          entityId,
          rank: index + 1,
        })),
      )
      .onConflictDoNothing();
  }

  return list.id;
}
