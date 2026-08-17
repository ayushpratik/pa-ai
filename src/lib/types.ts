/**
 * Types shared across the server/client boundary. Kept out of the data-access
 * modules so client components can import them without pulling in "server-only".
 */

export type ConversationSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
};

/** A single step in a proposed plan. Rendered by the plan card. */
export type PlanStep = {
  /** Short imperative description shown to the user. */
  title: string;
  /** Name of the tool that will carry this step out, if any. */
  tool?: string;
  /** Why this step is needed. One sentence. */
  detail?: string;
  /** True when the step spends money or contacts someone. */
  costly?: boolean;
};

export type PlanStatus =
  | "proposed"
  | "approved"
  | "running"
  | "done"
  | "cancelled"
  | "blocked";

export type PlanSummary = {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: string;
};

export type MemoryCategory =
  | "preference"
  | "context"
  | "constraint"
  | "outcome";

export type MemoryItem = {
  id: string;
  content: string;
  category: MemoryCategory;
  source: "auto" | "user";
  createdAt: string;
};

/** The editable profile fields. Mirrors the `user_profile` columns. */
export type ProfileFields = {
  displayName: string;
  role: string;
  company: string;
  location: string;
  timezone: string;
  sendingEmail: string;
  emailSignature: string;
  calendarLink: string;
  writingTone: string;
  about: string;
};

export const EMPTY_PROFILE: ProfileFields = {
  displayName: "",
  role: "",
  company: "",
  location: "",
  timezone: "",
  sendingEmail: "",
  emailSignature: "",
  calendarLink: "",
  writingTone: "",
  about: "",
};

/**
 * The fields a new account must fill before it can use the assistant. The
 * profile is composed into every system prompt, so without these the assistant
 * has nothing to work from. Defined here, not in the gate or the form, so both
 * read the same list.
 */
export const REQUIRED_PROFILE_FIELDS = [
  "displayName",
  "role",
  "company",
  "sendingEmail",
] as const satisfies readonly (keyof ProfileFields)[];

export function isProfileComplete(profile: ProfileFields): boolean {
  return REQUIRED_PROFILE_FIELDS.every((key) => profile[key].trim() !== "");
}

/** Shape returned by the entity-producing tools and rendered as a table. */
export type EntitySummary = {
  id: string;
  type: string;
  name: string;
  organization: string | null;
  email: string | null;
  linkedinUrl: string | null;
  attributes: Record<string, unknown>;
  sourceUrl: string | null;
  /** Set when this person has been contacted before on any channel. */
  contacted?: boolean;
};

export type OutreachDraft = {
  id: string;
  entityId: string;
  entityName: string;
  channel: "email" | "linkedin";
  subject: string | null;
  body: string;
  status: "drafted" | "approved" | "sent" | "skipped" | "failed";
  /** Present once a send has been attempted. */
  note?: string;
};

/** How the app is allowed to treat outbound email in this environment. */
export type SendEmailMode = "none" | "test" | "send";

/**
 * Which transport delivers mail. "auto" prefers SMTP when configured and falls
 * back to the Gmail OAuth connection.
 */
export type EmailTransport = "auto" | "smtp" | "gmail";

/** What the settings screen shows about outbound email readiness. */
export type EmailStatus = {
  transport: EmailTransport;
  /** The transport that would actually be used right now. */
  resolved: "smtp" | "gmail" | "none";
  smtpConfigured: boolean;
  smtpHost: string | null;
  smtpFrom: string | null;
  googleConnected: boolean;
  googleEmail: string | null;
  googleOAuthConfigured: boolean;
};
