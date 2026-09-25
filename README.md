# Blue Team Management System 藍隊管理系統

> 繁體中文完整手冊：[`docs/README.zh-TW.md`](docs/README.zh-TW.md)
> The product UI, in-app labels and code comments are in Traditional Chinese.

An operations platform for a security Blue Team's threat hunting work.
Five subsystems share one account and one dataset, so evidence and incident
timelines an analyst writes down are visible to the rest of the team immediately.

Deploys as a single Docker image — the target host needs nothing but Ubuntu and
Docker. No external managed services.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [First login](#first-login)
- [Configuration](#configuration)
- [API](#api)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

---

## What it does

### The five subsystems

| Subsystem | Purpose |
|---|---|
| **獵補案件簿** Investigation Reports | Create, review and close investigation reports. Incident timeline, connection records, IOCs, MITRE ATT&CK TTPs, image attachments, remediation advice |
| **請求管理系統** Request Management | RFI (request for information) and CR (change request) submission, assignment and tracking |
| **資產管理系統** Asset Inventory | Hosts and network devices. IPv4/IPv6/MAC, vendor country of origin, upstream network device and VLAN, known vulnerabilities, file attachments |
| **主機標定系統** Host Targeting | Network topology map. Attack flows mark compromised hosts and lateral movement paths; manages sensor deployment positions down to the switch port |
| **情資管理系統** Threat Intelligence | APT group reports, intel reports, threat hunt plans, an ATT&CK coverage heatmap and an environment risk assessment |

Switch subsystems from the top-left control. The five cross-reference each other —
a case links to an asset, an asset to the topology, intel to a hunt plan — and any
cross-system jump can be reversed with one click back to where you were.

### Capabilities

**Investigation and collaboration**

- Reports are written in Markdown; attached images open in a zoomable lightbox
- Each record is written independently and carries a version number. Two people
  editing different records never overwrite each other; editing the *same* record
  tells the second writer to reload rather than silently discarding the first
  writer's work
- When anyone saves, every other connected client updates immediately
  (Server-Sent Events) — no refresh needed
- The home case list sorts by **case occurrence time**, not record creation time
- Dashboard statistics are computed from the database on every request, so a new
  or re-classified case is reflected at once

**Access control and audit**

- Three permission levels: system administrator / case management (team lead and
  deputy) / analyst
- An analyst may only modify records they created — enforced **server-side**, not
  by hiding buttons
- Every login, create, update and delete is written to an audit log including the
  before/after values of changed fields. Administrators can query and export CSV

**Security**

- Passwords hashed with argon2id; no screen in the system ever displays a plaintext
  password
- Session cookie is HttpOnly and the database stores only the token's SHA-256, so a
  database leak yields no usable cookie. Idle and absolute timeouts both apply
- Failed-login lockout; CSRF token required on writes; rate limiting
- Attachments are type-sniffed from actual bytes, never from the file extension
- Authentication sits behind a provider interface — dropping in OIDC SSO later
  requires no change at any call site (see [`docs/SSO.md`](docs/SSO.md))

**Export and import**

- **Reports → PDF.** Every report (investigation, request, asset, intel, hunt plan,
  APT profile) exports to PDF through the browser's print dialog — choose
  "Save as PDF". Rendering PDF bytes ourselves would mean embedding a CJK font
  (~8 MB for Noto Sans TC) for worse typography than the browser already gives
  these Traditional Chinese reports. The print layout is composed separately:
  header, metadata table and sections, without the on-screen controls
- **Charts → PNG.** Topology map, ATT&CK heatmap and every dashboard chart export
  at 2× resolution. The export is the *whole* figure — framing comes from the
  content's own bounding box, not from what happens to be scrolled into view
- **Assets → XLSX.** Current filter or the full inventory, as a single sheet with
  a frozen header row and autofilter. The OOXML is assembled directly; no
  spreadsheet library, so nothing to load past the CSP
- **Assets ← CSV.** Bulk create or update, with a downloadable template. Every
  import is **previewed before it is written**: each row is marked create or
  update, and rows failing validation (duplicate hostname, malformed IPv4 / MAC /
  CIDR, invalid importance, unknown asset ID, duplicates within the file) are
  listed and skipped while the rest import normally. Imports take the same path as
  manual edits, so they carry the same audit trail and permission checks

**Interface**

- Traditional Chinese UI, with light / dark / follow-system themes
- Every list has filters, sorting and a per-page setting
- Usable at phone width

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Browser (single-page app)               │
│   All five subsystems share one screen codebase and     │
│   one data-access layer                                  │
└───────────────┬─────────────────────────┬───────────────┘
                │ REST /api/v1            │ SSE /api/v1/events
                │                         │ (other people's changes, live)
┌───────────────▼─────────────────────────▼───────────────┐
│                    Fastify (Node.js 24)                  │
│                                                          │
│  Auth        AuthProvider interface → Local (argon2id)   │
│                                     → OIDC (seam ready)  │
│  Access      Enforced server-side; analysts may only     │
│              modify records they own                     │
│  Audit       Every write logged with field-level diffs   │
│  Uploads     Streamed to disk, type-sniffed, SHA-256     │
│              content de-duplication                      │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│              SQLite (WAL mode, in-process)                │
│                                                           │
│  records     Business data: collection + JSON document    │
│              + version (optimistic locking)               │
│  users       Accounts, password hashes, permissions       │
│  sessions    Sessions (token hash only, never the token)  │
│  audit       Audit trail                                  │
│  attachments Attachment metadata                          │
└───────────────────────────────────────────────────────────┘
                │
        /data volume (database, attachments, backups)
```

### Why this shape

**One process, embedded database.** The spec calls for a single cross-platform
image, fast redeploys, and no dependency on external managed services. SQLite in
WAL mode never blocks readers on writers, which is ample for 30 concurrent users,
and a backup is one file copy.

**Business data as collection + JSON document.** Field sets across the five
subsystems are still evolving; JSON means adding a field does not mean a migration.
Fields that need sorting or ownership checks are exposed as generated columns and
indexed, so queries perform like a normalised schema. Accounts, sessions, audit and
attachment metadata do use normal columns.

**Optimistic rather than pessimistic locking.** On a 30-person team, two people
editing the same report at the same moment is the exception. Locking a record for
every edit costs more than it saves; instead a write carries the version it was
based on, and a mismatch prompts a reload.

### Layout

```
.
├── client/              Single UI source
│   ├── index.html       All five subsystems' screens
│   ├── datalayer.js     Data access — two implementations (server / demo)
│   ├── prod-views.js    Production-only screens: password change, audit log
│   └── prod.css
├── src/
│   ├── server.js        Entry point: security headers, CSRF, rate limits, routes
│   ├── config.js        Configuration (environment variables only)
│   ├── auth/            Password hashing, auth providers, sessions
│   ├── db/              Connection, migrations
│   ├── lib/             Record store, audit, SSE, dashboard, bootstrap
│   ├── middleware/      Access control
│   ├── routes/          auth / collections / attachments / users / audit / events / health
│   └── openapi.js       API specification
├── public/index.html    Build output: production (contains no demo data)
├── dist/demo.html       Build output: demo (localStorage, includes demo data)
├── seed/                Reference data and demo dataset
├── scripts/             Build, seed extraction, end-to-end test
├── docs/                Chinese manual, operations guide, SSO guide
├── Dockerfile
└── docker-compose.yml
```

`client/index.html` is the only screen source. `scripts/build-client.mjs` produces
two outputs from it: the production build talks to the API, the demo build uses
localStorage. The screen code is byte-identical in both, so **a fix verified on the
demo build is the same fix in production**.

---

## Requirements

### Host

| | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 1 core | 2 cores |
| Memory | 512 MB | 2 GB |
| Disk | 2 GB | 20 GB (depends on attachment volume) |
| Docker | 20.10+ | Latest stable |

Image supports `linux/amd64` and `linux/arm64`.

### Client

Chrome, Edge, Firefox or Safari from within the last two years. JavaScript required.

---

## Installation

### 1. Install Docker (Ubuntu)

If the host does not have it yet:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) \
signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
     docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out and back in for this to take effect)
sudo usermod -aG docker "$USER"
```

Verify:

```bash
docker --version
docker compose version
```

### 2. Clone and build

```bash
git clone https://github.com/wimterdom/Blue_Team_Management_System.git
cd Blue_Team_Management_System
docker build -t btms:1.0.0 .
```

### 3. Run

#### Option A — one command

```bash
docker run -d \
  --name btms \
  --restart unless-stopped \
  -p 8080:8080 \
  -v btms-data:/data \
  -e BTMS_ADMIN_USER=admin \
  btms:1.0.0
```

With no `BTMS_ADMIN_PASSWORD` set, a strong random password is generated and
printed to the log:

```bash
docker logs btms | grep -A6 '首次啟動'
```

```
────────────────────────────────────────────────────
  首次啟動 — 已建立初始管理員帳號        First start — initial admin created
    帳號：admin                          account
    密碼：xK9mQ2vL8pR4wN6tY3sD           password
  此密碼只顯示這一次，登入後系統會要求立即變更。
  (Shown once only; you must change it at first login.)
────────────────────────────────────────────────────
```

> To choose the password yourself, add `-e BTMS_ADMIN_PASSWORD='your-password'`.
> Note this leaves it in shell history — an `.env` file is the better route.

#### Option B — Docker Compose (recommended)

```bash
cp .env.example .env
$EDITOR .env          # at minimum, confirm BTMS_ADMIN_USER
docker compose up -d
docker compose logs | grep -A6 '首次啟動'
```

Compose publishes the port on all interfaces (`"8080:8080"`) so colleagues on the
same network can reach it. To restrict it to the host itself, change that to
`"127.0.0.1:8080:8080"` in `docker-compose.yml`.

> `.env.example` ships with `BTMS_ADMIN_PASSWORD=admin`. Change it before the
> container is reachable by anyone else — the first person to log in is the one who
> gets to set the permanent password.

#### Option C — with HTTPS

```bash
echo "BTMS_DOMAIN=btms.example.com" >> .env
echo "BTMS_COOKIE_SECURE=true"      >> .env
echo "BTMS_TRUST_PROXY=true"        >> .env
docker compose --profile tls up -d
```

Caddy obtains and renews a Let's Encrypt certificate automatically (the host must
be reachable from the internet on ports 80/443). For an internal deployment with no
public domain, uncomment `tls internal` in the `Caddyfile` to use Caddy's own
internal CA instead.

### 4. Verify

```bash
curl -fsS http://localhost:8080/api/v1/readyz
# {"status":"ready"}

docker ps --format '{{.Names}}\t{{.Status}}'
# btms    Up 2 minutes (healthy)
```

Open `http://<host>:8080` in a browser.

### Want to see it populated first?

Start a separate instance carrying the demo dataset (36 cases, 26 requests,
31 assets, 21 intel reports, 20 hunt plans):

```bash
docker run -d --name btms-demo -p 8081:8080 \
  -v btms-demo-data:/data \
  -e BTMS_SEED_DEMO=true \
  btms:1.0.0
```

Demo accounts are created **disabled and without passwords** — an administrator
must enable one and set a password before it can log in. Demo record dates are
rebased to the current day at load time, so the dashboard never looks stale.

Keep `BTMS_SEED_DEMO=false` (the default) for real deployments.

---

## First login

1. Log in with the account and password from the log
2. The system **requires a password change** before anything else. Until it is
   done, every API except the password change itself is refused — it cannot be
   skipped
3. Once changed, open 使用者管理 (User Management) to create accounts for the team

Password rules: at least 12 characters (CJK characters count double, but never
fewer than 8 actual characters); must not contain the account name or the user's
name; must not be a common word plus digits; must not contain a keyboard or numeric
run.

| Permission | Can do |
|---|---|
| `admin` 系統管理員 | Everything, plus account management and the audit log |
| `manage` 案件管理 | Edit, delete and close all content. For team lead and deputy |
| `analyst` 一般分析員 | Create anything; edit and delete only their own records |

---

## Configuration

Full list in [`.env.example`](.env.example). Common settings:

| Variable | Default | Meaning |
|---|---|---|
| `BTMS_PORT` | `8080` | Listen port |
| `BTMS_ADMIN_USER` | `admin` | Initial administrator account |
| `BTMS_ADMIN_PASSWORD` | (random) | Leave empty to generate one and print it to the log |
| `BTMS_SEED_DEMO` | `false` | Load the demo dataset on first start |
| `BTMS_COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `BTMS_TRUST_PROXY` | `false` | Set `true` when behind a reverse proxy |
| `BTMS_SESSION_IDLE_MIN` | `60` | Idle timeout |
| `BTMS_SESSION_MAX_HOURS` | `12` | Absolute session lifetime |
| `BTMS_MAX_FAILED_LOGINS` | `5` | Failed attempts before lockout |
| `BTMS_UPLOAD_MAX_BYTES` | `10485760` | Per-file attachment limit |
| `BTMS_BACKUP_INTERVAL_HOURS` | `24` | Automatic backup interval |
| `BTMS_AUDIT_RETENTION_DAYS` | `0` | Audit retention; `0` keeps forever |

**Secrets are injected through environment variables only** — never baked into the
source or the image. `.env` is gitignored.

---

## API

Every feature goes through a documented API layer, so other systems can integrate.

```bash
curl http://localhost:8080/api/v1/openapi.json
```

The OpenAPI 3.1 document imports directly into Swagger UI, Postman or an API
gateway.

Authentication uses the session cookie; writes must return the `csrfToken` issued
at login in the `X-BTMS-CSRF` header.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/login` | Log in |
| `GET /api/v1/bootstrap` | Fetch the whole data tree in one call |
| `GET /api/v1/dashboard` | Dashboard statistics (computed live) |
| `GET /api/v1/collections/{collection}` | List records |
| `POST /api/v1/collections/{collection}` | Create (server assigns the ID) |
| `PUT /api/v1/collections/{collection}/{id}` | Update (send `version` for optimistic locking) |
| `POST /api/v1/sync` | Submit a batch of changes |
| `GET /api/v1/events` | Live change stream (SSE) |
| `POST /api/v1/attachments` | Upload an attachment |
| `GET /api/v1/audit` | Query the audit log (admin only) |

Collections: `cases`, `case_detail`, `requests`, `request_detail`, `assets`,
`asset_detail`, `sensors`, `apts`, `intels`, `hunts`, `ttp_marks`.

Example — list every case judged malicious:

```bash
curl -b cookies.txt \
  'http://localhost:8080/api/v1/collections/cases' \
  | jq '[.items[] | select(.data.verdict == "惡意行為") | .data.title]'
```

---

## Development

```bash
npm install
npm run build:client          # client/ → public/ and dist/
BTMS_DATA_DIR=./data BTMS_SEED_DEMO=true npm run dev
```

`npm run dev` runs with `--watch`, so server changes restart automatically.
Changes under `client/` need `npm run build:client` to take effect.

End-to-end test (requires Chrome):

```bash
./scripts/e2e.sh tests/probe-full.js
```

This starts the server against a fresh database and drives the whole flow in
headless Chrome — login, forced password change, weak-password rejection, creating
a case, confirming it reached the server, and the audit log — then prints the
result.

The demo dataset is extracted from the UI source, so it has a single origin:

```bash
npm run seed:extract
```

`scripts/build-client.mjs` fails the build if the production output still contains
demo data, a plaintext password, or a regex character class with non-ASCII
literals. Those checks exist because each one caught a real defect; don't weaken
them to get a build through.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/README.zh-TW.md`](docs/README.zh-TW.md) | **繁體中文完整手冊** — this README's content in Traditional Chinese |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Backup and restore, account recovery, monitoring, reverse proxy configuration (Chinese) |
| [`docs/SSO.md`](docs/SSO.md) | Where the auth seam is and what remains to connect an OIDC IdP (Chinese) |

---

## License

MIT — see [LICENSE](LICENSE).
