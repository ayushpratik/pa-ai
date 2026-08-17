import { listConversations } from "@/lib/conversations";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = withUser(async (userId) => {
  try {
    return Response.json(await listConversations(userId));
  } catch (error) {
    console.error("Failed to list conversations", error);
    return Response.json(
      { error: "Could not load conversations" },
      { status: 500 },
    );
  }
});
