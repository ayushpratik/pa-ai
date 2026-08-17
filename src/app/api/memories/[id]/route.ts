import { deleteMemory } from "@/lib/memory";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

export const DELETE = withUser(
  async (
    userId,
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    await deleteMemory(userId, id);
    return new Response(null, { status: 204 });
  },
);
