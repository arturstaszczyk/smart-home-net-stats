# Improving smart-home-net-stats

> **Status (2026-10-14):** Phase 1 ✅ done · Phase 5 ✅ done (without CI) · Dashboard v2.0 ✅ done (uncommitted) · Phases 2–4 ⏳ not started.
>
> | Phase | Commit | Branch |
> | --- | --- | --- |
> | 1 — Runtime foundation | `d54e90c` | `phase-1-esm` |
> | 5 — Ops & deployment | `1321bc7` | `phase-5-infra` (on top of `phase-1-esm`) |
>
> Neither branch is merged into `main` or pushed yet.
>
> Phase 5 was done before 2–4 at the user's request, so the service image still runs cron until Phase 4 replaces it.
> The session copy at `~/.claude/plans/goofy-popping-goose.md` is the pre-implementation plan and is out of date; this file is the source of truth.
>
> **Legend:** ✅ done as planned · 🔀 done, but differently from the plan (the real implementation is described) · ⏳ not started · ❌ dropped
>
> Decisions already settled, so don't re-litigate them on resume:
> - Scope covers all four areas: reliability bugfixes, runtime modernization, architecture refactor, ops & deployment. **CI was dropped** by the user.
> - Runtime: **Node 22 LTS with native ESM**; Babel and nodemon are removed. (Planned as Node 20; moved to 22 on 2026-10-14 because 20 went EOL on 2026-04-30. Not 24: `node:24` images have no arm/v7, and some Pis run 32-bit Raspberry Pi OS.)
> - Language: **plain JavaScript**, tests on the built-in `node:test` runner.
> - **Infrastructure and Service are separate deployments**, each with its own `docker-compose.yml` and `.env`. The infrastructure host runs InfluxDB + Grafana only; the service runs only on the measuring Pis.
> - InfluxDB port 8086 stays reachable on the LAN (the Pis need it), with **authentication enabled**.
>
> Remaining order: tests (2), then the correctness fixes they cover (3), then the refactor (4). Don't refactor before Phase 2 lands.

## Context

This stack has been untouched since April 2023. It works on the Pis it already runs on, but it has rotted in ways that only show up when you try to change or redeploy it:

- **It probably can't be rebuilt.** Both halves use `FROM ubuntu` (unpinned), so a rebuild today pulls Ubuntu 24.04+, where `apt-key add` is gone, `python3-distutils` no longer exists, and PEP 668 blocks the `get-pip.py` + `pip install speedtest-cli` sequence in `Service/Dockerfile.service`. The Influx images add a `focal` apt source to a non-focal base. *(Fixed in Phase 5.)*
- **Failures are silent.** Influx writes are fire-and-forget, and a parser that doesn't match can take down the whole run. *(Phase 3.)*
- **It can't be tested.** There is no test seam problem: `parseOutput` is already a pure string→object function in all four commands. There is just no runner and no fixtures. *(Phase 2.)*
- **Changing anything requires a rebuild.** Probe targets are hardcoded in `index.js`, so adding a Pi or a target means rebuild + push + pull on every node. *(Phase 4.)*

Goal: get the project buildable, testable, and changeable without a rebuild, and fix the defects found while reading it.

Good news from verification: `ping`, `timedcurl.sh`, and `ifconfig` were run against the current machine and every regex in `Service/Commands/` was checked against the real output. **All four parsers still match current CLI output**, so tests written now will pin correct behaviour, not bugs. Phase 5 testing also confirmed the speedtest parser against Debian's `speedtest-cli` 2.1.3 (`--simple`).

---

## Phase 1 — Runtime foundation ✅

Commit `d54e90c`. No behaviour change. Verified: `yarn lint` clean, every module loads under ESM, and a one-shot `frequent` run produced metrics for all targets.

