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
import { apolloEnrich, apolloSearchPeople } from "@/lib/tools/apollo";
import { fetchPageText, webSearch } from "@/lib/tools/search";

// Batch caps. A single approved run must not be able to exhaust an API quota or
// run past the route's maxDuration.
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function clamp(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

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
      }),
      async execute({ goal, steps }) {
        return await createPlan(userId, conversationId, goal, steps);
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
        limit: z.number().optional().describe("Results to return, max 25."),
      }),
      async execute({ query, limit }) {
        try {
          return { results: await webSearch(query, clamp(limit)) };
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
        limit: z.number().optional(),
      }),
      async execute({ text, lookingFor, sourceUrl, limit }) {
        try {
          const { object } = await generateObject({
            model: chatModel(),
            schema: z.object({ entities: z.array(entitySchema) }),
            system:
              "Extract only what the text actually supports. Never invent an email address, a phone number, or a figure. Omit a field rather than guessing it.",
            prompt: `Extract up to ${clamp(limit)} records.\n\nLooking for: ${lookingFor}\n\nText:\n${text.slice(0, 12_000)}`,
          });

          return {
            entities: object.entities
              .slice(0, clamp(limit))
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
        limit: z.number().optional(),
      }),
      async execute({ type, limit }) {
        const found = await listEntities(userId, { type, limit: clamp(limit) });
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
        for (const draft of drafts.slice(0, MAX_LIMIT)) {
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
        for (const id of outreachIds.slice(0, MAX_LIMIT)) {
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
        limit: z.number().optional(),
      }),
      async execute(input) {
        try {
          const people = await apolloSearchPeople({
            ...input,
            limit: clamp(input.limit),
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

        const entities = await getEntities(userId, entityIds.slice(0, MAX_LIMIT));
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
