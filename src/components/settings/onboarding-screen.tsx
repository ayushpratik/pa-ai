"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProfileForm } from "@/components/settings/profile-form";
import type { ProfileFields } from "@/lib/types";

export function OnboardingScreen({
  initialProfile,
}: {
  initialProfile: ProfileFields;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Tell the assistant who you are</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          It reads this on every request. You can change any of it later in
          Settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            Fields marked * are needed before you can start.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initialProfile={initialProfile}
            submitLabel="Continue"
            requireComplete
            onSaved={() => {
              router.push("/");
              // The chat layout re-reads the profile server-side; without this
              // the cached RSC payload would bounce back to onboarding.
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
