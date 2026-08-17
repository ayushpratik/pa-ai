import "server-only";
import { env } from "@/lib/env";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Serper.dev, which speaks the Google SERP shape. Kept behind this one function
 * so swapping to Tavily or Brave is a single-file change.
 */
export async function webSearch(
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const key = env.searchApiKey;
  if (!key) {
    throw new Error(
      "Web search is not configured. Set SEARCH_API_KEY in .env.local to enable it.",
    );
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
  });

  if (!response.ok) {
    throw new Error(
      `Search failed (${response.status}). Check SEARCH_API_KEY and the account's quota.`,
    );
  }

  const data = (await response.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
  };

  return (data.organic ?? [])
    .filter((hit) => hit.link)
    .slice(0, limit)
    .map((hit) => ({
      title: hit.title ?? hit.link!,
      url: hit.link!,
      snippet: hit.snippet ?? "",
    }));
}

// Pages are fed to the model, so the cap is about token cost as much as memory.
const MAX_PAGE_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetches a page and reduces it to readable text. Deliberately regex-based
 * rather than a DOM parser: this only needs to be good enough for an extraction
 * model to read, and it keeps the dependency footprint small.
 */
export async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some sites return a stub or a block page to unknown agents.
        "User-Agent":
          "Mozilla/5.0 (compatible; SalesAI/1.0; +https://example.invalid/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_PAGE_CHARS);
  } finally {
    clearTimeout(timer);
  }
}
