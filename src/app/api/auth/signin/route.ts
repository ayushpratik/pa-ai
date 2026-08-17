import { z } from "zod";
import {
  createSession,
  dummyPasswordHash,
  verifyPassword,
} from "@/lib/auth";
import { findUserByEmail } from "@/lib/accounts";

export const runtime = "nodejs";

const schema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// One message for every failure. Distinguishing "no such account" from "wrong
// password" turns this endpoint into a way to test which addresses are
// registered.
const GENERIC_ERROR = "Invalid email or password.";

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = schema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.success) {
    return Response.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const { email, password } = parsed.data;

  try {
    const user = await findUserByEmail(email);

    // Hash against a throwaway value when the account does not exist, so an
    // unknown email costs the same time as a wrong password.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, await dummyPasswordHash());

    if (!user || !ok) {
      return Response.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    await createSession(user.id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Sign-in failed", error);
    return Response.json(
      { error: "Could not sign you in. Is Postgres running?" },
      { status: 500 },
    );
  }
}
