import "server-only";
import { generateObject, tool, type ToolSet } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import { chatModel } from "@/lib/model";
import {
  getEntities,
  listEntities,
  saveEntities,
  updateEntityContact,
  type EntityInput,
} from "@/lib/entities";
import { sendMail } from "@/lib/mailer";
import {
  alreadyContacted,
  createDraft,
  getDraft,
  markOutreach,
} from "@/lib/outreach";
import {
  createPlan,
  findActiveApprovedPlan,
  setPlanStatusAsModel,
} from "@/lib/plans";
import { loadMessages } from "@/lib/conversations";
import { apolloEnrich, apolloSearchPeople } from "@/lib/tools/apollo";
import { fetchPageText, webSearch } from "@/lib/tools/search";

// Result counts for finding and listing records. The user picks how many they
// want (the prompt suggests 20, 30, ... 100 but any 1-100 is valid); MAX_RESULTS is the hard ceiling.
const DEFAULT_RESULTS = 20;
const MAX_RESULTS = 100;

// Batch cap for actions that spend credits or contact a person. Kept lower than
// MAX_RESULTS so one approved call cannot burn 100 Apollo credits or send 100
// emails, and stays inside the route's maxDuration.
const MAX_ACTION_BATCH = 25;

function resultCount(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_RESULTS;
  return Math.min(Math.floor(limit), MAX_RESULTS);
}

const resultCountSchema = z
  .number()
  .optional()
  .describe(
    `How many results the user asked for (any number from 1 to ${MAX_RESULTS}). Defaults to ${DEFAULT_RESULTS}, capped at ${MAX_RESULTS}.`,
  );

// Tools whose presence in a plan means the plan finds records, and therefore
// needs a result count the user chose.
const RECORD_FINDING_TOOLS = new Set([
  "searchWeb",
  "searchApollo",
  "extractEntities",
  "saveEntities",
]);

const FINDING_WORDS = /\b(find|search|research|list|identify|look up|source|discover)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  ten: 10,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/**
 * The result-count gate. The plan may only carry a count the user actually
 * typed in this conversation (as digits or a word such as "thirty"), or 20 when
 * they replied "default". Enforced here rather than in the prompt, because the
 * model otherwise skips the question and plans with the default.
 */
async function userStatedCount(
  userId: string,
  conversationId: string,
  count: number,
): Promise<boolean> {
  const history = await loadMessages(userId, conversationId);
  for (const message of history) {
    if (message.role !== "user") continue;
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .toLowerCase();

    const digits = text.match(/\d+/g) ?? [];
    if (digits.some((d) => Number(d) === count)) return true;

    const words: string[] = text.match(/[a-z]+/g) ?? [];
    if (words.some((w) => NUMBER_WORDS[w] === count)) return true;

    if (count === DEFAULT_RESULTS && words.includes("default")) return true;
  }
  return false;
}

const askForCount = {
  blocked: true as const,
  reason: "result-count" as const,
  error: `The user has not told you how many results they want. Do not propose a plan yet. Reply with only this question and wait for their answer: "Before we proceed, how many results do you want? Any number up to 100, for example 20, 30 or 50 (default 20)"`,
};

/**
 * The approval gate. Returned as a normal tool result rather than thrown, so the
 * model reads it, understands why it was stopped, and proposes a plan instead of
 * reporting an opaque error to the user.
 */
async function requireApproval(userId: string, conversationId: string) {
  const plan = await findActiveApprovedPlan(userId, conversationId);
  if (!plan) {
    return {
      blocked: true as const,
      error:
        "No approved plan is active for this conversation. Call proposePlan first and wait for the user to approve it.",
    };
  }
  return { blocked: false as const, plan };
}

const entitySchema = z.object({
  type: z
    .string()
    .describe(
      'What kind of record this is, lowercase, e.g. "investor", "founder", "supplier", "person".',
    ),
  name: z.string(),
  organization: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  attributes: z
    .record(z.string(), z.unknown())
    .describe(
      "Every other useful detail as key/value pairs. Use whatever keys fit the domain; there is no fixed set.",
    ),
});

