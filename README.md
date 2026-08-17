# Sales AI

A research-and-outreach assistant. It asks what it needs, proposes a plan for your
approval, executes it with tools (web and Apollo research, entity storage, drafting,
email sending), and learns your preferences over time.

The assistant is deliberately domain-agnostic — sales outreach is the first use case,
not the only one. The domain lives in your profile and in learned memories, not in the
schema or the prompt.

Stack: Next.js 16 (App Router) + React 19 + TypeScript, Vercel AI SDK v6 with Gemini,
PostgreSQL + Drizzle ORM, Tailwind v4 + shadcn/ui, nodemailer / Gmail API for sending.

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20.9+ | `node --env-file` is used by the db scripts; Node 20+ is required |
| PostgreSQL 14+ | Any Postgres works — local, RDS, Neon, Supabase, Railway |
| A Gemini API key | Free tier is enough to start: https://aistudio.google.com/apikey |

Everything else (web search, Apollo, email sending, Google sign-in) is optional and
degrades cleanly — see [What each variable does](#3-what-each-variable-does).

---

## 2. Quick start (local)

```bash
git clone <repo-url> sales-ai
cd sales-ai
npm install

cp .env.example .env.local

# Required values
openssl rand -base64 32          # paste the output into AUTH_SECRET in .env.local
createdb sales_ai                # or point DATABASE_URL at an existing database

npm run db:migrate               # create the tables
npm run check:model              # confirm GEMINI_MODEL exists on the live API
npm run dev
```

Then open http://localhost:3000, sign up at `/signup`, and fill in the profile the app
asks for. The assistant reads that profile on every request, so it will not let you into
the chat until the four required fields are filled.

`.env.local` must exist for the `db:*` and `check:model` scripts — they load it with
`node --env-file`.

---

## 3. What each variable does

Copy `.env.example` to `.env.local` (local) or paste the same keys into your host's
environment settings (production).

### Required — the app will not start without these

| Variable | Value | Notes |
| --- | --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key | https://aistudio.google.com/apikey |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/sales_ai` | Add `?sslmode=require` for most hosted Postgres |
| `AUTH_SECRET` | `openssl rand -base64 32` | Pepper for session tokens. Rotating it signs **everyone** out — that is the intended emergency lever |

### Strongly recommended

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model ids change between releases. Always confirm with `npm run check:model` rather than assuming |
| `APP_URL` | `http://localhost:3000` | Your public origin. Used to build the OAuth redirect URIs when they are not set explicitly. **Set this in production** |

### Optional — each one unlocks a capability

| Variable | Effect when missing |
| --- | --- |
| `SEARCH_API_KEY` (Serper.dev) | `searchWeb` returns a setup message and the assistant says it cannot research |
| `APOLLO_API_KEY` | The `searchApollo` and `enrichContact` tools are not registered at all; the assistant falls back to web research |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | SMTP is treated as unconfigured (**all three** are required); `EMAIL_TRANSPORT=auto` falls through to Gmail |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | The "Connect Google" button and the "Continue with Google" sign-in button are both hidden. Email/password sign-in still works |
| `SEND_EMAIL` | Treated as `none` — drafts only, nothing is delivered |

### Email configuration

```
EMAIL_TRANSPORT=auto        # auto | smtp | gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=<app password>
SMTP_FROM=                  # optional, defaults to SMTP_USER
SMTP_SECURE=false           # implicit TLS is assumed on port 465 regardless
```

`auto` prefers SMTP because it needs no interactive consent, then falls back to a
connected Google account. For local work SMTP is the quicker path: with a Gmail account
use `smtp.gmail.com:587` and an **App Password** (not the account password), which
requires 2-Step Verification on the account.

### The outbound guard — read this before deploying

`SEND_EMAIL` guards every outbound message and is enforced in exactly one place
(`lib/mailer.ts`, above both transports):

| Value | Behaviour |
| --- | --- |
| `none` | **Default.** Draft and log only. Nothing is delivered. Also the fallback for a missing or invalid value |
| `test` | Every recipient is rewritten to `TEST_EMAIL_RECIPIENT`; the real address is kept in the subject prefix and in `outreach.metadata` |
| `send` | Real recipients. Only set this when you mean it |

`TEST_EMAIL_RECIPIENT` must be set whenever `SEND_EMAIL=test`.

---

## 4. Database setup

The schema lives in [src/db/schema.ts](src/db/schema.ts) and migrations are generated
into [drizzle/](drizzle/) and committed. You do not write SQL by hand.

```bash
npm run db:migrate     # apply pending migrations (run this on every deploy)
npm run db:generate    # regenerate a migration after editing src/db/schema.ts
npm run db:studio      # browse the data in Drizzle Studio
```

Tables created: `users`, `sessions`, `oauth_accounts`, `conversations`, `messages`,
`user_profile`, `memories`, `entities`, `entity_lists`, `entity_list_items`, `outreach`,
`plans`.

**Local**

```bash
createdb sales_ai
# DATABASE_URL=postgresql://localhost:5432/sales_ai
npm run db:migrate
```

**Hosted Postgres (Neon / Supabase / RDS / Railway)**

Create the database, copy its connection string into `DATABASE_URL`, and append
`?sslmode=require` if the provider requires TLS (most managed providers do). Then run
the migration against it once, before the first deploy:

```bash
DATABASE_URL='postgresql://...?sslmode=require' \
  npx drizzle-kit migrate
```

Note the `npm run db:migrate` script uses `node --env-file=.env.local`, which is a local
convenience. In CI or on a server, call `npx drizzle-kit migrate` directly with
`DATABASE_URL` in the environment, as above.

The Postgres client is pooled at `max: 10` connections
([src/db/index.ts](src/db/index.ts)). If you deploy to a serverless platform, put a
pooler in front of the database (Neon's pooled endpoint, Supabase's pgBouncer port, or
RDS Proxy) — otherwise concurrent lambdas will exhaust the connection limit.

---

## 5. Google OAuth setup (optional)

One OAuth client serves two deliberately separate flows:

- **Sign in with Google** — scopes `openid email profile`, callback
  `/api/auth/google/callback`
- **Connect Google for sending** — scope `gmail.send`, callback
  `/api/integrations/google/callback`

Keeping them apart means signing in never asks for mailbox access, and offering a login
button does not block you on Google's verification review of a restricted scope.

1. Go to https://console.cloud.google.com → APIs & Services → Credentials.
2. Create an **OAuth client ID** of type *Web application*.
3. Register **both** redirect URIs:
   - `https://your-domain.com/api/auth/google/callback`
   - `https://your-domain.com/api/integrations/google/callback`
4. Enable the **Gmail API** for the project if you want the sending flow.
5. Put the client id and secret into `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, and set
   `GOOGLE_LOGIN_REDIRECT_URI` and `GOOGLE_OAUTH_REDIRECT_URI` to the two URLs above.

If those two redirect variables are left blank they are derived from `APP_URL`, so
setting `APP_URL` correctly is usually enough.

Using `gmail.send` beyond your own test users requires Google's OAuth verification.
Until then, add the intended accounts as **test users** on the consent screen.

---

## 6. Deployment

The app is a standard Next.js 16 server application. Nothing in the code assumes a
particular host, but it **must run on a Node.js runtime** — API routes declare
`runtime = "nodejs"` because the Postgres driver needs Node APIs, and the chat route
declares `maxDuration = 300` because a research-and-send turn can run long.

### Build and run anywhere (VM, container, Render, Fly, Railway)

```bash
npm ci
npm run build
npm run start          # serves on $PORT, default 3000
```

Put a reverse proxy (nginx, Caddy, the platform's own) in front for TLS. Set every
variable from section 3 in the process environment — `.env.local` is not committed and
should not be shipped.

Deploy checklist for every release:

1. Set/refresh environment variables on the host.
2. Run `npx drizzle-kit migrate` against the production `DATABASE_URL`.
3. `npm run build && npm run start` (or redeploy the image).

### Dockerfile

There is no Dockerfile in the repo; this one works as a starting point:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

The build step does not need a Gemini key — `lib/model.ts` builds the provider lazily
precisely so `next build` works without one. It does not need `DATABASE_URL` either.

### Vercel

1. Import the repository; the framework preset is detected automatically.
2. Add every variable from section 3 under Project Settings → Environment Variables.
3. Point `DATABASE_URL` at a **pooled** connection string.
4. Run the migration yourself before the first deploy (see section 4) — the build does
   not run migrations.
5. Set `APP_URL` to the production domain and register that domain's two redirect URIs
   in the Google console.

Note that `maxDuration = 300` on the chat route exceeds the Hobby plan's function
timeout. A long research-and-send turn will be cut off there; Pro or a always-on Node
host avoids that.

---

## 7. Data you need to feed in, in order

1. **Environment** — the three required variables, plus whichever optional capabilities
   you want (section 3).
2. **Database** — run the migrations (section 4). No seed data is required; the app
   creates everything else as you use it.
3. **An account** — sign up at `/signup` with email and password, or with Google if the
   OAuth client is configured.
4. **The profile gate** — a new account is redirected to `/onboarding` and cannot use
   the assistant until these four fields are filled: **name, role, company, sending
   email** (`REQUIRED_PROFILE_FIELDS` in [src/lib/types.ts](src/lib/types.ts)). The
   sending email is the identity outbound mail is sent as.
5. **Optional: connect Google** in Settings if you want to send through Gmail rather
   than SMTP.
6. **Everything else is learned.** Domain knowledge — who you target, what your product
   is, tone, sequence preferences — is not configuration. Tell the assistant in chat and
   it stores it as a memory, which you can review and delete under Settings → Memories.

---

## 8. Operating notes

- **Approval is enforced in the database, not the prompt.** Tools that spend credits or
  contact a person (`enrichContact`, `sendEmail`) check for an approved `plans` row
  first. The model cannot self-approve.
- **Sessions are opaque database rows.** Only `sha256(token + AUTH_SECRET)` is stored, so
  a leaked `sessions` table cannot be replayed. Rotating `AUTH_SECRET` invalidates every
  session at once.
- **Expired `sessions` rows are never swept.** Add a periodic
  `DELETE FROM sessions WHERE expires_at < now()` until a worker exists.
- **Batch caps.** Tool batch sizes are clamped (default 10, max 25), which is what keeps
  a turn inside `maxDuration`.

### Known limitations before a public launch

- No email verification, no password reset, and **no rate limiting on
  `/api/auth/signin`** — rate limiting is the first thing to add before exposing this
  publicly.
- Long-running work (outreach sequences, scheduled sends, bulk enrichment) still runs
  inside the request handler. A separate worker process (pg-boss on the same Postgres)
  is the planned fix.
- Assistant replies are not yet persisted; reloading a thread shows only what you typed.
- Rows written before accounts existed carry `user_id = 'local-user'` and are invisible
  to real accounts. Delete them before adding foreign keys to `users.id`.
- `.env.example` previously contained a live `GOOGLE_GENERATIVE_AI_API_KEY`. It has been
  replaced with a placeholder, but **that key was committed and should be rotated** at
  https://aistudio.google.com/apikey.

---

## 9. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Missing required environment variable X` | Copy `.env.example` to `.env.local` and fill it in; in production set it on the host |
| `npm run db:migrate` cannot find the env file | The script reads `.env.local`. On a server use `DATABASE_URL=... npx drizzle-kit migrate` instead |
| Model errors on every chat turn | Run `npm run check:model` — the `GEMINI_MODEL` id is probably retired |
| Google button missing on the login page | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` are not set |
| `redirect_uri_mismatch` | The callback URL is not registered in the Google console, or `APP_URL` does not match the deployed domain |
| Emails drafted but never delivered | `SEND_EMAIL` is `none` (the default), or it holds an invalid value and fell back to `none` |
| Postgres "too many connections" on serverless | Use a pooled connection string (section 4) |
| Assistant says it cannot research | `SEARCH_API_KEY` is not set |

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run check:model` | Verify `GEMINI_MODEL` against the live `models.list` endpoint |

Architecture, conventions, and the reasoning behind the design decisions are documented
in [CLAUDE.md](CLAUDE.md).
