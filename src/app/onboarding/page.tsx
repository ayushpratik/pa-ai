import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/settings/onboarding-screen";
import { getSessionUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { isProfileComplete } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The gate a new account passes through once. The assistant composes the
 * profile into every system prompt, so it is useless until these are filled.
 * Also the landing target after sign-in, because a returning user with a
 * complete profile is forwarded straight to a new chat.
 */
export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getProfile(user.id);
  if (isProfileComplete(profile)) redirect("/");

  return (
    <OnboardingScreen
      // Prefill what the account already told us, so a Google sign-up does not
      // retype its own name.
      initialProfile={{
        ...profile,
        displayName: profile.displayName || (user.name ?? ""),
        sendingEmail: profile.sendingEmail || user.email,
      }}
    />
  );
}
