## Claude Instructions

- While planning, use AskUserQuestions tool and Ask me any questions and decisions related to trade-offs, architecture, UI etc
- Every time any plans are executed, make sure that at the end, CLAUDE.md is updated about the same
- Do not use emojis in comments.

---

## Project: Personal Assistant AI

A research-and-outreach assistant, built step by step.

- **Step 1 (done)** — an AI chat screen on Gemini Flash Lite.
- **Step 2 (done)** — the orchestrator: a personal assistant that asks what it needs,
  proposes a plan for approval, executes it with tools (web/Apollo research, entity
  storage, drafting, Gmail sending), suggests the next step, and learns the user's
  preferences over time.
- **Step 3 (done)** — accounts: email/password and Google sign-in, database-backed
  sessions, and a profile gate a new account must pass before it can use the assistant.

**The assistant is deliberately domain-agnostic.** Sales outreach is the first use case,
not the only one — the same user may ask it to find suppliers, hire, or research something
personal. Nothing sales-specific is hard-coded in the schema or the base prompt; the domain
lives in the user's profile and in learned memories. Keep it that way when extending it.

### Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| AI | Vercel AI SDK v6 (`ai`, `@ai-sdk/react`) with `@ai-sdk/google` |
| Model | Gemini Flash Lite, set via `GEMINI_MODEL` |
| Database | PostgreSQL + Drizzle ORM (`postgres-js` driver) |
| UI | Tailwind CSS v4 + shadcn/ui (radix base, nova preset), lucide-react |
| Tool schemas | `zod` (a direct dependency since step 2, not just a transitive one) |
| Email | `nodemailer` (SMTP) and `googleapis` (Gmail send + OAuth2) |
| Auth | Hand-rolled: Node `crypto` (scrypt + random tokens), no auth library |

Note: `lucide-react` v1 dropped brand icons, so LinkedIn is represented by the generic
`Link2` icon.

Chosen over the previously used Node + Angular stack because the AI SDK provides streaming,
tool calling, and multi-step agent loops out of the box, all of which this product needs.
Accepted cost: a React/Next ramp-up.

### Setup

```
cp .env.example .env.local     # then fill in GOOGLE_GENERATIVE_AI_API_KEY
openssl rand -base64 32        # paste into AUTH_SECRET
createdb sales_ai
npm install
npm run db:migrate
npm run check:model            # confirms GEMINI_MODEL exists on the live API
npm run dev
```

Get a Gemini API key at https://aistudio.google.com/apikey.

`README.md` is the deployment-facing document: prerequisites, every environment variable
and what breaks without it, database setup for local and hosted Postgres, the Google
OAuth console steps, build/Docker/Vercel deployment, and the ordered list of data an
operator must supply (env, migrations, account, profile gate). This file stays the
architecture and decisions record — keep operator instructions in the README and
reasoning here, and update the README when a variable, script, or migration step changes.

Everything beyond the Gemini key and the database is optional and degrades cleanly:

| Variable | Effect when missing |
| --- | --- |
| `SEARCH_API_KEY` (Serper.dev) | `searchWeb` returns a setup message; the assistant tells the user it cannot research |
| `APOLLO_API_KEY` | The `searchApollo` and `enrichContact` tools are not registered at all, and the prompt says so |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | SMTP is treated as unconfigured (all three are required); `auto` falls through to Gmail |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | The Connect Google button and the "Continue with Google" sign-in button are both hidden; the Gmail transport is unavailable, and email/password sign-in still works |
| `SEND_EMAIL` | Treated as `none` — drafts only, nothing delivered |

For local work, SMTP is the quicker path: with a Gmail account, use `smtp.gmail.com:587`
and an **App Password** (not the account password), which requires 2-Step Verification.

`AUTH_SECRET` is required — it is the pepper for session tokens, and rotating it signs
everyone out. Sign up at `/signup`, then fill in the profile the app asks for. The
assistant reads it on every request.

### Scripts

- `npm run dev` / `build` / `start` / `lint`
- `npm run db:generate` — generate a migration from `src/db/schema.ts`
- `npm run db:migrate` — apply pending migrations
- `npm run db:studio` — Drizzle Studio
- `npm run check:model` — verify `GEMINI_MODEL` against the live `models.list` endpoint

Drizzle scripts load `.env.local` via `node --env-file`, so that file must exist.

### Layout

