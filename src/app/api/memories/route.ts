import { addMemory, listMemories } from "@/lib/memory";
import { withUser } from "@/lib/session";
import { MEMORY_CATEGORIES } from "@/db/schema";
import type { MemoryCategory } from "@/lib/types";

export const runtime = "nodejs";

export const GET = withUser(async (userId) => {
  return Response.json(await listMemories(userId));
});

export const POST = withUser(async (userId, req: Request) => {
  let body: { content?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return Response.json({ error: "`content` is required" }, { status: 400 });
  }

  const category = (
    MEMORY_CATEGORIES as readonly string[]
  ).includes(body.category ?? "")
    ? (body.category as MemoryCategory)
    : "context";

  const created = await addMemory(userId, content, category, "user", 100);
  if (!created) {
    return Response.json(
      { error: "That is already saved, or was empty" },
      { status: 409 },
    );
  }
  return Response.json(created, { status: 201 });
});