- ✅ `Service/package.json`: `"type": "module"`, `"engines": { "node": ">=20" }`. `@babel/core`, `@babel/node`, `@babel/preset-env` and `nodemon` removed; scripts call `node ./index.js` directly.
- ✅ `Service/.babelrc` deleted.
- 🔀 `import 'dotenv/config'` in `index.js` and `Influx/influxWriter.js`, plus `.js` extensions on all relative imports. **Also required upgrading `dotenv` 8 → 16**: dotenv 8 has no `exports` map, so ESM can't resolve `dotenv/config`.
- ✅ Unused `import { ArgumentParser } from 'argparse'` removed from `index.js`.
- 🔀 `Service/.nvmrc`: `v14.15.3` → `v20` in Phase 1, then **`v22`** in Phase 5.
- 🔀 ESLint 7 → 9: `Service/.eslintrc.js` replaced by `Service/eslint.config.js` (flat config, same house style), plus a `lint` script. Lint brought up **5 errors that already existed** (no script had ever run it), all fixed without behaviour change: unnecessary `\.` escapes inside regex character classes in `CurlCommand` and `PingCommand` (same matches), an unused `exec` import in `DataUsedCommand`, and an `eslint-disable` comment on the intentionally unused `measureDataUsed` in `index.js`.
- ✅ Stray empty root `yarn.lock` deleted.
- ✅ `Service/libseccomp2_2.4.4-1~bpo10+1_armhf.deb` deleted. Note: the cron/seccomp problem it worked around can still hit Pis on old Raspberry Pi OS (Buster) with the new Debian 12 image. `Service/README.md` → Troubleshooting points to the fix (`libseccomp2` ≥ 2.4.4 from buster-backports).
- ✅ `Service/README.md` rewritten around prerequisites, configure, build, run and test, with a manual test procedure in place of unit tests. Added during review: which `speedtest-cli` is required (sivel's Python tool, not Ookla's) and a warning not to install `cmdtest` for `yarn`. The Docker parts were rewritten again in Phase 5.
- ✅ `yarn start` (ran nothing) dropped.
- 🔀 *Not in the plan:* `Dockerfile.service`'s nvm `NODE_VERSION` was bumped to `20.18.1`, because ESLint 9 needs Node 18+ to install. This was superseded when Phase 5 replaced the Dockerfile.

## Phase 2 — Tests ⏳

Not started. `Service/README.md` → Test describes the manual check (lint, one-shot run, query Influx) until this lands.

Use the built-in `node:test` runner and `node:assert`, so there are zero new dependencies; that is the main payoff of the ESM move. Add `"test": "node --test"` to `Service/package.json`.

- ⏳ `Service/Commands/__tests__/*.test.js`, one per command, exercising `parseOutput` against fixtures of **real** captured output (verified samples exist for ping, curl, and ifconfig; capture `speedtest-cli --simple` once during implementation). Include the fields added with dashboard v2.0: all six curl timings (with a plain-HTTP fixture where `appconnect` is 0) and the speed test's `ping`. Cover, per parser: the happy path, the no-match path, and a comma-decimal variant. Every parser does `.replace(',', '.')`, so the Polish-locale case is deliberate behaviour worth pinning.
- ⏳ The no-match cases are where the bugs are. Write them as assertions on the *desired* behaviour and let them fail until Phase 3 fixes them. `DataUsedCommand.parseOutput` currently does `downloadBytes[1]` on a possibly-`null` match, and `CurlCommand`/`SpeedTestCommand` return `null` field values.
- ⏳ `Service/Commands/__tests__/baseCommand.test.js`: drive `BaseCommand._execute` against real trivial shell commands (`echo hi`, `sh -c 'exit 3'`) to pin the success/error/close contract and the `{metricName, metrics, tags}` resolve/reject shape.
- ⏳ `Service/Influx/__tests__/influxWriter.test.js`: inject a stub write API (see the Phase 3 constructor change) and assert tags become Influx tags and metrics become float fields.
- ⏳ Extend the README's **Test** section: `yarn test`, how to run a single file (`node --test Commands/__tests__/pingCommand.test.js`), where the fixtures live and how to capture a new one from real CLI output, and a note that the no-match tests fail on purpose until Phase 3.

## Phase 3 — Correctness fixes ⏳ (2 of 8 items done early)

