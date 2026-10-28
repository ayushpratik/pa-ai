# Deploy to Ubuntu with Docker - https://pa-ai.kishul.com

Server: `root@147.182.228.207` (Ubuntu, nginx already installed for other sites).

How it works: you build the images on your Mac for `linux/amd64`, upload them with `scp`,
and run them on the server with Docker Compose (app + Postgres). nginx terminates TLS and
proxies to the app on `127.0.0.1:3010`.

Each block is labelled **[MAC]** (your laptop) or **[SERVER]** (after `ssh`). Copy and paste
one block at a time.

---

## Step 1 - DNS (do this first, it takes time to propagate)

At your DNS provider for `kishul.com`, add:

| Type | Name   | Value             |
| ---- | ------ | ----------------- |
| A    | pa-ai  | 147.182.228.207   |

**[MAC]** Check it (should print `147.182.228.207`):

```bash
dig +short pa-ai.kishul.com
```

---

## Step 2 - Build the images for amd64

**[MAC]** Make sure Docker Desktop is running, then from the project folder:

```bash
cd /Users/ayushpratik/Desktop/kishul/sales-approach-ai

docker buildx build --platform linux/amd64 --target runner   -t sales-ai:latest         --load .
docker buildx build --platform linux/amd64 --target migrator -t sales-ai-migrate:latest --load .
```

Confirm the architecture (both should print `amd64`):

```bash
docker image inspect sales-ai:latest sales-ai-migrate:latest --format '{{.Architecture}}'
```

---

## Step 3 - Export the images and upload them

**[MAC]**

```bash
docker save sales-ai:latest sales-ai-migrate:latest | gzip > sales-ai-images.tar.gz
ls -lh sales-ai-images.tar.gz
```

Create the folder on the server, then upload the images and the compose file:

```bash
ssh root@147.182.228.207 "mkdir -p /opt/sales-ai"
scp sales-ai-images.tar.gz docker-compose.yml root@147.182.228.207:/opt/sales-ai/
```

---

## Step 4 - Log in and prepare the server

**[MAC]**

```bash
ssh root@147.182.228.207
```

**[SERVER]** Update packages:

```bash
apt update && apt upgrade -y
```

Firewall. Check first so you do not break your other sites:

```bash
ufw status
```

If it says `inactive`, enable it with SSH and web ports allowed (ssh is allowed first so you
are not locked out). If it is already `active`, just run the three `allow` lines.

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Check that port 3010 is free (no output means free; if something is listed, pick another
port and use it in Step 7 and Step 9):

```bash
ss -tlnp | grep ':3010' || echo "3010 is free"
```

---

## Step 5 - Install Docker (skip if `docker --version` already works)

**[SERVER]**

```bash
docker --version && docker compose version
```

If that fails, install Docker Engine and the compose plugin:

```bash
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker run --rm hello-world
```

---

## Step 6 - Create the environment file

**[SERVER]** Generate the secrets once and keep them in shell variables:

```bash
cd /opt/sales-ai
PGPASS=$(openssl rand -hex 16)
AUTHSECRET=$(openssl rand -base64 32)
```

Write the file. **Edit the `GOOGLE_GENERATIVE_AI_API_KEY` line** (and the optional keys) before
running this, or edit the file afterwards with `nano /opt/sales-ai/.env`:

```bash
cat > /opt/sales-ai/.env <<EOF
# --- Required ---
GOOGLE_GENERATIVE_AI_API_KEY=PASTE_YOUR_GEMINI_KEY_HERE
GEMINI_MODEL=gemini-3.5-flash-lite
AUTH_SECRET=${AUTHSECRET}
APP_URL=https://pa-ai.kishul.com

# --- Postgres (used by the db container and by the app) ---
POSTGRES_USER=sales_ai
POSTGRES_PASSWORD=${PGPASS}
POSTGRES_DB=sales_ai
DATABASE_URL=postgresql://sales_ai:${PGPASS}@db:5432/sales_ai

# --- Optional: web search (without it the assistant cannot research) ---
SEARCH_API_KEY=
# --- Optional: Apollo tools (not registered when blank) ---
APOLLO_API_KEY=

# --- Email. SEND_EMAIL=none means drafts only, nothing is delivered ---
SEND_EMAIL=none
TEST_EMAIL_RECIPIENT=
EMAIL_TRANSPORT=auto
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_SECURE=false

# --- Optional: Google sign-in / Gmail sending (buttons hidden when blank) ---
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://pa-ai.kishul.com/api/integrations/google/callback
GOOGLE_LOGIN_REDIRECT_URI=https://pa-ai.kishul.com/api/auth/google/callback
EOF
chmod 600 /opt/sales-ai/.env
```

Check the key line is filled in:

```bash
grep GOOGLE_GENERATIVE_AI_API_KEY /opt/sales-ai/.env
```

If not: `nano /opt/sales-ai/.env`, edit, save with `Ctrl+O`, `Enter`, `Ctrl+X`.

