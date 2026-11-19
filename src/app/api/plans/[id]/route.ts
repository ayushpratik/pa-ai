import { getPlan, resolveProposedPlan } from "@/lib/plans";
import { withUser } from "@/lib/session";
import type { PlanStatus } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// Only the transitions the plan card offers. The model changes status through
// its own tool; this route exists for the user's Approve / Cancel buttons.
const USER_TRANSITIONS: PlanStatus[] = ["approved", "cancelled"];

export const GET = withUser(
  async (userId, _req: Request, { params }: RouteContext) => {
    const { id } = await params;
    const plan = await getPlan(userId, id);
    if (!plan) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(plan);
  },
);

export const PATCH = withUser(
  async (userId, req: Request, { params }: RouteContext) => {
    const { id } = await params;

    let body: { status?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!USER_TRANSITIONS.includes(body.status as PlanStatus)) {
      return Response.json(
        { error: `status must be one of: ${USER_TRANSITIONS.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await resolveProposedPlan(
      userId,
      id,
      body.status as "approved" | "cancelled",
    );
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    if ("already" in result) {
      return Response.json(
        { error: "This plan was already acted on.", plan: result.already },
        { status: 409 },
      );
    }
    return Response.json(result.plan);
  },
);
