# Running the school ERP

## Local use

Requires Node.js 24 or later. No package installation is needed.

```powershell
npm start
```

Open `http://127.0.0.1:3000`. Create the first administrator with your own email and a password of 15–128 characters.
Use School accounts to create staff, parent, and student accounts. Share one-use password links directly with the intended person.
There are no built-in passwords or public registration. The staff employment directory is separate from sign-in accounts.

To load the fictional school on first launch:

```powershell
$env:ERP_DEMO = '1'
npm start
```

Alternatively, use Settings → Load sample data. Loading is allowed only when the operational tables are empty.
Existing accounts are preserved. The sample marker is shown in the workspace. For live use, start with a separate empty data directory;
do not mix real records into a sample database. Unset `ERP_DEMO` for a live installation.

## HTTPS deployment with Docker Compose

The repository includes a non-root Node container, a persistent SQLite data volume, health checks, restart policies,
and a Caddy reverse proxy. The Node service has no published host port; only the proxy exposes ports 80 and 443.

1. Install Docker with Compose on the deployment host.
2. Point your school domain's DNS to that host and make ports 80/443 reachable.
3. Copy `.env.example` to `.env`, set `ERP_DOMAIN` to the domain without a protocol/path, and set `ERP_SETUP_TOKEN` to a private random key of at least 32 characters.
   Generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it private.
4. Start the services:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 erp
```

5. Visit the HTTPS domain, enter your deployment setup key, and create the administrator. Then create individual school accounts.

The app refuses production mode unless `ERP_ORIGIN` is an exact HTTPS origin and `ERP_SECURE_COOKIE=1`.
Compose sets both from your domain. Caddy handles certificates and forwards requests to the private Node service.
Never expose `ERP_HOST=0.0.0.0` directly to the internet without the HTTPS proxy.

To update, back up first, then run `docker compose up -d --build`. The data volume persists.
One server process owns one SQLite database. Run one replica; this app does not implement distributed sessions,
multi-school tenancy, or clustered database storage. SQLite's write-ahead log and transaction checks protect local transactions.
Capacity and throughput should be measured against the intended school workload before a large rollout.

## Configuration

| Environment variable | Default / purpose |
| --- | --- |
| `PORT` | `3000`; `0` is useful for isolated tests |
| `ERP_HOST` | `127.0.0.1`; Compose uses `0.0.0.0` within its private network |
| `ERP_DATA_DIR` | `data` beside `server.js` |
| `ERP_ORIGIN` | Exact HTTPS origin behind a reverse proxy |
| `ERP_SECURE_COOKIE` | `1` adds the Secure cookie attribute; required in production |
| `ERP_SETUP_TOKEN` | Private random key, 32–256 characters; required for creating the first production administrator |
| `ERP_DEMO` | `1` seeds an empty school with fictional data; leave unset for live use |
| `ERP_REQUEST_LOG` | `1` writes structured request ID, method, path, status and duration logs |
| `NODE_ENV` | `production` enforces HTTPS configuration |

The app does not automatically load `.env` for local `node server.js` runs; Compose reads its `.env` file.
Request logs omit bodies, cookies, passwords, and query strings. Password-link tokens travel in the URL fragment and POST body.
`GET /api/health` verifies that the server can query its database. Every response includes an `X-Request-ID` for troubleshooting.

## Backups

Use Settings → Create database backup or the command-line tool:

```powershell
npm run backup
```

For Docker:

```sh
docker compose exec erp node tools/backup.js
```

The tool creates a consistent SQLite snapshot under `data/backups` using `VACUUM INTO`; the app can stay running.
Snapshots include password hashes, sessions, and school records. Restrict access, encrypt off-host copies,
and copy the snapshots off the server regularly. The app does not configure off-site storage or backup retention.
Database upgrades create a snapshot before changing the existing account or school schema.

Test restoration on a separate installation before relying on a backup. To restore a local installation:

1. Stop the ERP and preserve a copy of the current data directory.
2. Use an empty replacement data directory and copy the chosen snapshot into it as `erp.sqlite`.
3. Point `ERP_DATA_DIR` at the replacement directory and start the app.
4. Check database integrity and school totals, then revoke old sessions and reset account passwords as needed.

Do not combine an older database snapshot with WAL/SHM files from another database.
Restoring a snapshot can also restore old credentials and sessions. Use My account → Sign out on all devices for each account,
or disable/re-enable accounts through another administrator to revoke their sessions.

## Administrator recovery

```powershell
node tools/recover-admin.js administrator@school.example
```

This requires local database access and produces a private, one-use link for an existing active administrator.
It never registers a new account or exposes a public recovery endpoint. Do not share shell/database access with untrusted users.

## Verification and remaining integration work

`npm test` exercises real HTTP routes and isolated SQLite databases. Browser suites exercise both desktop and mobile layouts.
They do not use the live school database. Screenshots are saved under `tests/`.

The included deployment configuration still needs a real host/domain, HTTPS certificate provisioning, a tested off-host backup plan,
monitoring, and workload testing in that environment. Docker deployment cannot be validated on a machine without Docker.
Email/SMS, online payments, bank payouts, SSO, and MFA need explicit providers and credentials; there are no simulated success actions for them.
Payroll amounts and deductions are entered by staff; the app does not calculate or file statutory tax obligations.
Homework supports text submissions. Attendance changes remain an explicit class-teacher action after leave approval.
