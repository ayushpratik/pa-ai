import { getProfile, saveProfile } from "@/lib/profile";
import { withUser } from "@/lib/session";
import type { ProfileFields } from "@/lib/types";

export const runtime = "nodejs";

export const GET = withUser(async (userId) => {
  return Response.json(await getProfile(userId));
});

export const PUT = withUser(async (userId, req: Request) => {
  let body: Partial<ProfileFields>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await saveProfile(userId, body);
    return Response.json(await getProfile(userId));
  } catch (error) {
    console.error("Failed to save profile", error);
    return Response.json({ error: "Could not save profile" }, { status: 500 });
  }
});
