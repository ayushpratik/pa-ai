import "server-only";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { env } from "@/lib/env";

let provider: GoogleGenerativeAIProvider | undefined;

/**
 * Built on first use rather than at module load. Reading the key at import time
 * would fail `next build` in any environment where the key is not present.
 */
export function chatModel() {
  provider ??= createGoogleGenerativeAI({ apiKey: env.googleApiKey });
  return provider(env.geminiModel);
}
