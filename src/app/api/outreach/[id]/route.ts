import { updateDraftBody } from "@/lib/outreach";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

export const PATCH = withUser(
  async (
    userId,
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;

    let body: { subject?: string | null; body?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    await updateDraftBody(userId, id, body);
    return new Response(null, { status: 204 });
  },
);