```
src/
  proxy.ts                         optimistic cookie check (Next 16 renamed middleware)
  app/
    page.tsx                       redirects to /chat/<new uuid>
    (auth)/login, (auth)/signup    sign in / sign up, shared AuthForm
    onboarding/page.tsx            the profile gate a new account passes once
    settings/page.tsx              profile, Google connection, learned memories
    chat/layout.tsx                sidebar shell, loads conversation list
    chat/[id]/page.tsx             server component, loads history from Postgres
    api/chat/route.ts              streaming chat endpoint, tools + memory extraction
    api/conversations/route.ts     GET list
    api/conversations/[id]/route.ts GET messages, DELETE thread
    api/profile/route.ts           GET / PUT the user profile
    api/memories/route.ts          GET list, POST a fact
    api/memories/[id]/route.ts     DELETE a fact
    api/plans/[id]/route.ts        GET, PATCH (approve / cancel) - the user's gate
    api/outreach/[id]/route.ts     PATCH an edited draft
    api/auth/signup|signin|signout the password routes
    api/auth/google/route.ts       Google sign-in consent start (profile + email)
    api/auth/google/callback/      Google sign-in callback, creates the session
    api/integrations/google/       the *sending* consent (gmail.send) and its callback
  components/chat/                 chat-panel, message-list, composer, sidebar,
                                   tool-part (dispatcher), plan-card,
                                   prospect-table, draft-card
  components/auth/                 auth-form (login and signup)
  components/settings/             settings-screen, profile-form, onboarding-screen
  components/ui/                   shadcn primitives
  db/schema.ts, db/index.ts        Drizzle schema and client
  lib/env.ts                       validated env access, CURRENT_USER_ID, SEND_EMAIL
  lib/model.ts                     lazily constructed Gemini provider
  lib/prompts.ts                   composed orchestrator prompt
  lib/conversations.ts             conversation/message data access
  lib/profile.ts                   profile read/write + prompt block
  lib/memory.ts                    memory CRUD, dedupe, automatic extraction
  lib/plans.ts                     plan rows and the server-side approval gate
  lib/entities.ts                  entity upsert/dedupe, lists, contacted flags
  lib/outreach.ts                  drafts, statuses, already-contacted lookup
  lib/mailer.ts                    the single send path: SEND_EMAIL guard + transport choice
  lib/smtp.ts                      nodemailer SMTP transport
  lib/gmail.ts                     Google OAuth tokens and the Gmail transport
  lib/tools/index.ts               the tool registry given to the model
  lib/tools/search.ts              Serper search + page text extraction
  lib/tools/apollo.ts              Apollo people search and email reveal
  lib/types.ts                     types shared across the server/client boundary
scripts/check-model.mjs
drizzle/                           generated migrations
```

### Conventions and decisions

- **Model id is config, not code.** Gemini model ids change between releases. Always confirm
  with `npm run check:model` rather than assuming an id is valid.
- **`messages.id` is `text`, not `uuid`.** The AI SDK client generates nanoid-style message
  ids. A `uuid` column rejects every real request.
- **`messages.parts` is `jsonb`** holding the AI SDK parts array, so tool calls and reasoning
  blocks persist without a migration. Do not flatten it to a text column.
- **The user message is persisted before the model is called**, so an aborted or failed
  generation never loses what the user typed. The assistant message is written in the
  stream's `onFinish`, which also fires on abort.
- **`lib/model.ts` builds the provider lazily.** Reading the API key at module load breaks
  `next build` in environments without the key.
- **Server-only modules import `server-only`.** Types crossing to client components live in
  `lib/types.ts` to avoid pulling that guard into the client bundle.
- **API routes set `runtime = "nodejs"`** — the Postgres driver needs Node APIs, and this
  avoids serverless limits truncating long streams.
- **`userId` is an explicit first parameter on every data-access function**, not something
  each function reads from the cookie itself. The chat route persists the assistant message
  and extracts memories inside `streamText`'s `onFinish`, which runs after the response has
  begun streaming, where `cookies()` is not reliably available. Resolving the id once at the
  top of the request and capturing it in the closure is correct in every context. Keep new
  data functions to that shape.
- `package.json` pins an `undici` override to `^6.28.0` to clear high-severity advisories
  reached transitively through `@ai-sdk/provider-utils`. Remove it once the SDK ships a
  fixed version.
- `AGENTS.md` is generated and rewritten by `next dev`. Leave it alone.

### The orchestrator (step 2)

**The loop.** Clarify (one batched message of questions, never an interrogation) → call
`proposePlan` → the user approves via the plan card → execute with tools → suggest one next
step. `api/chat/route.ts` runs this with `stopWhen: stepCountIs(16)`.

