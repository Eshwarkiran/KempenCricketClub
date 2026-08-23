# KCC Form APIs — Azure Functions + Azure SQL

Four endpoints backing the website forms, deployed automatically by Azure
Static Web Apps from this `api/` folder (Node.js v4 programming model).

| Endpoint         | Form            | Table            | Notes                          |
|------------------|-----------------|------------------|--------------------------------|
| `POST /api/join`         | /join (3 free sessions) | `account`+`members` | `member_type='trial'`; captcha; auto-subscribes + confirmation + admin email |
| `POST /api/register`     | /register       | `account`+`members` | `member_type='regular'`; trial→regular upgrade; auto-subscribes + confirmation + admin email |
| `GET/POST /api/verify-member` | (email link) | `members` | approves a pending member (signed token); returns an HTML page |
| `POST /api/contact`      | /contact        | `dbo.contact`    | honeypot + captcha             |
| `POST /api/subscribe`    | footer signup   | `dbo.subscriber` | captcha; re-subscribe allowed after unsubscribe |
| `POST /api/unsubscribe`  | /unsubscribe    | `dbo.subscriber` | sets `unsubscribed_at`; always 200 |
| `POST /api/token`        | (auth)          | —                | issues a short-lived JWT       |

### Account + member model

Members live in two tables (see `sql/migrations/2026-07_account_member/`):
`account` (one row per email — shared phone/address + household consents) and
`members` (one row per person, `account_id` FK, `is_primary` marks the account
holder). Members also carry a `status` (`active` / `pending`). This lets a
household register several people under the same email and phone.

Adding people is done **only** through the join/register forms:

- **New email** → account + member created **active** (trial for join, regular
  for register) + confirmation email.
- **Same person** (existing email, matching name/dob — a trial has no dob yet) →
  the existing membership is **upgraded in place** (e.g. trial → regular). No
  approval needed; the account owner controls the email.
- **New person on an existing account** → inserted as **`status='pending'`** and
  an **approval link** is emailed to the account owner. `GET /api/verify-member`
  (opened from that link) activates the member, setting `member_type` from the
  form it came from (`register` → regular, else trial).

### Behaviour added on top of the basic inserts

- **Duplicate / pending.** Within an account a person is unique on
  `(first_name, last_name, dob)`. Register rejects an existing **active regular**
  member (`409 { code: "email_exists" }`); join rejects an existing same-name
  person. Contact/subscribe keep their own email rules.
- **Admin notifications.** Join and register email `ADMIN_EMAIL` (default
  `membership@kempencricket.be`) with the signup's details and whether it is
  active or pending approval. Best-effort.
- **Approval link.** Built from `SITE_URL`, signed (HMAC over email+member id via
  `JWT_SECRET`), expiring after `MEMBER_LINK_TTL_MIN` (default 24h). `verify-member`
  is not behind the Bearer JWT — the signed token authenticates it — and is
  idempotent (a second click still reports success).
- **Category normalisation.** Free-text categories ("Adult (17+)", "Jeugd (≤16)",
  "Thomas More student", …) are stored as `adult` / `junior` / `supporter` /
  `student`.
- **Cloudflare Turnstile** guards Join, Subscribe, Contact. Set `TURNSTILE_SECRET`
  (server) and `TURNSTILE_SITE_KEY` in `forms.js` (public). Verification is skipped
  when `TURNSTILE_SECRET` is unset (dev). Failure → `403 { code: "captcha_failed" }`.
- **Confirmation emails** (Join, Register) go out via SMTP (nodemailer). Configure
  `SMTP_*`; sending is a best-effort no-op when `SMTP_HOST` is unset and never
  blocks the response.
- **Auto-subscribe.** A successful Join or Register also subscribes the email to
  the newsletter (idempotent).

The form endpoints require a **Bearer JWT** (`Authorization: Bearer <token>`)
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
TURNSTILE_SECRET    = <Cloudflare Turnstile secret key — blank disables verification>
SMTP_HOST           = <smtp host — blank disables confirmation emails>
SMTP_PORT           = 587
SMTP_SECURE         = false            # true for port 465
SMTP_USER           = <smtp username>
SMTP_PASSWORD       = <smtp password>
SMTP_FROM           = Kempen Cricket Club <contact@kempencricket.be>
```

The public Turnstile **site** key is set separately in `public/assets/forms.js`
(`TURNSTILE_SITE_KEY`), since it ships to the browser.

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
