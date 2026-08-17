import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { getEmailStatus } from "@/lib/mailer";
import { listMemories } from "@/lib/memory";
import { requireOnboardedUser } from "@/lib/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, profile } = await requireOnboardedUser();
  const [memories, email] = await Promise.all([
    listMemories(user.id),
    getEmailStatus(user.id),
  ]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What the assistant knows about you, and what it has learned.
        </p>
      </div>

      <SettingsScreen
        initialProfile={profile}
        initialMemories={memories}
        email={email}
        sendEmailMode={env.sendEmailMode}
      />
    </div>
  );
}
