import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { env } from "@/lib/env";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// scrypt rather than a bcrypt dependency: it ships with Node and is memory-hard.
// N=2^15 with r=8 costs roughly 32MB and ~100ms per hash, which is a reasonable
// sign-in latency and an expensive offline attack. maxmem must be raised
// explicitly because Node's default ceiling is below what N=2^15 needs.
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const SESSION_COOKIE = "sales_ai_session";
/** Short-lived CSRF state for the Google sign-in round trip. */
export const OAUTH_STATE_COOKIE = "sales_ai_oauth_state";
const SESSION_DAYS = 30;

/** Returns "scrypt$N$r$p$saltHex$hashHex" so the parameters can change later. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

/**
 * Constant-time comparison. Returns false rather than throwing on a malformed
 * stored value, so a corrupt row is a failed login and not a 500.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  try {
    const actual = await scrypt(
      plain.normalize("NFKC"),
      Buffer.from(saltHex, "hex"),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT_MAXMEM,
      },
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A hash of a value that cannot exist, used to burn the same CPU time on an
 * unknown email as on a wrong password. Without it, response time tells an
 * attacker which addresses have accounts.
 */
let dummyHashPromise: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomUUID());
  return dummyHashPromise;
}

/**
 * The cookie carries the raw token; the table stores sha256(token + secret).
 * The pepper means a leaked sessions table alone cannot be replayed, and
 * rotating AUTH_SECRET invalidates every session at once.
 */
function tokenHash(token: string): string {
  return createHash("sha256")
    .update(`${token}${env.authSecret}`)
    .digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    tokenHash: tokenHash(token),
    userId,
    expiresAt,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // "lax", not "strict": the Google callback is a cross-site top-level
    // navigation back into the app, and "strict" would withhold the cookie.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  }
  store.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

/** Resolves the caller from the cookie. Expiry is checked in SQL. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}
