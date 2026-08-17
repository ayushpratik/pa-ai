import { z } from "zod";
import { createSession, hashPassword } from "@/lib/auth";
import { createUser, findUserByEmail } from "@/lib/accounts";

export const runtime = "nodejs";

const schema = z.object({
  email: z.email(),
  // Length is the only rule worth enforcing; composition rules push users to
  // predictable substitutions without adding real entropy.
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = schema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid details" },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  try {
    if (await findUserByEmail(email)) {
      return Response.json(
        { error: "An account with that email already exists. Sign in instead." },
        { status: 409 },
      );
    }

    const user = await createUser({
      email,
      passwordHash: await hashPassword(password),
      name: name || null,
    });
    await createSession(user.id);

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Sign-up failed", error);
    return Response.json(
      { error: "Could not create the account. Is Postgres running?" },
      { status: 500 },
    );
  }
}
