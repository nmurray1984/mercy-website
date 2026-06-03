# Deploying to Fly.io (dev / test / prod)

Each environment is its own Fly app with its own volume and secrets:

| Environment | Fly app               | Deploys when                          | Config         |
|-------------|-----------------------|---------------------------------------|----------------|
| dev         | `mercy-website-dev`   | push to `develop`                     | `fly.dev.toml` |
| test        | `mercy-website-test`  | push to `main`                        | `fly.test.toml`|
| prod        | `mercy-website-prod`  | push a `v*` tag (after approval)      | `fly.prod.toml`|

Deploys run on GitHub Actions via `flyctl deploy --remote-only` (the image is
built on Fly's builders — no Docker needed in CI). The reusable workflow lives
in `.github/workflows/fly-deploy.yml`; the three triggers are `deploy-dev.yml`,
`deploy-test.yml`, `deploy-prod.yml`.

## Why single-machine

The app uses SQLite plus local files (uploads and the generated `public/`
site), all stored on a Fly **volume** at `/data`. A volume is tied to one
machine, so each app must run exactly **one** machine. Don't `scale count` above
1. (Dev/test scale to zero when idle; prod stays always-on.)

## One-time setup (run locally with flyctl, once per environment)

Install flyctl and `fly auth login`, then for **each** of dev/test/prod —
example shown for dev:

```bash
APP=mercy-website-dev   # then repeat with -test and -prod

# 1. Create the app (no deploy yet)
fly apps create "$APP"

# 2. Create the persistent volume in the same region as the config (ord)
fly volumes create mercy_data --app "$APP" --region ord --size 1 --yes

# 3. Set the runtime secrets (generate fresh per environment)
fly secrets set --app "$APP" \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  CSRF_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"

# 4. Create a scoped deploy token for GitHub Actions (copy the output)
fly tokens create deploy -a "$APP"
```

Everything else (PORT, NODE_ENV, COOKIE_SECURE, TRUST_PROXY, DATABASE_PATH,
PUBLIC_DIR, UPLOAD_DIR) is non-secret and lives in the `[env]` block of each
`fly.<env>.toml`.

## GitHub setup (once)

In the repo: **Settings → Environments**, create `dev`, `test`, and `prod`.

- For **each** environment, add a secret named `FLY_API_TOKEN` with that app's
  deploy token from step 4 above. (Environment-scoped, so dev can never deploy
  prod.)
- For **prod**, also add a **required reviewer** under "Deployment protection
  rules". The prod deploy job will then pause for your approval before it runs.

## First deploy & first admin user

The container migrates, seeds, and builds the site on every boot (idempotent),
so the first deploy stands the site up on its own. Then create the first
superuser per environment via an SSH session (it prompts for a password):

```bash
fly ssh console -a mercy-website-dev
# inside the machine:
node bin/create-user.js --email you@example.com --role superuser
exit
```

Admin UI is at `https://mercy-website-dev.fly.dev/admin`.

## Day-to-day

- Work on `develop` → merges/pushes auto-deploy **dev**.
- Promote to **test** by merging `develop` → `main`.
- Release to **prod** by tagging: `git tag v1.0.0 && git push origin v1.0.0`,
  then approve the deploy in the Actions run.
- Manual redeploy of any environment: **Actions → Deploy \<env\> → Run workflow**.