Keep `SEND_EMAIL=none` until everything works. `test` sends everything to
`TEST_EMAIL_RECIPIENT`; `send` emails real people.

---

## Step 7 - Load the images and start the database

**[SERVER]** (`docker-compose.yml` was uploaded in Step 3)

```bash
cd /opt/sales-ai
gunzip -c sales-ai-images.tar.gz | docker load
docker images | grep sales-ai
docker compose up -d db
docker compose ps
```

Wait until `db` shows `healthy` (a few seconds; re-run `docker compose ps`).

---

## Step 8 - Run migrations, then start the app

**[SERVER]**

```bash
cd /opt/sales-ai
docker compose run --rm migrate
docker compose up -d app
docker compose ps
```

Check the app responds locally (expect `HTTP/1.1 307` redirect to `/login`, or 200):

```bash
curl -I http://127.0.0.1:3010
docker compose logs --tail 30 app
```

---

## Step 9 - nginx for pa-ai.kishul.com

**[SERVER]**

```bash
cat > /etc/nginx/sites-available/pa-ai.kishul.com <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name pa-ai.kishul.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Both are required: without buffering off the streamed chat reply arrives
        # in one lump; the default 60s read timeout cuts long turns off mid-stream.
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pa-ai.kishul.com /etc/nginx/sites-enabled/pa-ai.kishul.com
nginx -t && systemctl reload nginx
```

Test over plain HTTP (DNS from Step 1 must have propagated):

```bash
curl -I http://pa-ai.kishul.com
```

---

## Step 10 - HTTPS with Let's Encrypt

**[SERVER]**

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d pa-ai.kishul.com
```

Give your email, accept the terms, and choose to redirect HTTP to HTTPS when asked. Then:

```bash
certbot renew --dry-run
curl -I https://pa-ai.kishul.com
```

---

## Step 11 - Google OAuth (only if you filled in the Google client id/secret)

In https://console.cloud.google.com -> your OAuth client, add both authorized redirect URIs:

```
https://pa-ai.kishul.com/api/auth/google/callback
https://pa-ai.kishul.com/api/integrations/google/callback
```

Then restart the app so it picks up any `.env` edits:

```bash
cd /opt/sales-ai && docker compose up -d --force-recreate app
```

---

## Step 12 - First use

Open https://pa-ai.kishul.com, go to **Sign up**, create your account, then fill in the
profile form (name, role, company, sending email). After that the assistant is available.

---

## Redeploying a new version

**[MAC]**

```bash
cd /Users/ayushpratik/Desktop/kishul/sales-approach-ai
docker buildx build --platform linux/amd64 --target runner   -t sales-ai:latest         --load .
docker buildx build --platform linux/amd64 --target migrator -t sales-ai-migrate:latest --load .
docker save sales-ai:latest sales-ai-migrate:latest | gzip > sales-ai-images.tar.gz
scp sales-ai-images.tar.gz docker-compose.yml root@147.182.228.207:/opt/sales-ai/
```

**[SERVER]**

```bash
ssh root@147.182.228.207
cd /opt/sales-ai
gunzip -c sales-ai-images.tar.gz | docker load
docker compose run --rm migrate
docker compose up -d app
docker image prune -f
```

---

## Everyday commands (on the server, in `/opt/sales-ai`)

```bash
docker compose ps                      # status
docker compose logs -f app             # live app logs (Ctrl+C to stop)
docker compose restart app             # restart the app
docker compose down                    # stop everything (data is kept in the volume)
docker compose up -d                   # start everything again
```

Database backup:

```bash
docker compose exec -T db pg_dump -U sales_ai sales_ai | gzip > /root/sales_ai_$(date +%F).sql.gz
```

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `exec format error` in app logs | Image built for the wrong CPU. Rebuild with `--platform linux/amd64` (Step 2). |
| nginx `502 Bad Gateway` | App not running or wrong port. `docker compose ps`, `curl -I http://127.0.0.1:3010`, check the port in Step 9 matches compose. |
| Migration fails with connection refused / auth failed | `db` not healthy yet, or `DATABASE_URL` password differs from `POSTGRES_PASSWORD`. If you changed the password after the first start, either reset the volume (`docker compose down -v`, **deletes data**) or run `ALTER USER` inside the db. |
| `AUTH_SECRET` errors on start | Missing in `.env`. Changing it later signs everyone out. |
| Chat reply appears all at once / cuts off | `proxy_buffering off` and `proxy_read_timeout 300s` missing from the nginx block. |
| Google `redirect_uri_mismatch` | Step 11 URIs not added, or `APP_URL` / redirect vars in `.env` do not match exactly. Recreate the app after editing. |
| certbot fails | DNS not pointing at the server yet (Step 1), or port 80 blocked by the firewall. |
| `.env` edits not applied | `docker compose up -d --force-recreate app` (a plain restart keeps the old values). |
