import { deleteConversation, loadMessages } from "@/lib/conversations";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withUser(
  async (userId, _req: Request, { params }: RouteContext) => {
    const { id } = await params;
    try {
      return Response.json(await loadMessages(userId, id));
    } catch (error) {
      console.error("Failed to load messages", error);
      return Response.json(
        { error: "Could not load messages" },
        { status: 500 },
      );
    }
  },
);

export const DELETE = withUser(
  async (userId, _req: Request, { params }: RouteContext) => {
    const { id } = await params;
    try {
      await deleteConversation(userId, id);
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("Failed to delete conversation", error);
      return Response.json(
        { error: "Could not delete conversation" },
        { status: 500 },
      );
    }
  },
);