Each of these is a real defect, not a style preference:

1. ⏳ **A throwing parser crashes the whole run.** In `Service/Commands/BaseCommand.js`, `onSuccess`/`onError` are invoked from the `exec` callback, *outside* the `new Promise` executor, so a `TypeError` in `parseOutput` becomes an uncaught exception rather than a rejection. This is the likely reason `DataUsedCommand` is commented out in `index.js`. Fix by rewriting `_execute` on top of `promisify(exec)` (or `execFile`) with `try/catch` around the parse, so a parse failure degrades to an error metric like every other failure.
2. ⏳ **A command that never closes hangs the run forever.** The promise settles only in the `'close'` handler, and only `SpeedTestCommand` passes a `timeout`. With cron firing `frequent` every minute, one stuck `ping` accumulates processes indefinitely. Give every command a default timeout in `BaseCommand`.
3. ⏳ **Influx write failures are unhandled.** `influxWriter.storeMetrics` calls `this.writeAPI.flush()` without awaiting the returned promise, and `close()` is never called. *Observed on 2026-10-14:* with a wrong password, the `401 Unauthorized` surfaced as an **unhandled promise rejection that crashed the Node process** (`triggerUncaughtException`), after all points had been logged as "Writing timeseries". Make `storeMetrics` await, add a `close()` method, and have `runCommands` in `index.js` await all writes then close, with one flush for the whole batch instead of one HTTP round trip per point. Log a write failure clearly, without a crash.
4. ⏳ **Garbage points on a malformed result.** `runCommands` pushes whatever it catches into `outputs`, then unconditionally calls `storeMetrics(output.metricName, ...)`. A non-metric throw yields `storeMetrics(undefined, undefined, undefined)` and a fieldless point. Guard on `metricName` being present and log a skip.
5. ⏳ **`null` field values.** `CurlCommand` and `SpeedTestCommand` assign `match && match[1]`, so a non-match writes `null` into `floatField`. Omit unmatched fields instead, and emit the `*Error` measurement when nothing parsed.
6. ✅ **Broken log rotation**, fixed in Phase 5 (`1321bc7`) because cron is still in use: `cron-job-smart-home` now copies `cron2.log` to `/var/log/cron2.log.bak` instead of the non-existent `/var/cron/log2.bak`.
7. ⏳ Make `InfluxWriter`'s constructor accept its config/client so it is injectable for the Phase 2 test, rather than reading `process.env` at module scope.
8. 🔀 **Half done.** The `INFLUS_PASS` typo in `Service/.env.template` was fixed in Phase 5, because compose now reads that same file. ⏳ Still missing: `WAN_INTERFACE` (used by `DataUsedCommand`) in the template.

## Phase 4 — Architecture ⏳

Not started.

