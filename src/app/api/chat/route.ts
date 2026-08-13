import {
  convertToModelMessages,
  generateId,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { chatModel } from "@/lib/model";
import { buildSystemPrompt } from "@/lib/prompts";
import { buildTools } from "@/lib/tools";
import { extractMemories } from "@/lib/memory";
import { ensureConversation, saveMessage } from "@/lib/conversations";
import { requireUserId } from "@/lib/session";

// The Postgres driver needs Node APIs, and the node runtime avoids the
// serverless execution limits that would truncate long streams.
export const runtime = "nodejs";
export const maxDuration = 300;

// A single approved plan can legitimately need several tool calls in sequence
// (search, fetch, extract, save). This bounds a runaway loop without cutting
// normal work short.
const MAX_STEPS = 16;

type ChatRequest = {
  id?: string;
  messages?: UIMessage[];
};

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, messages } = body;
  if (!id || !Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "Both `id` and a non-empty `messages` array are required" },
      { status: 400 },
    );
  }

  const latest = messages[messages.length - 1];
  if (latest.role !== "user") {
    return Response.json(
      { error: "The last message must be from the user" },
      { status: 400 },
    );
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    // Persist before calling the model so an aborted or failed generation never
    // loses what the user typed.
    const owned = await ensureConversation(userId, id, messages[0]);
    if (!owned) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    await saveMessage(id, latest);
  } catch (error) {
    console.error("Failed to persist user message", error);
    return Response.json(
      { error: "Could not save your message. Is Postgres running?" },
      { status: 500 },
    );
  }

  let model;
  let system: string;
  const tools = buildTools(id, userId);
  try {
    model = chatModel();
    system = await buildSystemPrompt(userId, Object.keys(tools));
  } catch (error) {
    // Missing or unreadable GOOGLE_GENERATIVE_AI_API_KEY. Surface the setup
    // message instead of an opaque 500.
    console.error("Model configuration error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Model not configured" },
      { status: 500 },
    );
  }

  const result = streamText({
    model,
    system,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    messages: await convertToModelMessages(messages),
    onError({ error }) {
      console.error("Gemini stream error", error);
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    // Required, not optional. Without it the SDK leaves the response message's
    // id as an empty string (originalMessages only supplies one when the last
    // message is an assistant message being continued, which it never is here).
    // Every assistant reply then inserts under the id "", and the primary key
    // collapses them all into a single row with no error to notice.
    generateMessageId: generateId,
    async onFinish({ responseMessage }) {
      // Also fires when the client aborts, so partial replies are kept.
      try {
        if (responseMessage.parts.length > 0) {
          await saveMessage(id, responseMessage);
        }
      } catch (error) {
        console.error("Failed to persist assistant message", error);
      }

      // Only worth a model call on turns that actually did something. Running
      // this on every message would roughly double the cost of small talk.
      const didWork = responseMessage.parts.some((part) =>
        part.type.startsWith("tool-"),
      );
      if (!didWork) return;

      const transcript = [...messages, responseMessage]
        .slice(-6)
        .map((message) => {
          const text = message.parts
            .filter((part) => part.type === "text")
            .map((part) => ("text" in part ? part.text : ""))
            .join(" ");
          return text ? `${message.role}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");

      await extractMemories(userId, transcript);
    },
    onError(error) {
      // Returned to the client as the stream's error text.
      console.error("Chat stream failed", error);
      if (error instanceof Error) {
        return error.message;
      }
      return "The model request failed. Check the server logs.";
    },
  });
}
