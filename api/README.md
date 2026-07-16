# KCC Form APIs — Azure Functions + Azure SQL

Four endpoints backing the website forms, deployed automatically by Azure
Static Web Apps from this `api/` folder (Node.js v4 programming model).

| Endpoint         | Form            | Table            | Notes                          |
|------------------|-----------------|------------------|--------------------------------|
| `POST /api/join`     | /join (3 free sessions) | `dbo.members`  | stored as `member_type='trial'`   |
| `POST /api/register` | /register       | `dbo.members`    | stored as `member_type='regular'` |
| `POST /api/contact`  | /contact        | `dbo.contact`    | honeypot-protected             |
| `POST /api/subscribe`| footer signup   | `dbo.subscriber` | idempotent (MERGE on email)    |
| `POST /api/token`    | (auth)          | —                | issues a short-lived JWT       |

The four form endpoints require a **Bearer JWT** (`Authorization: Bearer <token>`)
and a JSON body. Obtain a token from `POST /api/token` by presenting the client
credentials (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`) either as a JSON body
`{ "username": …, "password": … }` or an HTTP Basic header. Tokens are HS256,
signed with `JWT_SECRET`, and expire after `JWT_EXPIRES_IN` (default 15m).

## Database setup (once)

1. `bash db/00_provision_azure.sh` — creates the SQL server + `KempenCricketClub` DB.
   (Azure rejects `root` as an admin login name — the script uses `kccroot`.)
2. Run `db/01_master_create_login.sql` against **master** — creates login `controller`.
3. Run `db/02_schema_and_user.sql` against **KempenCricketClub** — creates user
   `controller` (db_owner + CONTROL) and the three tables.

## Application settings (SWA → Configuration, or local.settings.json locally)

```
SQL_SERVER          = <server>.database.windows.net
SQL_DATABASE        = KempenCricketClub
SQL_USER            = controller
SQL_PASSWORD        = <controller password>
BASIC_AUTH_USER     = kccforms
BASIC_AUTH_PASSWORD = <strong value — must match CLIENT_PASS in forms.js>
JWT_SECRET          = <long random secret, min 32 chars — signs the tokens>
JWT_EXPIRES_IN      = 15m
```

Copy `local.settings.sample.json` → `local.settings.json` for local runs
(`npm install && func start` inside `api/`), or `swa start` from the repo root.

## Test

```bash
# 1. Get a token
TOKEN=$(curl -s -X POST https://<site>/api/token \
  -H "Content-Type: application/json" \
  -d '{"username":"kccforms","password":"<password>"}' | jq -r .token)

# 2. Call an endpoint with it
curl -i -X POST https://<site>/api/subscribe \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","lang":"en"}'
```

Expected: `200 {"success":true}`. Without a valid token: `401`.

## Security notes

- The client credential is embedded in the public site JS (`forms.js`) and is
  exchanged for a short-lived JWT at `/api/token`, so it only deters casual/bot
  abuse — it is **not a secret**. Do NOT reuse the SQL passwords for it.
  `JWT_SECRET` **is** a secret: keep it only in SWA app settings / Key Vault,
  make it long and random, and rotate it to invalidate all outstanding tokens.
  Rotate the SQL passwords before go-live since they have been shared in plain
  text, and store them in SWA app settings / Key Vault only.
- `members` holds GDPR-sensitive data (national register no., medical notes).
  Restrict who can query the DB; consider column-level encryption later.
