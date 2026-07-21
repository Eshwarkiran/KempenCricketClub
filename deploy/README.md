# Deployment — Azure Container Apps + GitHub Actions (OIDC)

CI/CD for the Kempen Cricket Club site. Two branches map to two Azure
environments:

| Branch | GitHub Environment | Azure Container App |
|--------|--------------------|---------------------|
| `dev`  | `dev`              | e.g. `kcc-dev`      |
| `main` | `prod`             | e.g. `kcc-prod`     |

Each Container App runs **two containers in one app**: `web` (nginx, ingress on
port 80) serves the Astro build and proxies `/api` to `api` (Azure Functions,
listening on 8080) over `localhost`. Images live in Azure Container Registry
(ACR). GitHub Actions logs in to Azure with **OIDC** (no stored cloud secret),
builds + pushes both images, and applies `deploy/containerapp.yaml`.

Pipeline files: `.github/workflows/deploy-dev.yml`, `deploy-prod.yml`, and the
shared `_deploy.yml`.

---

## 1. One-time Azure bootstrap

Run once per environment (repeat with `dev`/`prod` names). Requires the Azure CLI
and `az login` as an owner/contributor.

```bash
# ---- variables (edit these) ----
SUB=<subscription-id>
LOCATION=westeurope
RG=kcc-rg
ACR=kccacr$RANDOM          # must be globally unique, lowercase
ENVNAME=kcc-cae            # Container Apps environment
APP=kcc-dev                # kcc-dev for dev, kcc-prod for prod

az account set --subscription "$SUB"
# Register the resource providers this stack needs (one-time per subscription).
# Skipping these gives: "MissingSubscriptionRegistration ... namespace 'X'".
az provider register -n Microsoft.ContainerRegistry --wait
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait

# Resource group + ACR + Container Apps environment
az group create -n "$RG" -l "$LOCATION"
az acr create -n "$ACR" -g "$RG" --sku Basic
az containerapp env create -n "$ENVNAME" -g "$RG" -l "$LOCATION"
```

Note the outputs you'll need for GitHub:
- **ACR login server**: `az acr show -n "$ACR" --query loginServer -o tsv`
- **Managed environment id**: `az containerapp env show -n "$ENVNAME" -g "$RG" --query id -o tsv`

### OIDC app registration (GitHub → Azure, no secret)

```bash
APPREG=$(az ad app create --display-name "kcc-github-oidc" --query appId -o tsv)
az ad sp create --id "$APPREG"
SPOID=$(az ad sp show --id "$APPREG" --query id -o tsv)

# Let the pipeline push images and manage the container app
az role assignment create --assignee "$APPREG" --role AcrPush \
  --scope $(az acr show -n "$ACR" --query id -o tsv)
az role assignment create --assignee "$APPREG" --role Contributor \
  --scope $(az group show -n "$RG" --query id -o tsv)

# Federated credential per GitHub Environment.
# IMPORTANT: set REPO to your real owner/repo — the subject must match exactly
# what GitHub sends, or deploys fail with "AADSTS70021: No matching federated
# identity record found".
REPO=Eshwarkiran/KempenCricketClub

for ENV in dev prod; do
  az ad app federated-credential create --id "$APPREG" --parameters "{
    \"name\": \"github-env-$ENV\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:$REPO:environment:$ENV\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"
done

# Verify both subjects are correct (no <OWNER>/<REPO> placeholders left):
az ad app federated-credential list --id "$APPREG" --query "[].{name:name, subject:subject}" -o table
```

`AZURE_CLIENT_ID` = `$APPREG`, `AZURE_TENANT_ID` = `az account show --query tenantId -o tsv`,
`AZURE_SUBSCRIPTION_ID` = `$SUB`.

### Let the Container App pull from ACR

The app pulls images with its **system-assigned managed identity**. On the very
first deploy the app doesn't exist yet, so grant `AcrPull` right after the first
run creates it (then re-run the workflow):

```bash
PID=$(az containerapp show -n "$APP" -g "$RG" --query identity.principalId -o tsv)
az role assignment create --assignee "$PID" --role AcrPull \
  --scope $(az acr show -n "$ACR" --query id -o tsv)
```

### Azure SQL access

Enable **"Allow Azure services and resources to access this server"** on the SQL
server (Networking) so the Container App can connect, or add the environment's
outbound IPs. In production set `SQL_TRUST_CERT=false` (the Azure cert validates
normally; the `true` workaround was only for a local TLS-inspecting proxy).

---

## 2. GitHub configuration

Create two **Environments** (Settings → Environments): `dev` and `prod`. Set the
following on **each** environment.

### Secrets (sensitive)

