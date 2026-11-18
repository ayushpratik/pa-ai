"use client";

import type { UIMessage } from "ai";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { collectConversationEntities } from "@/lib/export";
import type { EntitySummary } from "@/lib/types";

/**
 * Every record found in the current conversation, so the export chips on any
 * result table download the whole set rather than just that table's batch.
 */
const ConversationEntitiesContext = createContext<EntitySummary[] | null>(null);

export function ConversationEntitiesProvider({
  messages,
  children,
}: {
  messages: UIMessage[];
  children: ReactNode;
}) {
  const entities = useMemo(
    () => collectConversationEntities(messages),
    [messages],
  );
  return (
    <ConversationEntitiesContext.Provider value={entities}>
      {children}
    </ConversationEntitiesContext.Provider>
  );
}

export function useConversationEntities(): EntitySummary[] | null {
  return useContext(ConversationEntitiesContext);
}
