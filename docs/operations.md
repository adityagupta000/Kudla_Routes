# Operations

Running, fronting and diagnosing the server. Every command that was run for this document is marked **tested**; everything else (process managers, proxy configs) is a **template that has not been tested here**.

> **No deployment evidence exists.** The repository has never been deployed to a real host, and there is no record of a CI run. See [Status and limitations](status-and-limitations.md).

## At a glance

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Runtime              | Node.js 22 or newer (tested on 22.23.4). Express 5 is the only production dependency          |
| Moving parts         | One process. No database, no build, no secrets, no outbound network calls                     |
| Footprint (measured) | About 60 ms to start, about 60 MB resident memory                                             |
| Configuration        | `PORT` (default 3000), `TRUST_PROXY` (default `false`). `.env` files are **not** loaded       |
| Binding              | `app.listen(PORT)` with no host, so it listens on **all interfaces**                          |
| Persistence          | None. The server writes nothing to disk. Logs go to stdout and stderr                         |
| Probe                | `GET /api/health` returns `{ "status": "ok", "stops": 186, "buses": 99, "dataVersion": "…" }` |

## Run it

```bash
npm ci --omit=dev      # production dependencies only (uses package-lock.json)
npm test               # optional, about 10 s
PORT=3000 npm start    # same as: node backend/index.js
```

Startup prints two lines. **Tested.**

```
Data loaded: 99 buses, 186 stops (vb11f421d)
Bus finder running at http://localhost:3000
```

The `v…` value is the data version (`b11f421d`) with a `v` prefix. The URL printed is always `localhost` even though the server listens on every interface.

Set a variable in the process environment or service manager, not in a `.env` file:

| Variable      | Values                   | Effect                                                                                                                                            |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`        | a port number            | Listen port                                                                                                                                       |
| `TRUST_PROXY` | `false`, `1`, `loopback` | See [reverse proxy](#reverse-proxy-and-tls). Any other value logs `Unknown TRUST_PROXY value "x"; defaulting to off.` and is ignored (**tested**) |

No other environment variable is read. In particular `NODE_ENV` has no effect.

## Known issue: a port conflict is silent

If the port is already in use, the second process prints `Bus finder running at http://localhost:3000` and **exits with code 0**, with no error message (**tested**). The cause: Express 5 passes listen errors to the `app.listen` callback, and `backend/index.js` ignores that argument and logs "running" unconditionally.

Consequences: a process manager that restarts only on failure (`systemd` `Restart=on-failure`) will not restart it, and one that always restarts (`PM2`, `Restart=always`) will loop. Check `ss -ltnp` or call `/api/health` after a start. The code fix is small:

```js
const server = app.listen(port, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Bus finder running at http://localhost:${port}`);
});
```

## Shutdown

`SIGTERM` and `SIGINT` log `<signal> received; shutting down gracefully`, stop accepting connections, and exit 0 when the open ones finish (**tested**: exit code 0). If connections have not drained after 5 seconds the process logs `Forced exit after 5s drain timeout` and exits 1.

## Process management (templates, not tested here)

**systemd**: `/etc/systemd/system/kudla-route.service`

```ini
[Unit]
Description=Kudla Route bus planner
After=network.target

[Service]
Type=simple
User=kudla
WorkingDirectory=/opt/kudla-route
Environment=PORT=3000
ExecStart=/usr/bin/node backend/index.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

**PM2**

```bash
npm install -g pm2
pm2 start npm --name kudla-route -- start
pm2 save && pm2 startup
```

Run as an unprivileged user and make `data/` read-only for it: the application never writes there, and a writable dataset is a tampering risk.

## Reverse proxy and TLS

Do not expose Node directly on port 80 or 443. The app speaks plain HTTP and sets **no** `Strict-Transport-Security` header; TLS, HTTPS redirects and HSTS are the proxy's job.

**Caddy** (automatic certificates)

```
example.com {
    reverse_proxy localhost:3000
}
```

**nginx**

```nginx
server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Choosing `TRUST_PROXY`

The rate limiter keys on `req.ip`. Behind a proxy that is the **proxy's** address unless Express is told to trust it, in which case every client shares one bucket.

| Topology                                            | Setting           | Why                                                                                                                |
| --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node reachable directly by clients                  | `false` (default) | Trusting forwarded headers lets any client spoof its address                                                       |
| One trusted proxy on another host or network        | `1`               | Express uses the address the proxy appended. Block direct access to the Node port, or clients can bypass the proxy |
| Proxy on the same machine, connecting over loopback | `loopback`        | Trust only loopback peers                                                                                          |
| Several proxies, or unsure                          | Do not guess      | Terminate rate limiting at the proxy or CDN instead                                                                |

The proxy must overwrite or append `X-Forwarded-For` correctly. A wrong setting makes limits either spoofable or shared by everyone.

## Health and monitoring

- **Liveness:** `GET /api/health`. It has no readiness distinction: if the process answers, the dataset has already validated.
- **Data version:** `dataVersion` changes when the dataset content changes; use it to confirm a deploy picked up new data.
- **Smoke script:** `node scripts/smoke.js http://host:port` runs 12 checks. It currently **always reports one failure** (its last check calls `res.json()` on the HTML home page) and exits 1, so do not wire it into a deploy gate until that is fixed. See [Status](status-and-limitations.md#known-issues).
- There is no metrics endpoint, tracing or log shipping.