| Secret | Notes |
|--------|-------|
| `AZURE_CLIENT_ID` | App registration (client) id |
| `AZURE_TENANT_ID` | Entra tenant id |
| `AZURE_SUBSCRIPTION_ID` | Subscription id |
| `SQL_PASSWORD` | DB password (quote-safe — no shell mangling needed in GitHub) |
| `BASIC_AUTH_PASSWORD` | Client credential; must match `CLIENT_PASS` below |
| `JWT_SECRET` | Long random, 32+ chars |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key |
| `SMTP_PASSWORD` | SMTP password (leave empty when using M365 OAuth2) |
| `MS_CLIENT_SECRET` | Entra app client secret (only for `SMTP_AUTH_TYPE=oauth2`) |
| `CLIENT_PASS` | Public client password baked into forms.js (kept in secrets so it isn't printed in logs) |

### Variables (non-sensitive)

| Variable | Example |
|----------|---------|
| `AZURE_LOCATION` | `westeurope` |
| `AZURE_RESOURCE_GROUP` | `kcc-rg` |
| `ACR_NAME` | `kccacr123` |
| `ACR_LOGIN_SERVER` | `kccacr123.azurecr.io` |
| `MANAGED_ENVIRONMENT_ID` | `/subscriptions/.../managedEnvironments/kcc-cae` |
| `CONTAINERAPP_NAME` | `kcc-dev` (or `kcc-prod`) |
| `SQL_SERVER` | `kcc-dbhost-server.database.windows.net` |
| `SQL_DATABASE` | `kcc_dev` (or your prod DB) |
| `SQL_USER` | `controller` |
| `SQL_TRUST_CERT` | `false` |
| `BASIC_AUTH_USER` | `KccFormsController` |
| `JWT_EXPIRES_IN` | `15m` |
| `TURNSTILE_SITE_KEY` | real site key (public) |
| `CLIENT_USER` | `KccFormsController` |
| `SITE_URL` | `https://kempencricket.be` (builds unsubscribe links) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_FROM` | mail config |
| `SMTP_AUTH_TYPE` | `basic` or `oauth2` (Microsoft 365) |
| `MS_TENANT_ID` / `MS_CLIENT_ID` | Entra app (only for `oauth2`) |

Values can differ per environment (e.g. dev vs prod DB, dev vs prod Turnstile keys).

---

## 3. How a deploy runs

1. Push to `dev` (or `main`) → the matching workflow runs.
2. OIDC login to Azure, `az acr login`.
3. Build & push `kcc-api` and `kcc-web` images tagged `<env>-<sha>`. The web
   build bakes `TURNSTILE_SITE_KEY` / `CLIENT_USER` / `CLIENT_PASS` into
   `forms.js` for that environment.
4. `deploy/containerapp.yaml` is rendered with the env's variables/secrets and
   applied with `az containerapp create|update`.
5. The job prints the app FQDN.

Trigger a deploy manually from the Actions tab (`workflow_dispatch`) too.

---

## 4. Microsoft 365 email (OAuth2)

Microsoft is retiring Basic auth / app passwords for SMTP AUTH, so M365 sending
uses **OAuth2 (XOAUTH2)** with an Entra app and client credentials.

1. Entra admin center → App registrations → **New registration** (e.g. `kcc-mailer`).
2. **API permissions** → Add → APIs my organization uses → *Office 365 Exchange
   Online* → Application permissions → **SMTP.SendAsApp** → then **Grant admin
   consent**.
3. **Certificates & secrets** → New client secret → copy the value.
4. Allow the app to send as the mailbox (Exchange Online PowerShell):

   ```powershell
   New-ServicePrincipal -AppId <MS_CLIENT_ID> -ObjectId <enterprise-app-object-id>
   Add-MailboxPermission -Identity "contact@kempencricket.be" `
     -User <enterprise-app-object-id> -AccessRights FullAccess
   ```

5. Ensure SMTP AUTH is enabled for that mailbox
   (`Set-CASMailbox -Identity contact@kempencricket.be -SmtpClientAuthenticationDisabled $false`).

Then set: `SMTP_AUTH_TYPE=oauth2`, `SMTP_HOST=smtp.office365.com`,
`SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=contact@kempencricket.be`,
`SMTP_FROM=Kempen Cricket Club <contact@kempencricket.be>`, plus `MS_TENANT_ID`,
`MS_CLIENT_ID` and the `MS_CLIENT_SECRET` secret. Leave `SMTP_PASSWORD` empty.

For any other provider (Gmail, Mailgun, Brevo…), keep `SMTP_AUTH_TYPE=basic`
and use `SMTP_USER` / `SMTP_PASSWORD`.

## 5. Notes

- The api and web containers share a network namespace in one app, so the api
  listens on **8080** (`ASPNETCORE_URLS`) and nginx proxies to `localhost:8080`
  via the `API_UPSTREAM` env var. Locally, docker-compose sets `API_UPSTREAM=api:8080`.
- Real secrets never enter the image: they're Container App secrets injected as
  env vars at runtime. Only the public frontend values are baked into `forms.js`.
- Point your DNS at the Container App FQDN (or add a custom domain + managed
  certificate on the prod app) and set the real Turnstile keys locked to that
  domain.
