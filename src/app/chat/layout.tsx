import { Sidebar } from "@/components/chat/sidebar";
import { listConversations } from "@/lib/conversations";
import { requireOnboardedUser } from "@/lib/session";

// The sidebar reflects rows written during the request cycle, so it must not be
// cached between navigations.
export const dynamic = "force-dynamic";

export default async function ChatLayout({ children }: LayoutProps<"/chat">) {
  // The authoritative gate. Middleware only checks that a cookie exists.
  const { user } = await requireOnboardedUser();
  const conversations = await listConversations(user.id);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar conversations={conversations} userEmail={user.email} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
