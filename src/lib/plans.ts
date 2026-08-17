import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import type { PlanStatus, PlanStep, PlanSummary } from "@/lib/types";

function toSummary(row: typeof plans.$inferSelect): PlanSummary {
  return {
    id: row.id,
    goal: row.goal,
    steps: row.steps,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createPlan(
  userId: string,
  conversationId: string,
  goal: string,
  steps: PlanStep[],
): Promise<PlanSummary> {
  const [row] = await db
    .insert(plans)
    .values({ userId, conversationId, goal, steps })
    .returning();
  return toSummary(row);
}

/**
 * Sets a plan's status. Only the user-facing route calls this with "approved";
 * the model goes through `setPlanStatusAsModel`.
 */
export async function setPlanStatus(
  userId: string,
  id: string,
  status: PlanStatus,
): Promise<PlanSummary | null> {
  const [row] = await db
    .update(plans)
    .set({
      status,
      ...(status === "approved" ? { approvedAt: new Date() } : {}),
    })
    .where(and(eq(plans.id, id), eq(plans.userId, userId)))
    .returning();
  return row ? toSummary(row) : null;
}

/**
 * The transition the model is allowed to make.
 *
 * "running" is treated as an active, approved state by `findActiveApprovedPlan`,
 * so without this check a model could approve its own plan by marking it running.
 * Only a plan the user has actually approved may start.
 */
export async function setPlanStatusAsModel(
  userId: string,
  id: string,
  status: "running" | "done" | "blocked" | "cancelled",
): Promise<PlanSummary | { error: string }> {
  const plan = await getPlan(userId, id);
  if (!plan) return { error: "No such plan." };

  if (status === "running" && plan.status !== "approved" && plan.status !== "running") {
    return {
      error: `This plan is "${plan.status}", not approved. Wait for the user to approve it before starting.`,
    };
  }

  const updated = await setPlanStatus(userId, id, status);
  return updated ?? { error: "No such plan." };
}

export async function getPlan(
  userId: string,
  id: string,
): Promise<PlanSummary | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.userId, userId)))
    .limit(1);
  return row ? toSummary(row) : null;
}

/**
 * The server-side approval gate.
 *
 * Tools that spend money or contact a person call this first. Approval is a row
 * in the database, so a model that decides to skip the plan card cannot talk its
 * way past it.
 */
export async function findActiveApprovedPlan(
  userId: string,
  conversationId: string,
): Promise<PlanSummary | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.conversationId, conversationId),
        eq(plans.userId, userId),
      ),
    )
    .orderBy(desc(plans.createdAt))
    .limit(1);

  if (!row) return null;
  const active: PlanStatus[] = ["approved", "running"];
  return active.includes(row.status) ? toSummary(row) : null;
}