- ⏳ **Collapse the command boilerplate.** All four commands repeat the same ~35-line `new Promise` + `tags`/`metrics`/`metricName` + success/error/close block; only four things actually vary: the shell command, the measurement name, the tags, and `parseOutput`. Turn `BaseCommand.execute` into a template method owning the promise, timeout, and error-metric construction, so each subclass declares `buildCommand(options)`, `metricName`, `errorMetricName`, `buildTags(options)`, and `parseOutput(stdout)`. Keeps the `command(CommandType, options)` factory and the `{metricName, metrics, tags}` contract intact, so `index.js` and the Grafana dashboard are unaffected. Expect the four command files to shrink by roughly half.
- ⏳ **Make probe targets configuration, not code.** Move the `frequentCommands`/`infrequentCommands` arrays out of `index.js` into `Service/config/probes.js`, driven by comma-separated `PING_TARGETS` / `CURL_TARGETS` env vars (defaulting to today's list: wp.pl, pl.wikipedia.org, google.com, `$ROUTER_1`, 8.8.8.8). Adding a target becomes a `Service/.env` edit plus `docker compose up -d`, with no rebuild/push/pull cycle across the Pis. Add the new vars to `Service/.env.template` **and** to the `environment:` list in `Service/docker-compose.yml`, which passes variables explicitly.
- ⏳ **Replace container cron with an in-process scheduler.** `index.js` becomes a long-running process with a small minute-aligned scheduler (~30 lines, no new dependency): `frequent` every minute, `infrequent` at `$SPEED_TEST_MINUTE`. Keep the existing one-shot CLI mode for ad-hoc runs and for the tests. This deletes:
  - all three files in `Service/containerScripts/`;
  - the `printenv > env.docker.sh` dump and its fragile re-sourcing, which breaks on any value containing spaces or newlines;
  - the log-rotation cron lines and the `tail -f` PID-1 hack;
  - **`cron` from the `apt-get install` line in `Service/Dockerfile.service`** (kept there in Phase 5 only for this reason);
  - the `/var/log` log bind mount in `Service/docker-compose.yml`, since logs become the app's stdout (`docker compose logs`).

  It makes Docker's `restart: unless-stopped` actually supervise the app instead of supervising `tail`. Trade-off to accept: a crash now pauses collection until Docker restarts the container, where cron would have retried the next minute independently. Docker's restart policy covers this.

## Phase 5 — Ops & deployment ✅ (CI dropped)

Commit `1321bc7`. Verified end to end on 2026-10-14; see Verification below.

- 🔀 **Service image.** `FROM ubuntu` + the nvm install → **`FROM node:22.21.1-bookworm-slim`** (pinned), with `apt-get install --no-install-recommends iputils-ping curl ca-certificates speedtest-cli cron`. Debian's `speedtest-cli` package is the same sivel tool the parser expects, which removes `get-pip.py`, `pip`, `python3-distutils` and the PEP 668 problem. `vim` is dropped. **`cron` is kept** until Phase 4. The image does `yarn install --frozen-lockfile --production`, so only 3 runtime packages ship, and it is 284 MB. Node 22 publishes amd64, arm64 and arm/v7.
- 🔀 **Infrastructure.** `Dockerfile.influx`, `Dockerfile.init-influx`, `containerScripts/initializeDB.sh` and the ~200-line `influx-config-override.config` are replaced by the official **`influxdb:1.8.10`** image, configured by environment (`INFLUXDB_HTTP_FLUX_ENABLED=true`, `INFLUXDB_HTTP_AUTH_ENABLED`, `INFLUXDB_ADMIN_USER`/`_PASSWORD`). Difference from the plan: **`INFLUXDB_DB` / `INFLUXDB_USER` are not used**. The image's init runs `CREATE DATABASE` without quoting the name, so it fails on `smart-home-db` and then skips the user too. Instead `Infrastructure/influxdb/init/create-db-and-user.sh` is mounted into `/docker-entrypoint-initdb.d` and creates the quoted database plus the service user on first start. The hardcoded `'haslo'` password and the `sleep 20` + separate init-container race are gone.
- 🔀 **Compose.** Instead of one root `docker-compose.yml` with profiles, there are **two independent stacks** (user decision: the halves were never meant to be together):
  - `Infrastructure/docker-compose.yml` + `Infrastructure/.env.template`: InfluxDB + Grafana. Grafana waits on InfluxDB's healthcheck (`curl /ping`) instead of `sleep 20`.
  - `Service/docker-compose.yml` + `Service/.env.template`: the service only. It writes to `INFLUX_HOST` over the LAN and has no dependency on the Influx stack. `Service/.env` serves both compose and local `yarn` runs.

  Data uses **bind mounts under `DATA_DIR`** (default `/var/lib/smart-home`), not named volumes, so existing data is used in place. All four `*-build.sh` / `*-run.sh` scripts are deleted.
- ❌🔀 **Publish Influx on `127.0.0.1:8086`: not done**, because it would cut off the Pis, which write over the LAN. Replaced by **enabling InfluxDB authentication** with 8086 still on the LAN, so the credentials are actually checked. Existing installs need a one-time migration (auth off → create an admin → reset the service password → auth on), documented in `Infrastructure/README.md`. It is required because Influx with auth on, a non-admin user and no admin rejects every request, including creating an admin.
- 🔀 **Grafana provisioning.** `grafana/grafana:12.0.2` (pinned) with `Infrastructure/grafana/provisioning/datasources/influxdb.yml` (uid `smart-home-influxdb`, credentials from `.env`) and a dashboards provider (`allowUiUpdates: false`, so the JSON file is the source of truth). The dashboard moved to `Infrastructure/grafana/dashboards/ping-all-sensors.json`. Correction to the plan: only **two** of the three uids were datasources (`Gv-wFIiRz`, `SmartHome`); both now point to `smart-home-influxdb`. `1ojbtE-Mz` is the dashboard's own uid and was kept, so provisioning takes over the copy already imported by hand. Anonymous Admin access and the disabled login form were kept as before; Grafana 12 logs that anonymous Admin is deprecated.
- ❌ **CI** (`.github/workflows/ci.yml`): dropped by the user.
- ✅ **Docs.** Detailed `Infrastructure/README.md` (configure, fresh install, migration, operate, manage users, change the dashboard, test, security notes, troubleshooting). `Service/README.md` updated for its own compose stack, including multi-arch `buildx` push to Docker Hub. New root `README.md` with a quick start per part. `CLAUDE.md` refreshed.
- ✅ *Not in the plan, found while doing it:* `Service/.dockerignore` didn't exclude `.env`, so **old images had `Service/.env` (including the Influx password) baked in**. Now excluded, and `.env` is git-ignored at the root too.

### Open follow-ups from Phase 5

- ⏳ **Clarify the migration in `Infrastructure/README.md`.** On 2026-10-14 the migration's `SET PASSWORD` step was run on a fresh install, and it set the service user's password to `haslo`. Grafana and the service then failed with `authorization failed` until the password was reset by hand. The section should say plainly that it applies only to a database created by the old scripts, and its commands should read the password from `.env` instead of having it typed in.
- ⏳ **Not verified:** the arm/v7 image build (no QEMU on the build machine), and how the 8 legacy `graph` panels look in Grafana 12. Grafana should migrate them to time series automatically, but they were only checked through the API, not in a browser.
- ⏳ Rotate the InfluxDB password if the old Docker Hub images (which contain `.env`) are public, and consider deleting those tags.

## Dashboard v2.0 ✅ (not in the original plan)

Done 2026-10-14 at the user's request, not yet committed. The original dashboard is kept as **v1.0**.

- ✅ **Service: more measurements.** `CurlCommand.parseOutput` now stores all cumulative curl timings (`namelookup`, `connect`, `appconnect`, `pretransfer`, `starttransfer`, `total`; previously only the first and last), and `SpeedTestCommand.parseOutput` stores the speed test's `ping`. Existing field names are unchanged, so v1.0 is unaffected. Same parsing pattern as before, including comma decimals; the Phase 3 `null`-field fix applies to the new fields too.
- ✅ **v1.0** (`ping-all-sensors-v1.0.json`, uid `1ojbtE-Mz`): renamed file, title `… v1.0`, tags `smart-home`/`v1.0`, header link to the other `smart-home` dashboards. Panels unchanged.
- ✅ **Generator** in `Infrastructure/tools/generate-network-health-dashboard.py` (Python 3, stdlib only) produces the v2.0 JSON; the plan, node colors and LAN pattern are constants at its top, and every plan-dependent threshold, query and description is derived from them. Verified to reproduce the tested dashboard (only description wording changed), and that changing the plan leaves no stale 900/90 values.
- ✅ **v2.0** (`network-health-v2.0.json`, uid `smart-home-network-v2`), 29 panels in five rows: *Now* (per-node tiles with units and meaningful thresholds, last report per node), *Latency* (internet vs router per node, jitter, loss, per-target small multiples), *Reliability* (node × target reachability grid, failures over time and per node), *Web response* (page load per URL, page-load phase breakdown, DNS), *Bandwidth* (download/upload vs the 1000/100 Mbit/s −10 % plan with the below-plan band shaded, speed-vs-plan table, speed test ping). Node and target filters are filled in from the data; router/LAN is detected by private address range instead of a hardcoded IP. Node colors for pi3/pi4/pi5 use a palette validated for colorblind readers on Grafana's dark and light backgrounds.
- ✅ **Tested** on an isolated stack (ports 18086/13000) with 24 h of synthetic data planted with known problems: a healthy node with one just-below-plan speed test each way; a node with bad Wi-Fi (high router latency, jitter, loss bursts, speeds below plan, curl failures); a node with a 20-minute internet outage, a failed speed test and 2 hours of silence. Every panel query was run through Grafana's query API and checked against the planted values, and the dashboard was screenshotted and reviewed. The review found and fixed: a dead node not being flagged (now *Reports in last 10 min* = 0, red), the 20-minute outage invisible in the reachability grid (now 5-minute cells), an unreadable loss chart and grid legend, a truncated speed table and legends, and an unmatched column override. A real service batch built from the modified code then wrote the new curl timings and speed-test ping end to end.
- ⏳ **Not verified:** the light theme (only dark was screenshotted). By design, outages shorter than one grid cell (5 minutes at 24 h) appear only under *Failures over time*.
- ⏳ **To take effect on a Pi:** rebuild and restart its service (`docker compose up -d --build` in `Service/`). Until then, *Where page-load time goes* and *Speed test ping* stay empty for that node.

---

## Verification

Phase 5 checks, run on 2026-10-14 with separate compose project names and data dirs on the dev machine (amd64):

- ✅ `yarn lint` clean.
- ✅ **Fresh infrastructure install:** database, admin, service user and grant created; anonymous queries rejected (`unable to parse authentication credentials`); Grafana datasource health `OK`; dashboard provisioned.
- ✅ **Service over the LAN** (separate stack, `INFLUX_HOST` = LAN IP): cron's `frequent` run wrote `ping`/`curl`/`curlError` points with `address` and `computerTag` as tags and float fields, with no write failures. A manual `infrequent` run wrote `speedtest` (`download`/`upload`).
- ✅ **Migration from an old-style database** (auth off, `'haslo'` user, no admin): the documented auth-off → create admin → reset password → auth-on sequence works, the old password is rejected afterwards, and legacy points stay readable through Grafana. A hand-imported dashboard with the same uid was taken over by provisioning.
- ✅ Measurement and field names unchanged (`ping`, `pingError`, `curl`, `curlError`, `speedtest`, `speedtest-error`).

Still to run, for later phases:

- ⏳ `cd Service && yarn install && yarn lint && yarn test`, with all tests green (Phase 2).
- ⏳ Error paths, which are the point of Phase 3: run with `PING_TARGETS=no-such-host.invalid` (Phase 4 adds that variable) and confirm the process does **not** crash, a `pingError` point is written, and the other commands in the batch still complete. Also confirm that a wrong `INFLUX_PASS` logs a write error without crashing.
- ⏳ One-shot CLI mode against the Influx stack after the Phase 4 scheduler lands (`node ./index.js frequent` / `infrequent`). Then let the scheduler run ~3 minutes and confirm from `docker compose logs -f` that `frequent` fires each minute and `infrequent` fires once at `$SPEED_TEST_MINUTE`.
- ⏳ After Phase 4, diff the measurement and field names again. They must be byte-identical, or the dashboard silently goes blank.

## Deliberately not doing

- **InfluxDB 1.8 → 2.x/3.** `influxWriter.js` already uses the 2.x client against 1.x via the `db/retention` bucket and `user:pass` token trick (verified working with auth enabled in Phase 5). Migrating means moving historical data, rewriting every dashboard query to Flux, and reworking auth: large, risky, and it buys this project nothing.
- **TypeScript.** Decided against; the tests cover the parser contract.
- **CI.** Dropped by the user during Phase 5.
- **Re-enabling `DataUsedCommand`** beyond fixing its crash: it needs `WAN_INTERFACE` and only makes sense on the router-adjacent host. Phase 3 makes it safe to turn on, but leave the `index.js` call commented until you want it.