### Logs

One line per request, written when the response finishes, in the form `METHOD route-template status duration`. **Tested.**

```
GET /api/health 200 6ms
GET /api/stop/:name 404 2ms
GET /static 200 11ms
```

Route templates replace stop names and bus numbers, and query strings are never logged, so the request log does not contain what users searched for. The error handler writes the full error object to stderr, which can include a stack trace and, for a malformed URL, part of the offending path. Protect stderr like any log.

## Before a release

1. `npm ci --omit=dev && npm test` passes (117 tests).
2. `npm audit --audit-level=high` is clean. It reported no vulnerabilities when run on 2026-11-13 against a freshly resolved dependency tree; run it against your own lockfile.
3. Data changes follow [Data: updating the data](data.md#updating-the-data).
4. The target host has TLS, `TRUST_PROXY` matching its proxy topology, a firewall that blocks direct access to the Node port, and a process manager.
5. After start: `/api/health` shows the expected counts and `dataVersion`; one real `/api/plan` request returns journeys; the process listens on the expected port.

## Rollback

The application is stateless, so rollback is "put the previous files back and restart".

| Problem                              | Action                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bad code                             | `git revert` or redeploy the previous release, restart, check `/api/health`                                                                                              |
| Bad data only                        | Restore the previous `data/busData.json` (git or your backup) and restart. Do **not** replace stronger evidence with weaker; keep `evidence` and `confidence` consistent |
| Server will not start after a change | Read the first error (below). Restoring the last known-good `busData.json` fixes data errors                                                                             |

`migrate-evidence.js --write` backups are named `busData.json.bak.<ISO timestamp>.<pid>`. The manual backup command in [Data](data.md#updating-the-data) uses a different pattern (`.bak-YYYYMMDD-HHMMSS`). Neither pattern is git-ignored, so keep backups out of commits.

After any rollback: restart, check `/api/health`, run a plan between two stops, and note the restored `dataVersion`.

## Troubleshooting

| Symptom                                                                   | Cause and action                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exits at once with `Fatal: failed to load bus data: …`                    | `data/busData.json` is missing, unreadable or not valid JSON (**tested**: both produce this message). Restore the file                                                                                                                                                                                              |
| Exits at once with `Fatal: bus data failed validation:` and a list        | The data parsed but broke a rule. Each line names the bus and the problem (for example `buses[0] (1): stop "State Bank" appears more than once`). See [Data](data.md#what-validatedataset-enforces). The same checks run in `npm test`                                                                              |
| "Running" is printed but nothing answers, or a second copy exits silently | Port already in use; see [known issue](#known-issue-a-port-conflict-is-silent)                                                                                                                                                                                                                                      |
| `/api/health` is not 200, or connection refused                           | Process not running, wrong port, or a firewall. Check the manager's status and `ss -ltnp`                                                                                                                                                                                                                           |
| Everyone gets `429`                                                       | Wrong `TRUST_PROXY`: all clients look like the proxy. Fix the setting; limits reset on restart                                                                                                                                                                                                                      |
| One client can exceed the limits                                          | `TRUST_PROXY` trusts a header that clients can set, or there are several instances, each with its own counters                                                                                                                                                                                                      |
| A search returns "No connection recorded …"                               | Often expected: only 30.7% of stop pairs have a result because routes are stored one way. See [Planner coverage](planner.md#coverage-measured). Try the opposite direction, or an intermediate stop                                                                                                                 |
| A stop "was not found"                                                    | The name is not a canonical stop or alias. Typos within about 20% are corrected; ambiguous input returns suggestions. List stops with `GET /api/stops?q=`                                                                                                                                                           |
| A new route does not appear                                               | The server reads data once at startup. Restart, then check `dataVersion`                                                                                                                                                                                                                                            |
| `/api/bus/<number>` returns 404 for a route you added                     | The number was stored in lower case. Store bus numbers in upper case                                                                                                                                                                                                                                                |
| Fonts or styling missing                                                  | Check that `frontend/fonts/` contains `barlow-condensed-latin-600-normal.woff2`, `barlow-condensed-latin-700-normal.woff2`, `barlow-latin-400-normal.woff2`, `barlow-latin-500-normal.woff2` and `barlow-latin-600-normal.woff2`, and that `style.css` is deployed. Only the 700-weight condensed font is preloaded |
| Browser console shows CSP violations                                      | Something added an inline script or style. The policy allows `'self'` only; use external files and `style.setProperty`                                                                                                                                                                                              |
| High memory                                                               | Not observed: about 60 MB at idle. No memory profile has been taken under load                                                                                                                                                                                                                                      |
| Page stays on "Looking for buses…"                                        | The request aborts after 10 s with "The request took too long…". If it never resolves, the browser's own network layer is blocked; check connectivity to the host                                                                                                                                                   |
| Browser asks for `/favicon.svg` and gets 404                              | `index.html` links `favicon.svg`; the file was not in the reviewed tree. Add it or remove the link                                                                                                                                                                                                                  |

## What has not been verified

- Deployment on any real host, TLS and proxy behaviour, firewalling, process managers.
- A GitHub Actions run. The README and earlier docs describe a workflow file, but it was not present in the export this documentation was written from.
- Behaviour under load. Only planner-only timings exist ([Testing](testing.md#performance)); there is no HTTP load test.
