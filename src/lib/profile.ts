import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { EMPTY_PROFILE, type ProfileFields } from "@/lib/types";

const FIELD_LABELS: Record<keyof ProfileFields, string> = {
  displayName: "Name",
  role: "Role",
  company: "Company",
  location: "Location",
  timezone: "Timezone",
  sendingEmail: "Sends email from",
  emailSignature: "Email signature",
  calendarLink: "Calendar link",
  writingTone: "Preferred tone",
  about: "About",
};

export async function getProfile(userId: string): Promise<ProfileFields> {
  const [row] = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (!row) return { ...EMPTY_PROFILE };

  // Null columns become empty strings so the form is always controlled.
  return Object.fromEntries(
    (Object.keys(EMPTY_PROFILE) as (keyof ProfileFields)[]).map((key) => [
      key,
      row[key] ?? "",
    ]),
  ) as ProfileFields;
}

export async function saveProfile(
  userId: string,
  fields: Partial<ProfileFields>,
): Promise<void> {
  const values = Object.fromEntries(
    (Object.keys(EMPTY_PROFILE) as (keyof ProfileFields)[]).map((key) => [
      key,
      fields[key]?.trim() || null,
    ]),
  );

  await db
    .insert(userProfile)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Compact prompt block. Returns "" when the profile is empty so a fresh install
 * does not pay tokens for a list of blank labels on every request.
 */
export async function renderProfileForPrompt(userId: string): Promise<string> {
  const profile = await getProfile(userId);
  const lines = (Object.keys(FIELD_LABELS) as (keyof ProfileFields)[])
    .filter((key) => profile[key].trim() !== "")
    .map((key) => `- ${FIELD_LABELS[key]}: ${profile[key].trim()}`);

  if (lines.length === 0) return "";
  return `## About the user\n${lines.join("\n")}`;
}
