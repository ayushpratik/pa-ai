import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/** Emails are stored as typed but compared case-insensitively, as the unique index does. */
export async function findUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

export async function createUser(values: {
  email: string;
  passwordHash?: string | null;
  name?: string | null;
  imageUrl?: string | null;
}) {
  const [row] = await db
    .insert(users)
    .values({
      email: values.email.trim(),
      passwordHash: values.passwordHash ?? null,
      name: values.name ?? null,
      imageUrl: values.imageUrl ?? null,
    })
    .returning();
  return row;
}

export async function updateUser(
  id: string,
  values: { name?: string | null; imageUrl?: string | null },
) {
  await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, id));
}
