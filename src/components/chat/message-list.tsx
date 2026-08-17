"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { ToolPart } from "@/components/chat/tool-part";
import { cn } from "@/lib/utils";

export function MessageList({
  messages,
  status,
  onResume,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  onResume: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Re-runs on every streamed chunk, which keeps the newest tokens in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-medium">What are we working on?</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Describe the outcome you want. I&apos;ll ask what I need, propose a
            plan, and run it once you approve.
          </p>
        </div>
      </div>
    );
  }

  const waitingForFirstToken =
    status === "submitted" && messages[messages.length - 1]?.role === "user";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message) => (
          <MessageBlock
            key={message.id}
            message={message}
            onResume={onResume}
          />
        ))}

        {waitingForFirstToken && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/**
 * Renders parts in order rather than collapsing the message to a single string,
 * so a plan card, a result table and the surrounding commentary appear where the
 * model actually produced them.
 */
function MessageBlock({
  message,
  onResume,
}: {
  message: UIMessage;
  onResume: (text: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join("");

    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {message.parts.map((part, index) => {
        if (part.type === "reasoning") {
          return (
            <details key={index} className="text-muted-foreground text-xs">
              <summary className="cursor-pointer">Reasoning</summary>
              <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
            </details>
          );
        }

        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <div
              key={index}
              className={cn(
                "bg-muted text-foreground max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                // Rendered as plain text for now; markdown is a later step.
                "whitespace-pre-wrap",
              )}
            >
              {part.text}
            </div>
          );
        }

        if (part.type.startsWith("tool-")) {
          return (
            <div key={index} className="w-full">
              <ToolPart part={part} onResume={onResume} />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="bg-muted-foreground size-1.5 animate-bounce rounded-full"
      style={{ animationDelay: delay }}
    />
  );
}
