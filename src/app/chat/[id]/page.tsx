import { ChatPanel } from "@/components/chat/chat-panel";
import { loadMessages } from "@/lib/conversations";
import { requireOnboardedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { user } = await requireOnboardedUser();
  // Scoped to the signed-in user, so a guessed conversation id returns nothing
  // rather than someone else's history.
  const initialMessages = await loadMessages(user.id, id);

  // Keying on the id resets useChat's internal state when switching threads.
  return <ChatPanel key={id} id={id} initialMessages={initialMessages} />;
}