**Approval is enforced in the database, not the prompt.** `plans` rows carry a status, and
tools that spend credits or contact someone (`enrichContact`, `sendEmail`) call
`requireApproval()` in `lib/tools/index.ts` first. Two details matter:

- The gate returns `{ blocked: true, error }` as a normal tool result rather than throwing,
  so the model reads it and proposes a plan instead of surfacing an opaque failure.
- `updatePlanStatus` goes through `setPlanStatusAsModel`, which refuses to move a plan to
  `running` unless the user already approved it. Without that check the model could
  self-approve, because `findActiveApprovedPlan` treats `running` as active. This was a real
  hole found in testing — do not relax it.

**Postgres with `jsonb`, not MongoDB.** Considered and rejected. `entities.attributes` is
`jsonb` with a GIN index, so an investor, a supplier and a marriage prospect all fit one
table without a migration; a document store would have cost the transactional integrity,
Drizzle migrations, and the option of pg-boss, in exchange for flexibility already available.

**Entity dedupe** happens in `lib/entities.ts` by explicit lookup — email, then LinkedIn
URL, then name + organisation — because the identifier varies per row and `ON CONFLICT`
cannot switch targets. Partial unique indexes on the table are the backstop. Attributes are
merged, never replaced, so an enrichment pass does not discard the original search.

**Profile vs memory.** `user_profile` holds only the thin, permanent core (name, role,
location, sending identity, tone). Everything domain-specific is a row in `memories`.
Extraction runs in `onFinish` only on turns that actually made tool calls — running it on
every message would roughly double the cost of small talk. Both blocks render to `""` when
empty so a fresh install pays no tokens for empty headings.

**Email is the preferred channel; LinkedIn is the fallback** used only when no address is
known. LinkedIn drafts are copy-out only — there is no compliant send API, so the app never
claims it can deliver them.

**Two email transports, one guarded send path.** `lib/mailer.ts` owns `sendMail()`, which is
the only function that sends anything. Beneath it sit two dumb delivery functions that do no
policy of their own: `deliverViaSmtp` (`lib/smtp.ts`, nodemailer) and `deliverViaGmail`
(`lib/gmail.ts`, OAuth). `EMAIL_TRANSPORT` picks between them — `auto` (default) prefers SMTP
because it needs no interactive consent, then falls back to a connected Google account.

The guard had to move for this. It previously lived inside `sendGmail`; with two transports
that would have left SMTP unguarded, so it was hoisted into `sendMail` above both. **Never
put recipient rewriting or mode checks into a transport** — a second copy of that logic is
exactly how a test-mode send reaches a real prospect.

**`SEND_EMAIL` guards every outbound message**, applied in that one place:

- `none` (default, and the fallback for a missing or invalid value) — draft and log only.
- `test` — every recipient is rewritten to `TEST_EMAIL_RECIPIENT`, with the real address
  preserved in the subject prefix and in `outreach.metadata`. Verified against a local SMTP
  server: both the envelope `RCPT TO` and the `To:` header carry the test address.
- `send` — real recipients.

Every attempt writes an `outreach` row recording the mode and transport used, which is also
what powers "has this person already been contacted?" across conversations.

**Adding a tool**: define it in `lib/tools/index.ts` with a `zod` `inputSchema`, clamp any
batch size through `clamp()` (default 10, max 25), call `requireApproval()` first if it
costs money or contacts a person, and return errors as values rather than throwing. Register
it conditionally when it depends on an optional key, so the model is never told about a
capability that would fail on every call. If the output deserves a rich card rather than a
one-line summary, add a branch in `components/chat/tool-part.tsx`.

### Authentication and the profile gate (step 3)

**Hand-rolled, no auth library.** Everything needed was already present: Node's `crypto`
for scrypt hashing and random tokens, `googleapis` for the Google exchange, and Drizzle.
Better Auth was considered and rejected.

**Sessions are opaque database rows, not JWTs.** `createSession` mints a 32-byte token,
puts the raw value in an httpOnly cookie and stores only `sha256(token + AUTH_SECRET)` in
`sessions`. A leaked table therefore cannot be replayed, signing out is a `DELETE` rather
than a blocklist, and rotating `AUTH_SECRET` invalidates every session at once.

**Passwords** use scrypt at N=2^15 (`maxmem` must be raised explicitly; Node's default
ceiling is below what that needs) and are compared with `timingSafeEqual`. The sign-in route
hashes against a throwaway value when the email is unknown, so an unknown address and a wrong
password take the same time — otherwise the endpoint tells an attacker which addresses are
registered. Both failures return the same message, deliberately.

