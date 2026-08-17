"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useMemo, useRef } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";

export function ChatPanel({
  id,
  initialMessages,
}: {
  id: string;
  initialMessages: UIMessage[];
}) {
  const router = useRouter();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  // A brand new conversation has no sidebar entry until its first exchange is
  // persisted, so refresh the server layout exactly once.
  const hasRefreshedSidebar = useRef(initialMessages.length > 0);

  const { messages, sendMessage, status, stop, error, regenerate, clearError } =
    useChat({
      id,
      messages: initialMessages,
      transport,
      onFinish() {
        if (!hasRefreshedSidebar.current) {
          hasRefreshedSidebar.current = true;
          router.refresh();
        }
      },
    });

  const isBusy = status === "submitted" || status === "streaming";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-4">
        <h1 className="text-sm font-medium">Personal Assistant AI</h1>
      </header>

      <MessageList
        messages={messages}
        status={status}
        // Approving a plan card has to hand control back to the model, which
        // only happens on a new user turn.
        onResume={(text) => sendMessage({ text })}
      />

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-3 rounded-md border p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Something went wrong</p>
              <p className="mt-0.5 break-words opacity-90">{error.message}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearError();
                regenerate();
              }}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      <Composer
        disabled={isBusy}
        isStreaming={isBusy}
        onStop={stop}
        onSubmit={(text) => sendMessage({ text })}
      />
    </div>
  );
}