export function buildTools(conversationId: string, userId: string): ToolSet {
  const tools: ToolSet = {
    proposePlan: tool({
      description:
        "Propose a plan for the user to approve. Call this once the request is clear enough to act on. Nothing that costs money or contacts anyone will run until the user approves the plan you create here.",
      inputSchema: z.object({
        goal: z
          .string()
          .describe("One sentence restating what the user wants, in their terms."),
        steps: z
          .array(
            z.object({
              title: z.string().describe("Short imperative, e.g. 'Find 15 EV-focused investors in Bangalore'."),
              tool: z
                .string()
                .optional()
                .describe("Name of the tool that will carry this out, if any."),
              detail: z.string().optional().describe("One sentence on why."),
              costly: z
                .boolean()
                .optional()
                .describe("True if this step spends credits or contacts a person."),
            }),
          )
          .min(1)
          .max(8),
        resultCount: z
          .number()
          .nullable()
          .describe(
            `How many results the user told you they want (any number from 1 to ${MAX_RESULTS}, such as 15). It must be a number the user actually typed; if they have not said, do not call this tool, ask them first. Null only when the plan finds no people or records.`,
          ),
      }),
      async execute({ goal, steps, resultCount }) {
        // Step text is checked too, because `tool` is optional and a plan that
        // omitted it would otherwise skip the count.
        const findsRecords = steps.some(
          (step) =>
            (step.tool && RECORD_FINDING_TOOLS.has(step.tool)) ||
            FINDING_WORDS.test(`${step.title} ${step.detail ?? ""}`),
        );

        let count: number | null = null;
        if (resultCount !== null || findsRecords) {
          if (resultCount === null || resultCount < 1) return askForCount;
          count = Math.min(Math.floor(resultCount), MAX_RESULTS);
          if (!(await userStatedCount(userId, conversationId, Math.floor(resultCount)))) {
            return askForCount;
          }
        }

        const plan = await createPlan(userId, conversationId, goal, steps);
        // Returned with the plan (not stored) so the card shows what is approved.
        return { ...plan, resultCount: count };
      },
    }),

    updatePlanStatus: tool({
      description:
        "Mark the active plan as running, done, or blocked. Call this with 'done' once every step has finished, and 'blocked' if you cannot continue.",
      inputSchema: z.object({
        planId: z.string(),
        status: z.enum(["running", "done", "blocked", "cancelled"]),
      }),
      async execute({ planId, status }) {
        return await setPlanStatusAsModel(userId, planId, status);
      },
    }),

    searchWeb: tool({
      description:
        "Search the public web. Use this for anything a structured B2B database cannot answer: investment theses, cheque sizes, recent news, niche communities, or any non-business domain.",
      inputSchema: z.object({
        query: z.string(),
        limit: resultCountSchema,
      }),
      async execute({ query, limit }) {
        try {
          return { results: await webSearch(query, resultCount(limit)) };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "Search failed.",
          };
        }
      },
    }),

    fetchPage: tool({
      description:
        "Fetch one web page and return its readable text. Use after searchWeb when a result looks like it holds the details you need.",
      inputSchema: z.object({ url: z.string() }),
      async execute({ url }) {
        try {
          return { url, text: await fetchPageText(url) };
        } catch (error) {
          return {
            url,
            error:
              error instanceof Error ? error.message : "Could not fetch page.",
          };
        }
      },
    }),

    extractEntities: tool({
      description:
        "Pull structured people or organisations out of text you fetched. Works for any domain: investors, suppliers, candidates, anything. Does not save them.",
      inputSchema: z.object({
        text: z.string().describe("The page text to read."),
        lookingFor: z
          .string()
          .describe(
            "What to extract and which criteria matter, e.g. 'VC funds investing in EV, with cheque size and partner names'.",
          ),
        sourceUrl: z.string().optional(),
        limit: resultCountSchema,
      }),
      async execute({ text, lookingFor, sourceUrl, limit }) {
        try {
          const { object } = await generateObject({
            model: chatModel(),
            schema: z.object({ entities: z.array(entitySchema) }),
            system:
              "Extract only what the text actually supports. Never invent an email address, a phone number, or a figure. Omit a field rather than guessing it.",
            prompt: `Extract up to ${resultCount(limit)} records.\n\nLooking for: ${lookingFor}\n\nText:\n${text.slice(0, 12_000)}`,
          });

          return {
            entities: object.entities
              .slice(0, resultCount(limit))
              .map((entity) => ({ ...entity, sourceUrl: sourceUrl ?? null })),
          };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : "Extraction failed.",
          };
        }
      },
    }),

    saveEntities: tool({
      description:
        "Persist people or organisations and show them to the user as a table. Deduplicates against everything found before, and flags anyone already contacted. Call this after extractEntities or searchApollo.",
      inputSchema: z.object({
        entities: z.array(entitySchema.extend({ sourceUrl: z.string().nullable().optional() })),
      }),
      async execute({ entities }) {
        const saved = await saveEntities(userId, entities as EntityInput[]);
        return { entities: saved, count: saved.length };
      },
    }),

    listEntities: tool({
      description:
        "Look up people or organisations already saved from earlier runs, so work is not repeated.",
      inputSchema: z.object({
        type: z.string().optional().describe("Filter by record type."),
        limit: resultCountSchema,
      }),
      async execute({ type, limit }) {
        const found = await listEntities(userId, { type, limit: resultCount(limit) });
        return { entities: found, count: found.length };
      },
    }),

    draftOutreach: tool({
      description:
        "Write a personalised message for each person and show it to the user for review. Prefers email; falls back to a LinkedIn message only when no email address is known. Does not send anything.",
      inputSchema: z.object({
        drafts: z
          .array(
            z.object({
              entityId: z.string(),
              subject: z
                .string()
                .nullable()
                .optional()
                .describe("Required for email, omit for LinkedIn."),
              body: z.string(),
            }),
          )
          .min(1),
      }),
      async execute({ drafts }) {
        const entities = await getEntities(
          userId,
          drafts.map((draft) => draft.entityId),
        );
        const byId = new Map(entities.map((entity) => [entity.id, entity]));

        const created = [];
        for (const draft of drafts.slice(0, MAX_ACTION_BATCH)) {
          const entity = byId.get(draft.entityId);
          if (!entity) continue;

          // Email is always the first preference; LinkedIn is the fallback.
          const channel = entity.email ? "email" : "linkedin";
          if (channel === "linkedin" && !entity.linkedinUrl) continue;

          const row = await createDraft(userId, {
            entityId: draft.entityId,
            conversationId,
            channel,
            subject: channel === "email" ? (draft.subject ?? "") : null,
            body: draft.body,
          });
          if (row) created.push(row);
        }

        return {
          drafts: created,
          note:
            "LinkedIn drafts are for the user to copy and paste; this app cannot send them.",
        };
      },
    }),

    sendEmail: tool({
      description:
        "Send an email draft through the user's connected Gmail account. Requires an approved plan. Only works for drafts on the email channel.",
      inputSchema: z.object({
        outreachIds: z.array(z.string()).min(1),
        allowFollowUp: z
          .boolean()
          .optional()
          .describe(
            "Set true only when the user explicitly asked to contact someone again.",
          ),
      }),
      async execute({ outreachIds, allowFollowUp }) {
        const gate = await requireApproval(userId, conversationId);
        if (gate.blocked) return gate;

        const results = [];
        for (const id of outreachIds.slice(0, MAX_ACTION_BATCH)) {
          const record = await getDraft(userId, id);
          if (!record) {
            results.push({ id, sent: false, note: "No such draft." });
            continue;
          }
          if (record.outreach.channel !== "email") {
            results.push({
              id,
              sent: false,
              note: "LinkedIn drafts cannot be sent from here.",
            });
            continue;
          }
          if (!record.entityEmail) {
            results.push({ id, sent: false, note: "No email address on file." });
            continue;
          }

          if (!allowFollowUp) {
            const contacted = await alreadyContacted(
              userId,
              [record.outreach.entityId],
              "email",
            );
            if (contacted.has(record.outreach.entityId)) {
              await markOutreach(userId, id, { status: "skipped" });
              results.push({
                id,
                sent: false,
                note: `${record.entityName} has already been emailed. Ask the user before following up.`,
              });
              continue;
            }
          }

          try {
            const result = await sendMail(userId, {
              to: record.entityEmail,
              subject: record.outreach.subject ?? "",
              body: record.outreach.body,
            });

            await markOutreach(userId, id, {
              status: result.delivered ? "sent" : "skipped",
              sentAt: result.delivered ? new Date() : null,
              metadata: {
                mode: result.mode,
                transport: result.transport,
                intendedRecipient: result.intendedRecipient,
                actualRecipient: result.actualRecipient,
                messageId: result.messageId ?? null,
              },
            });

            results.push({
              id,
              recipient: record.entityName,
              sent: result.delivered,
              note: result.note,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Send failed.";
            await markOutreach(userId, id, { status: "failed", error: message });
            results.push({ id, sent: false, note: message });
          }
        }

        return { results, mode: env.sendEmailMode };
      },
    }),
  };

  // Apollo tools are registered only when a key exists, so the model is never
  // told about a capability that would fail on every call.
  if (env.apolloApiKey) {
    tools.searchApollo = tool({
      description:
        "Search Apollo's B2B database for people by job title, location, and company. Best for verified work emails and standard business roles. It cannot filter on investment thesis or cheque size; use searchWeb for those.",
      inputSchema: z.object({
        titles: z.array(z.string()).optional(),
        locations: z
          .array(z.string())
          .optional()
          .describe('Cities or countries, e.g. ["Bangalore, India"].'),
        organizationNames: z.array(z.string()).optional(),
        keywords: z.string().optional(),
        limit: resultCountSchema,
      }),
      async execute(input) {
        try {
          const people = await apolloSearchPeople({
            ...input,
            limit: resultCount(input.limit),
          });
          return { entities: people, count: people.length };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : "Apollo search failed.",
          };
        }
      },
    });

    tools.enrichContact = tool({
      description:
        "Reveal a verified email address for someone already saved. This spends an Apollo credit, so it requires an approved plan and should be used on a shortlist, not a whole result set.",
      inputSchema: z.object({ entityIds: z.array(z.string()).min(1) }),
      async execute({ entityIds }) {
        const gate = await requireApproval(userId, conversationId);
        if (gate.blocked) return gate;

        const entities = await getEntities(userId, entityIds.slice(0, MAX_ACTION_BATCH));
        const enriched = [];

        for (const entity of entities) {
          if (entity.email) {
            enriched.push({ ...entity, note: "Already had an email." });
            continue;
          }
          try {
            const match = await apolloEnrich({
              name: entity.name,
              organization: entity.organization,
              linkedinUrl: entity.linkedinUrl,
            });
            const updated = await updateEntityContact(userId, entity.id, {
              email: match.email,
              linkedinUrl: match.linkedinUrl,
            });
            enriched.push({
              ...(updated ?? entity),
              note: match.email
                ? "Email found."
                : "No email found; use LinkedIn for this one.",
            });
          } catch (error) {
            enriched.push({
              ...entity,
              note: error instanceof Error ? error.message : "Enrichment failed.",
            });
          }
        }

        return { entities: enriched };
      },
    });
  }

  return tools;
}

/** Names the model should see in the prompt's capability list. */
export function availableToolNames(): string[] {
  return Object.keys(
    buildTools(
      "00000000-0000-0000-0000-000000000000",
      "00000000-0000-0000-0000-000000000000",
    ),
  );
}
