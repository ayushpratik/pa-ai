# Deploy to Ubuntu with Podman - https://pa-ai.kishul.com

Server: `root@147.182.228.207` (Ubuntu, nginx already installed for other sites).

Why the image is built on the server: your Mac is ARM64 and the server is x86_64. Building
the amd64 image on the Mac runs under qemu emulation, and `next build` crashes there with
`qemu: uncaught target signal 11 (Segmentation fault)`. Building on the server is native, so
that problem does not exist. No Podman is needed on your Mac at all.

How it works:

1. You upload the source code to the server with `rsync`.
2. The server builds the images with Podman (native x86_64).
3. Podman runs one **pod** containing Postgres and the app. Containers in a pod share
   `localhost`, so the app reaches the database at `127.0.0.1:5432` with no network setup.
4. nginx terminates TLS and proxies `pa-ai.kishul.com` to the app on `127.0.0.1:3010`.

Each block is labelled **[MAC]** (your laptop) or **[SERVER]** (after `ssh`). Copy and paste
one block at a time and check the output before moving on.

---

## Step 1 - DNS (do this first, it takes time to propagate)

At your DNS provider for `kishul.com`, add:

| Type | Name  | Value           |
| ---- | ----- | --------------- |
| A    | pa-ai | 147.182.228.207 |

**[MAC]** Check it (should print `147.182.228.207`):

```bash
dig +short pa-ai.kishul.com
```

---

## Step 2 - Log in and prepare the server

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

If it says `inactive`, enable it (SSH is allowed first so you are not locked out). If it is
already `active`, just run the three `allow` lines.

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Check that port 3010 is free (if something is listed, pick another port and use it in
Step 6 and Step 8):

```bash
ss -tlnp | grep ':3010' || echo "3010 is free"
```

---

## Step 3 - Install Podman and add swap

**[SERVER]**

```bash
apt install -y podman
podman --version
systemctl enable --now podman-restart.service
```

`podman-restart.service` is what brings the containers back after a server reboot.

`next build` needs about 4 GB of memory. Check what the server has:

```bash
free -m
```

If `total` memory plus `Swap` is under about 4500, add a 4 GB swap file (safe to do even if
you have enough; skip it if `Swap` already shows 2000 or more):

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -m
```

---

## Step 4 - Upload the source code

**[SERVER]** Create the folder, then leave the server with `exit`:

```bash
mkdir -p ~/sales-ai/src-build
exit
```

**[MAC]** Upload the project. This skips `node_modules`, `.next`, git history and every
`.env` file (secrets are created on the server in the next step):

```bash
cd /Users/ayushpratik/Desktop/kishul/sales-approach-ai

rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude env.txt --exclude .DS_Store \
  ./ root@147.182.228.207:~/sales-ai/src-build/
```

Log back in:

```bash
ssh root@147.182.228.207
```

---

## Step 5 - Create the environment file

**[SERVER]** Generate the secrets once and keep them in shell variables. The database
password is hex on purpose, so it is safe inside the `DATABASE_URL`:

```bash
cd ~/sales-ai
PGPASS=$(openssl rand -hex 16)
AUTHSECRET=$(openssl rand -base64 32)
```

Write the file. Replace `PASTE_YOUR_GEMINI_KEY_HERE` first, or fix it afterwards with
`nano ~/sales-ai/.env`. Values must have no quotes (the file is read as plain `KEY=value`).

```bash
cat > ~/sales-ai/.env <<EOF
# --- Required ---
GOOGLE_GENERATIVE_AI_API_KEY=PASTE_YOUR_GEMINI_KEY_HERE
GEMINI_MODEL=gemini-3.5-flash-lite
AUTH_SECRET=${AUTHSECRET}
APP_URL=https://pa-ai.kishul.com

# --- Postgres (used by the db container and by the app) ---
POSTGRES_USER=sales_ai
POSTGRES_PASSWORD=${PGPASS}
POSTGRES_DB=sales_ai
DATABASE_URL=postgresql://sales_ai:${PGPASS}@127.0.0.1:5432/sales_ai

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
chmod 600 ~/sales-ai/.env
```

Check the key line:

```bash
grep GOOGLE_GENERATIVE_AI_API_KEY ~/sales-ai/.env
```

If it still says `PASTE_YOUR_GEMINI_KEY_HERE`: `nano ~/sales-ai/.env`, edit, save with
`Ctrl+O`, `Enter`, `Ctrl+X`.

Keep `SEND_EMAIL=none` until everything works. `test` sends everything to
`TEST_EMAIL_RECIPIENT`; `send` emails real people.

---

## Step 6 - Build the images, create the pod, start Postgres

**[SERVER]**

```bash
cd ~/sales-ai/src-build
podman build --target runner   -t localhost/sales-ai:latest .
podman build --target migrator -t localhost/sales-ai-migrate:latest .
podman images | grep sales-ai
```

The first build takes a few minutes. If it dies with `signal SIGKILL` it ran out of memory:
revisit the swap in Step 3.

Create the pod. Only the app port is published, and only on loopback (change `3010` here if
you picked another port in Step 4):

```bash
podman pod create --name sales-ai -p 127.0.0.1:3010:3001
```

Start Postgres inside the pod. Data lives in the named volume `sales-ai-pgdata`, so it
survives container and image replacement:

```bash
podman run -d --name sales-ai-db --pod sales-ai \
  --restart=always \
  --env-file ~/sales-ai/.env \
  -v sales-ai-pgdata:/var/lib/postgresql/data \
  docker.io/library/postgres:16-alpine
