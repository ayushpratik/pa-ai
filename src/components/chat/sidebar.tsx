"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogOut, Plus, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/types";

export function Sidebar({
  conversations,
  userEmail,
}: {
  conversations: ConversationSummary[];
  userEmail: string;
}) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");

      // Leaving the thread we just deleted would render a dead route.
      if (params.id === id) {
        router.push("/");
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setDeletingId(null);
    }
  }

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
    // Without this the signed-in layout stays in the router cache and flashes
    // back on the next navigation.
    router.refresh();
  }

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 flex-col border-r md:flex">
      <div className="p-3">
        <Button asChild className="w-full justify-start gap-2">
          <Link href="/">
            <Plus className="size-4" />
            New chat
          </Link>
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-sm">
            No conversations yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = params.id === conversation.id;
              return (
                <li key={conversation.id} className="group relative">
                  <Link
                    href={`/chat/${conversation.id}`}
                    className={cn(
                      "block truncate rounded-md py-2 pr-9 pl-3 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60",
                      deletingId === conversation.id && "opacity-50",
                    )}
                    title={conversation.title ?? "New chat"}
                  >
                    {conversation.title ?? "New chat"}
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(conversation.id)}
                    disabled={isPending || deletingId === conversation.id}
                    aria-label={`Delete ${conversation.title ?? "conversation"}`}
                    className="text-muted-foreground hover:text-destructive absolute top-1/2 right-1 -translate-y-1/2 rounded p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="space-y-1 border-t p-2">
        <p
          className="text-muted-foreground truncate px-3 pt-1 text-xs"
          title={userEmail}
        >
          {userEmail}
        </p>
        <Button asChild variant="ghost" className="w-full justify-start gap-2">
          <Link href="/settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={handleSignOut}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