**Two layers of route protection.**

- `src/proxy.ts` (Next 16's rename of `middleware.ts`) only checks that the session cookie
  is *present*. It cannot validate: middleware runs on the edge runtime and the Postgres
  driver needs Node. This is UX, not security.
- The real gate is `requireOnboardedUser()` in `chat/layout.tsx`, `chat/[id]/page.tsx` and
  `settings/page.tsx`, and `requireUserId()` — via the `withUser` wrapper — in every API
  route. API routes check the session only, not profile completeness, so a half-onboarded
  user can still `PUT /api/profile`.

**The profile gate.** `REQUIRED_PROFILE_FIELDS` in `lib/types.ts` (name, role, company,
sending email) is the single definition, read by both the gate and the form. Until they are
filled, everything redirects to `/onboarding`. `/onboarding` is also the post-sign-in
landing target, because it forwards to `/` once the profile is complete — one target that is
right for a new and a returning account alike.

**Two Google flows, one OAuth client, deliberately separate.** Signing in asks for
`openid email profile` at `/api/auth/google`; sending asks for `gmail.send` at
`/api/integrations/google`. Keeping them apart means signing in never requests mailbox
access, and the app is not blocked on Google verification of a restricted scope just to
offer a login button. Both are built by `googleOAuthClient()` in `lib/google-oauth.ts` so
they cannot drift on credentials. Register **both** redirect URIs in the Google console.

The sign-in callback **verifies the `state` parameter against a short-lived cookie before
anything else**. Without that check the endpoint is a login-CSRF hole: anyone could feed it
a code and sign a visitor into an account they control. Identities are stored in
`oauth_accounts` under provider `"google-login"`, distinct from the `"google"` rows that
hold send credentials. A Google sign-in whose address matches an existing password account
**links** to it rather than creating a duplicate.

**Tenant isolation is per-query, not ambient.** The `user_id` filters that were cosmetic
before are now the boundary. Two were missing and were fixed here: `loadMessages` joins
through `conversations` (messages carry no `user_id`, so a guessed UUID used to be readable),
and `ensureConversation` returns false when the posted id belongs to someone else, which the
chat route turns into a 404 — the client mints conversation ids, so nothing else stops a
posted id from appending to another account's thread.

### Known follow-ups

- **No email verification, no password reset, and no rate limiting on `/api/auth/signin`.**
  Rate limiting is the first thing to add before this is exposed publicly.
- Rows written before accounts existed still carry `user_id = 'local-user'` and are invisible
  to every real account. Delete them, then add `user_id` foreign keys to `users.id` with
  `on delete cascade` — the constraint cannot be applied while those orphans exist.
- Expired `sessions` rows are never swept. A job for the pg-boss worker below.
- **Assistant replies are not persisted.** Only user messages reach the `messages` table;
  the write in `streamText`'s `onFinish` does not land, and this predates the auth work
  (no assistant row exists in the database at all). Reloading a thread shows only what the
  user typed. Not yet diagnosed.
- Long-running work (outreach sequences, scheduled sends, enrichment) must not live in route
  handlers. A separate worker process is needed — pg-boss on the same Postgres is the
  expected choice.
- 4 moderate dev-only npm advisories remain via `drizzle-kit`'s deprecated `@esbuild-kit/*`
  dependencies. Not shipped, not reachable at runtime.
- Assistant messages render as plain text. Markdown rendering is not implemented.
- Conversation titles are truncated from the first user message, not model-generated.
- Hosting target is undecided; nothing in the code assumes one.
- **`.env.example` previously contained a live `GOOGLE_GENERATIVE_AI_API_KEY`.** It has been
  replaced with a placeholder, but that key was committed and should be rotated at
  https://aistudio.google.com/apikey.
- Approving a plan card posts to `/api/plans/[id]` and then sends a short user message to
  hand control back to the model, because a tool result alone cannot resume a finished
  stream. If the AI SDK gains native tool approval resumption, replace that message.
- Memory dedupe is a word-set fingerprint, so it catches exact and reordered repeats but not
  paraphrases ("4 sentences" vs "four sentences"). Embeddings would fix it if it becomes a
  nuisance.
- Entity dedupe does one lookup per record. Fine at a 25-row batch cap; batch it if the cap
  ever rises.
- `enrichContact` and `sendEmail` still run inside the chat request. `maxDuration` is 300s,
  which covers the current batch caps, but scheduled sends and multi-touch sequences are
  what pg-boss is for.