```

Wait until it is ready (prints `accepting connections`):

```bash
until podman exec sales-ai-db pg_isready -U sales_ai -d sales_ai; do sleep 2; done
```

---

## Step 7 - Run migrations, then start the app

**[SERVER]**

```bash
podman run --rm --pod sales-ai --env-file ~/sales-ai/.env localhost/sales-ai-migrate:latest
```

Start the app:

```bash
podman run -d --name sales-ai-app --pod sales-ai \
  --restart=always \
  --env-file ~/sales-ai/.env \
  localhost/sales-ai:latest
```

Check it (expect a `307` redirect to `/login`, or `200`):

```bash
sleep 5
podman ps
curl -I http://127.0.0.1:3010
podman logs --tail 30 sales-ai-app
```

---

## Step 8 - nginx for pa-ai.kishul.com

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

        # Required: the chat reply is streamed. Without this it arrives in one lump.
        proxy_buffering off;
        # Required: nginx's 60s default would cut a long turn off mid-stream.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

ln -s /etc/nginx/sites-available/pa-ai.kishul.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Step 9 - HTTPS certificate

DNS from Step 1 must already point at the server. **[SERVER]**:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d pa-ai.kishul.com
```

Answer the email prompt, accept the terms, and choose to redirect HTTP to HTTPS. Certbot
renews automatically; check with `certbot renew --dry-run`.

Open https://pa-ai.kishul.com, sign up at `/signup`, and fill in the profile.

If you use Google sign-in, register both redirect URIs in the Google Cloud console (they
must match `.env` exactly):

- `https://pa-ai.kishul.com/api/auth/google/callback`
- `https://pa-ai.kishul.com/api/integrations/google/callback`

---

## Step 10 - Survive reboots (check once)

**[SERVER]**

```bash
systemctl is-enabled podman-restart.service
reboot
```

Wait a minute, `ssh` back in, then:

```bash
podman ps
curl -I http://127.0.0.1:3010
```

Both containers should be `Up`. If the pod did not come back, run
`podman pod start sales-ai`.

---

## Releasing an update later

**[MAC]** Upload the changed source (same command as Step 4):

```bash
cd /Users/ayushpratik/Desktop/kishul/sales-approach-ai

rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude env.txt --exclude .DS_Store \
  ./ root@147.182.228.207:~/sales-ai/src-build/
```

**[SERVER]** Rebuild, migrate, and replace only the app container (Postgres keeps running):

```bash
ssh root@147.182.228.207

cd ~/sales-ai/src-build
podman build --target runner   -t localhost/sales-ai:latest .
podman build --target migrator -t localhost/sales-ai-migrate:latest .

podman run --rm --pod sales-ai --env-file ~/sales-ai/.env localhost/sales-ai-migrate:latest

podman rm -f sales-ai-app
podman run -d --name sales-ai-app --pod sales-ai \
  --restart=always \
  --env-file ~/sales-ai/.env \
  localhost/sales-ai:latest

podman image prune -f
podman logs --tail 20 sales-ai-app
```

---

## Useful commands

**[SERVER]**

```bash
podman ps                                  # what is running
podman logs -f sales-ai-app                # follow app logs (Ctrl+C to stop)
podman logs --tail 50 sales-ai-db          # database logs
podman restart sales-ai-app                # restart the app
podman pod stop sales-ai                   # stop everything
podman pod start sales-ai                  # start everything
podman exec -it sales-ai-db psql -U sales_ai -d sales_ai   # open a SQL shell
nano ~/sales-ai/.env                    # edit config, then recreate the app container
```

Env changes only apply when the container is recreated (`podman rm -f sales-ai-app`, then
the `podman run` from Step 7). If you change `POSTGRES_*` after the first start it has no
effect on the existing database volume.

Back up the database:

```bash
podman exec sales-ai-db pg_dump -U sales_ai sales_ai | gzip > ~/sales-ai/backup-$(date +%F).sql.gz
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `qemu ... Segmentation fault` during build | You are building on the Mac. Build on the server instead (Step 6) |
| Server build dies with `signal SIGKILL` or `out of memory` | Add swap (Step 3) and build again |
| Migration says `ECONNREFUSED` | Postgres is not ready yet. Re-run the `pg_isready` loop in Step 6, then migrate again |
| `curl 127.0.0.1:3010` is refused | `podman ps` and `podman logs sales-ai-app`. A missing or wrong `.env` value is the usual cause |
| Port 3010 already in use | Pick another port, then `podman pod rm -f sales-ai` and redo Steps 6-7 with it, and fix nginx |
| Replies appear all at once instead of streaming | `proxy_buffering off` is missing from the nginx block |
| 504 in the middle of a long answer | `proxy_read_timeout 300s` is missing from the nginx block |
| certbot fails | DNS has not propagated (Step 1), or port 80 is blocked in `ufw` |
| Google sign-in says `redirect_uri_mismatch` | The URIs in the Google console must match the two in `.env` exactly, https included |
| Containers gone after reboot | `systemctl enable --now podman-restart.service`, then `podman pod start sales-ai` |
