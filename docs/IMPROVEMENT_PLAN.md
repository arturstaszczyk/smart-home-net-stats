# Improving smart-home-net-stats

> **Status (2026-10-14):** Phase 1 ✅ done · Phase 5 ✅ done (without CI) · Dashboard v2.0 ✅ done (`dashboard-v2`) · Dashboard v2.1 ✅ per-node expected speeds · Grafana 13.2.4 ✅ (fresh install, 2026-10-19) · Ookla speed test ✅ done, verified on amd64 (`ookla-speedtest`) · Phase 2 🔀 mostly done (`ookla-speedtest`) · Phases 3–4 ⏳ not started.
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

## Phase 2 — Tests 🔀 (mostly done)

Done 2026-10-14 on `ookla-speedtest`, uncommitted: `yarn test` runs 23 tests, 20 pass and 3 are `todo` for known Phase 3 bugs. Verified that a deliberately broken bandwidth conversion makes the suite fail with exit code 1.

- ✅ `node:test` + `node:assert`, `"test": "node --test"`, zero new dependencies. Tests are excluded from the Docker image (`.dockerignore`).
- ✅ Real fixtures in `Service/Commands/__tests__/fixtures/` (ping ok/unreachable, curl HTTPS/plain HTTP, ifconfig `lo`, an Ookla JSON result), with network-identifying values scrubbed; how each was captured is in its README. Comma-decimal variants are derived in the tests.
- 🔀 Per-parser tests for all four commands. **Desired-behaviour no-match tests are `todo`, not failing**, so a red run always means a regression: curl `null` fields (#5), `DataUsedCommand` throwing (#1), and a new finding, **`PingCommand` does not normalise comma decimals in round-trip times** (only the loss percentage); the "every parser normalises commas" statement above was not true for ping.
- ✅ `SpeedTestCommand.execute` tested against a fake `speedtest` on `PATH` (success, and Ookla's real exit-2 failure).
- 🔀 `baseCommand.test.js` pins the callback contract and records a finding: **`onClose` is called without an exit code, so commands never reject**; every `reject` branch is dead code and failures resolve with the `*Error` metric. Feeds into Phase 3 #1 and the Phase 4 template method.
- ⏳ `Service/Influx/__tests__/influxWriter.test.js`: needs the Phase 3 #7 constructor change first.
- ✅ README Test section rewritten (unit tests first, real-InfluxDB check second).

The original plan for this phase, for reference:

Use the built-in `node:test` runner and `node:assert`, so there are zero new dependencies; that is the main payoff of the ESM move. Add `"test": "node --test"` to `Service/package.json`.

- ⏳ `Service/Commands/__tests__/*.test.js`, one per command, exercising `parseOutput` against fixtures of **real** captured output (verified samples exist for ping, curl, and ifconfig; capture `speedtest-cli --simple` once during implementation). Include the fields added with dashboard v2.0: all six curl timings (with a plain-HTTP fixture where `appconnect` is 0) and the speed test's `ping`. Cover, per parser: the happy path, the no-match path, and a comma-decimal variant. Every parser does `.replace(',', '.')`, so the Polish-locale case is deliberate behaviour worth pinning.
- ⏳ The no-match cases are where the bugs are. Write them as assertions on the *desired* behaviour and let them fail until Phase 3 fixes them. `DataUsedCommand.parseOutput` currently does `downloadBytes[1]` on a possibly-`null` match, and `CurlCommand`/`SpeedTestCommand` return `null` field values.
- ⏳ `Service/Commands/__tests__/baseCommand.test.js`: drive `BaseCommand._execute` against real trivial shell commands (`echo hi`, `sh -c 'exit 3'`) to pin the success/error/close contract and the `{metricName, metrics, tags}` resolve/reject shape.
- ⏳ `Service/Influx/__tests__/influxWriter.test.js`: inject a stub write API (see the Phase 3 constructor change) and assert tags become Influx tags and metrics become float fields.
- ⏳ Extend the README's **Test** section: `yarn test`, how to run a single file (`node --test Commands/__tests__/pingCommand.test.js`), where the fixtures live and how to capture a new one from real CLI output, and a note that the no-match tests fail on purpose until Phase 3.

## Phase 3 — Correctness fixes ⏳ (10 items: 1 done early, 2 partly)

Each of these is a real defect, not a style preference:

1. ⏳ **A throwing parser crashes the whole run.** In `Service/Commands/BaseCommand.js`, `onSuccess`/`onError` are invoked from the `exec` callback, *outside* the `new Promise` executor, so a `TypeError` in `parseOutput` becomes an uncaught exception rather than a rejection. This is the likely reason `DataUsedCommand` is commented out in `index.js`. Fix by rewriting `_execute` on top of `promisify(exec)` (or `execFile`) with `try/catch` around the parse, so a parse failure degrades to an error metric like every other failure.
2. ⏳ **A command that never closes hangs the run forever.** The promise settles only in the `'close'` handler, and only `SpeedTestCommand` passes a `timeout`. With cron firing `frequent` every minute, one stuck `ping` accumulates processes indefinitely. Give every command a default timeout in `BaseCommand`.
3. ⏳ **Influx write failures are unhandled.** `influxWriter.storeMetrics` calls `this.writeAPI.flush()` without awaiting the returned promise, and `close()` is never called. *Observed on 2026-10-14:* with a wrong password, the `401 Unauthorized` surfaced as an **unhandled promise rejection that crashed the Node process** (`triggerUncaughtException`), after all points had been logged as "Writing timeseries". Make `storeMetrics` await, add a `close()` method, and have `runCommands` in `index.js` await all writes then close, with one flush for the whole batch instead of one HTTP round trip per point. Log a write failure clearly, without a crash.
4. ⏳ **Garbage points on a malformed result.** `runCommands` pushes whatever it catches into `outputs`, then unconditionally calls `storeMetrics(output.metricName, ...)`. A non-metric throw yields `storeMetrics(undefined, undefined, undefined)` and a fieldless point. Guard on `metricName` being present and log a skip.
5. 🔀 **`null` field values.** `CurlCommand` assigns `match && match[1]`, so a non-match writes `null` into `floatField`. Omit unmatched fields instead, and emit the `*Error` measurement when nothing parsed. *`SpeedTestCommand` is already fixed: the Ookla JSON parser omits missing values. Curl's case is pinned by a `todo` test.*
6. ✅ **Broken log rotation**, fixed in Phase 5 (`1321bc7`) because cron is still in use: `cron-job-smart-home` now copies `cron2.log` to `/var/log/cron2.log.bak` instead of the non-existent `/var/cron/log2.bak`.
7. ⏳ Make `InfluxWriter`'s constructor accept its config/client so it is injectable for the Phase 2 test, rather than reading `process.env` at module scope.
8. 🔀 **Half done.** The `INFLUS_PASS` typo in `Service/.env.template` was fixed in Phase 5, because compose now reads that same file. ⏳ Still missing: `WAN_INTERFACE` (used by `DataUsedCommand`) in the template.
9. ⏳ **Commands never reject** *(found by the Phase 2 tests)*. `BaseCommand._execute` calls `onClose()` without the exit code, so the `if (error) reject(...)` branch in every command is dead code: a failed command resolves with its `*Error` metric. The written data is correct today, but `runCommands`' `catch` never sees a command failure, and any future code relying on rejection would silently break. Pass the exit code to `onClose`, or settle the promise from the `exec` callback (fold into #1 and the Phase 4 template method). `baseCommand.test.js` pins the current behaviour and must change with the fix.
10. ⏳ **Ping round-trip times keep comma decimals** *(found by the Phase 2 tests)*. `PingCommand.parseOutput` normalises the loss percentage but not `min`/`avg`/`max`/`mdev`, so under a comma-decimal locale `floatField` gets `"9,028"`. Apply the same `.replace(',', '.')`. Pinned by a `todo` test.

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
- 🔀 **Grafana provisioning.** `grafana/grafana:12.0.2` (pinned; upgraded to 13.2.4 on 2026-10-19, see below) with `Infrastructure/grafana/provisioning/datasources/influxdb.yml` (uid `smart-home-influxdb`, credentials from `.env`) and a dashboards provider (`allowUiUpdates: false`, so the JSON file is the source of truth). The dashboard moved to `Infrastructure/grafana/dashboards/ping-all-sensors.json`. Correction to the plan: only **two** of the three uids were datasources (`Gv-wFIiRz`, `SmartHome`); both now point to `smart-home-influxdb`. `1ojbtE-Mz` is the dashboard's own uid and was kept, so provisioning takes over the copy already imported by hand. Anonymous Admin access and the disabled login form were kept as before; Grafana 12 logs that anonymous Admin is deprecated.
- ❌ **CI** (`.github/workflows/ci.yml`): dropped by the user.
- ✅ **Docs.** Detailed `Infrastructure/README.md` (configure, fresh install, migration, operate, manage users, change the dashboard, test, security notes, troubleshooting). `Service/README.md` updated for its own compose stack, including multi-arch `buildx` push to Docker Hub. New root `README.md` with a quick start per part. `CLAUDE.md` refreshed.
- ✅ *Not in the plan, found while doing it:* `Service/.dockerignore` didn't exclude `.env`, so **old images had `Service/.env` (including the Influx password) baked in**. Now excluded, and `.env` is git-ignored at the root too.

### Open follow-ups from Phase 5

- ⏳ **Clarify the migration in `Infrastructure/README.md`.** On 2026-10-14 the migration's `SET PASSWORD` step was run on a fresh install, and it set the service user's password to `haslo`. Grafana and the service then failed with `authorization failed` until the password was reset by hand. The section should say plainly that it applies only to a database created by the old scripts, and its commands should read the password from `.env` instead of having it typed in.
- ⏳ **Not verified:** the arm/v7 image build (no QEMU on the build machine), and how the 8 legacy `graph` panels look in Grafana 12. Grafana should migrate them to time series automatically, but they were only checked through the API, not in a browser.
- ⏳ Rotate the InfluxDB password if the old Docker Hub images (which contain `.env`) are public, and consider deleting those tags.

## Dashboard v2.0 ✅ (not in the original plan)

Done 2026-10-14 at the user's request, committed as `1900b40` on `dashboard-v2`. The original dashboard is kept as **v1.0**.

- ✅ **Service: more measurements.** `CurlCommand.parseOutput` now stores all cumulative curl timings (`namelookup`, `connect`, `appconnect`, `pretransfer`, `starttransfer`, `total`; previously only the first and last), and `SpeedTestCommand.parseOutput` stores the speed test's `ping`. Existing field names are unchanged, so v1.0 is unaffected. Same parsing pattern as before, including comma decimals; the Phase 3 `null`-field fix applies to the new fields too.
- ✅ **v1.0** (`ping-all-sensors-v1.0.json`, uid `1ojbtE-Mz`): renamed file, title `… v1.0`, tags `smart-home`/`v1.0`, header link to the other `smart-home` dashboards. Panels unchanged.
- ✅ **Generator** in `Infrastructure/tools/generate-network-health-dashboard.py` (Python 3, stdlib only) produces the v2.0 JSON; the plan, node colors and LAN pattern are constants at its top, and every plan-dependent threshold, query and description is derived from them. Verified to reproduce the tested dashboard (only description wording changed), and that changing the plan leaves no stale 900/90 values.
- ✅ **v2.0** (`network-health-v2.0.json`, uid `smart-home-network-v2`), 29 panels in five rows: *Now* (per-node tiles with units and meaningful thresholds, last report per node), *Latency* (internet vs router per node, jitter, loss, per-target small multiples), *Reliability* (node × target reachability grid, failures over time and per node), *Web response* (page load per URL, page-load phase breakdown, DNS), *Bandwidth* (download/upload vs the 1000/100 Mbit/s −10 % plan with the below-plan band shaded, speed-vs-plan table, speed test ping). Node and target filters are filled in from the data; router/LAN is detected by private address range instead of a hardcoded IP. Node colors for pi3/pi4/pi5 use a palette validated for colorblind readers on Grafana's dark and light backgrounds.
- ✅ **Tested** on an isolated stack (ports 18086/13000) with 24 h of synthetic data planted with known problems: a healthy node with one just-below-plan speed test each way; a node with bad Wi-Fi (high router latency, jitter, loss bursts, speeds below plan, curl failures); a node with a 20-minute internet outage, a failed speed test and 2 hours of silence. Every panel query was run through Grafana's query API and checked against the planted values, and the dashboard was screenshotted and reviewed. The review found and fixed: a dead node not being flagged (now *Reports in last 10 min* = 0, red), the 20-minute outage invisible in the reachability grid (now 5-minute cells), an unreadable loss chart and grid legend, a truncated speed table and legends, and an unmatched column override. A real service batch built from the modified code then wrote the new curl timings and speed-test ping end to end.
- ⏳ **Not verified:** the light theme (only dark was screenshotted). By design, outages shorter than one grid cell (5 minutes at 24 h) appear only under *Failures over time*.
- ⏳ **To take effect on a Pi:** rebuild and restart its service (`docker compose up -d --build` in `Service/`). Until then, *Where page-load time goes* and *Speed test ping* stay empty for that node.

## Dashboard v2.1 ✅ (not in the original plan)

Done 2026-10-19 at the user's request, uncommitted. Prompted by the first 24 h of real data: the plan thresholds (1000/100 −10 %) made the dashboard red for nodes that can never reach them. `pi105` is a deliberate worst-case canary in poor radio coverage; `pi113` is a Pi 3B on 2.4 GHz Wi-Fi, whose hardware ceiling is ~40–60 Mbit/s.

- ✅ **Per-node expected speeds** in the generator: `PLAN` (1000/100, the default for `server-101` and every new node), `NODE_EXPECTED` (`pi113` 50/50, `pi105` 6/18 = its usual level) and `WARN_BELOW`/`CRIT_BELOW` (orange below 80 %, red below 50 % of the node's own expectation, as the user asked).
- ✅ Speed tiles use per-node threshold overrides; "Speed tests below expected" and the table counts use one query with an OR of per-node conditions; new "% of expected" charts divide each node by its own expectation in the query, so all nodes share one scale and one set of bands. Raw Mbit/s charts stay. The table was cut to 12 short DL/UL columns so it fits at full width.
- ✅ v2.1 is a new file and uid (`network-health-v2.1.json`, `smart-home-network-v2-1`); `network-health-v2.0.json` is kept as a frozen snapshot, and the generator now produces v2.1.
- ✅ Verified on the live stack: every speed query run through Grafana's API and checked against the 24 h statistics (`server-101` 0 tests below expected, where v2.0 showed 14 "below plan"; `pi113` 18 downloads below 40; `pi105` 1 download and 8 uploads below its baseline), and the dashboard and table were screenshotted and reviewed.

## Ookla speed test ✅ (not in the original plan)

Done 2026-10-14 at the user's request, committed as `a09e8ef` on `ookla-speedtest`. Replaces sivel's `speedtest-cli`, which measured about 700 Mbit/s where Ookla's official CLI measured 883 on the same gigabit line and machine.

- ✅ `Service/Dockerfile.service`: Debian `speedtest-cli` (and the Python it pulled in) removed; Ookla CLI 1.2.0 downloaded per architecture (amd64, arm64, armhf) and verified against a pinned SHA-256.
- ✅ `SpeedTestCommand`: runs `speedtest --accept-license --accept-gdpr --format=json --progress=no` (plus `--server-id` when `SPEED_TEST_SERVER_ID` is set; only digits are passed to the shell). Parses JSON; `download`/`upload` converted from bytes/s to Mbit/s and `ping` kept, so both dashboards work unchanged. New fields: `jitter`, `packetLoss`, `downloadLatency`, `uploadLatency` (loaded latency), `serverId`. Missing values are omitted instead of written as `null`; non-JSON output logs and writes no fields.
- ✅ Schedule unchanged: one test per Pi per hour at its own `SPEED_TEST_MINUTE`; the template and README now say to spread them evenly (3 Pis: 0, 20, 40). New optional `SPEED_TEST_SERVER_ID`.
- ✅ Verified: lint; parser against a real Ookla JSON result, a result without `packetLoss`, and non-JSON output; the command builder with and without a server ID, and with a non-numeric one.
- ✅ **Verified end to end by the user** on the amd64 dev machine: the image built (download and checksum check), the container runs Ookla 1.2.0 from `/usr/local/bin/speedtest`, and real runs wrote all eight fields (`download`, `upload`, `ping`, `jitter`, `packetLoss`, `downloadLatency`, `uploadLatency`, `serverId`) to InfluxDB with no `speedtest-error`.
- ⏳ **Not verified:** the arm64 and armhf builds on the Pis, and the hourly cron run (the verified runs were manual).
- ⚠️ **Finding:** the first two real Ookla runs auto-selected server 1958 and measured only 248 and 332 Mbit/s down (upload ~101), where a run earlier the same evening against server 38577 (AWIST, Kraków) measured 883. Unpinned results vary with the server Ookla picks, so the dashboard would flag them as far below plan. Recommendation: set `SPEED_TEST_SERVER_ID` to a server that reaches ~900 (e.g. 38577) on every Pi and compare a few runs. Not yet decided by the user.
- ⏳ Not done: dashboard panels for the new fields (loaded latency, jitter, server). Open question for the user: licence before pushing the image to a public Docker Hub repository.

## Grafana upgrade 12.0.2 → 13.2.4 ✅

Done 2026-10-19 as a fresh install, following the steps below. Results:

- ✅ Grafana 13.2.4 started on an empty data folder; the old one is kept as `/var/lib/smart-home/grafana.old-12.0.2` (step 6: delete after a few days without problems). Downtime was about a minute.
- ✅ All checks passed: version 13.2.4 and database `ok`; datasource `OK` (6 measurements); exactly the three provisioned dashboards; no provisioning errors; **anonymous Admin access still works** (HTTP 200 on folder creation; the "upgrade-check" folder was deleted again), still logged as deprecated; v2.1 and v1.0 render with no plugin or Angular errors.
- ⚠️ Three `level=error` lines at the first start, none repeated afterwards: two `database is locked (SQLITE_BUSY)` from the secrets store in the same second while the new database was created (the datasource password decrypts fine, so the secrets store works), and one `grafana-apiserver` "invalid name" with no further context. Treated as start-up noise.
- ℹ️ v1.0's 8 legacy chart panels show "No data". Not caused by the upgrade: they filter on v1.0's fixed `SensorID` list (`pi3,pi4,pi5`), and no current node has those names (the same query returns 1,440 points with `pi105`). Grafana 13 still renders the legacy `graph` panels.

The plan as executed:

**Why.** 12.0.2 is from June 2025. The new major version adds cross-filtering on status history and state timeline (13.2), so a click on a node in the reachability grid could filter the whole dashboard, and a revamped gauge (12.4/13.0). 13.2.4 publishes amd64, arm64 and arm/v7 images (checked on Docker Hub, 2026-10-19). A 13.3 image did not exist yet; 13.3 adds the data-driven Text panel (preview), which this plan doesn't need.

**Approach: a fresh Grafana, not an in-place upgrade.** Everything that matters in this Grafana is provisioned from the repository, so a new, empty data folder rebuilds it on the first start. That skips the 12.4.13 intermediate step and the 13.0 storage migration (and its SQLite locking risk). Inventory of the current Grafana, checked 2026-10-19:

| Item | After a fresh start |
| --- | --- |
| Datasource `smart-home-influxdb` | Recreated (provisioned) |
| Network health v2.1, v2.0, Ping dashboard v1.0 | Recreated (provisioned) |
| "Network health" (uid `smart-home-network`), saved by hand | **Not recreated.** It is an identical copy of v2.0, so nothing is lost. |
| Alert rules, annotations, library panels, folders, extra plugins | None exist |
| User `admin`, contact point "email receiver" | Grafana defaults, recreated |

**Known 13.0 changes that could matter:** data sources referenced by numeric ID are disabled (not used here: everything uses uid `smart-home-influxdb`) and the Image Renderer plugin is removed (not used). **Unknown, check in step 4:** whether anonymous Admin access (`GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`) still works; 12 already logs it as deprecated. Dashboard v1.0's 8 legacy `graph` panels are the most likely to render differently; v2.0 and v2.1 don't use that panel type.

**Downtime.** Grafana only, about a minute. InfluxDB and the services on the Pis keep running and writing, so no measurements are lost.

### Steps

1. **Set the new image.** In `Infrastructure/docker-compose.yml`, change `grafana/grafana:12.0.2` to `grafana/grafana:13.2.4`, and download it before stopping anything:

   ```bash
   docker compose pull grafana
   ```

2. **Put the old data folder aside** (it is the rollback) and create an empty one:

   ```bash
   docker compose stop grafana
   sudo mv /var/lib/smart-home/grafana /var/lib/smart-home/grafana.old-12.0.2
   sudo mkdir /var/lib/smart-home/grafana && sudo chown 472:472 /var/lib/smart-home/grafana
   ```

3. **Start Grafana 13.2.4:**

   ```bash
   docker compose up -d grafana
   docker compose logs -f grafana        # wait for "HTTP Server Listen"; Ctrl+C
   ```

4. **Run the checks** below. If any fails, roll back.

5. **Update the repository:** the version in `Infrastructure/README.md` (first list) and in this plan's Phase 5 notes, then commit and push together with the compose change. Do **not** `git switch` to an old commit on the infrastructure host while Grafana runs (it detaches the dashboards mount; see *Bugs found during testing*). If it happens, `docker compose restart grafana`.

6. **After a few days without problems:** delete `/var/lib/smart-home/grafana.old-12.0.2`. Optionally build dashboard v2.2 with cross-filtering on the reachability grid (a generator change: new file, uid and tag; v2.1 stays).

### Checks

| Check | Command or action | Expected |
| --- | --- | --- |
| Version | `curl -s http://localhost:3000/api/health` | `13.2.4`, `"database": "ok"` |
| Datasource | `curl -s http://localhost:3000/api/datasources/uid/smart-home-influxdb/health` | `"status":"OK"` |
| Dashboards | `curl -s 'http://localhost:3000/api/search?type=dash-db'` | Network health v2.1, Network health v2.0, Ping dashboard - all sensors v1.0 |
| Provisioning | The log command below the table | No output |
| Anonymous access | `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' localhost:3000/api/folders -d '{"title":"upgrade-check"}'` | `200`: anonymous Admin still works; delete the "upgrade-check" folder in the UI. `401` or `403`: it doesn't; decide on a login (`GF_AUTH_DISABLE_LOGIN_FORM=false` and an admin password) or accept read-only dashboards. |
| Rendering | Open v2.1 and v1.0 in a browser at the 24 h view | Panels show data; no "panel plugin not found" or Angular errors |

Provisioning log check:

```bash
docker compose logs grafana 2>&1 | grep -iE 'provision.*(error|failed)'
```

### Rollback

```bash
docker compose stop grafana
sudo mv /var/lib/smart-home/grafana /var/lib/smart-home/grafana.failed-13.2.4
sudo mv /var/lib/smart-home/grafana.old-12.0.2 /var/lib/smart-home/grafana
# set the image tag back to grafana/grafana:12.0.2 in docker-compose.yml
docker compose up -d grafana
```

## Bugs found during testing

Everything found while testing on 2026-10-14 (the Phase 5 stack, dashboard v2.0, the Ookla switch and the Phase 2 unit tests), in one place. Code bugs that are still open are also numbered in Phase 3, where they will be fixed.

**Fixed**

| Bug | Found by | Fix |
| --- | --- | --- |
| The official `influxdb:1.8` image runs `CREATE DATABASE` without quoting the name, so `smart-home-db` (hyphens) fails and the service user is never created; every write gets `401`. | Phase 5 fresh-install test | Mounted init script `Infrastructure/influxdb/init/create-db-and-user.sh` (`1321bc7`) |
| `Service/.dockerignore` didn't exclude `.env`, so images pushed to Docker Hub contained the InfluxDB password. | Phase 5 review | Excluded (`1321bc7`). ⏳ Rotate the password if those images were public. |
| Log rotation copied to the non-existent `/var/cron/log2.bak`. | Phase 5 review | Phase 3 #6 (`1321bc7`) |
| sivel's `speedtest-cli` under-reports a gigabit line by ~20 % (675–707 Mbit/s vs 883 from Ookla on the same machine and connection). | Comparing tools | Switched to Ookla's CLI (`ookla-speedtest`, not yet tested end to end) |
| Speed test `null` fields when output didn't match. | Phase 2 tests | Ookla JSON parser omits missing values (Phase 3 #5, speed-test half) |
| Grafana stopped loading dashboard file changes from 2026-10-14 21:50 UTC: `git switch main` (then still the old layout) deleted `Infrastructure/grafana/dashboards/` and the fast-forward recreated it, so the running container kept the deleted directory (`failed to search for dashboards`, 14 000+ log lines). Existing dashboards kept working, which hid it. | Deploying v2.1 | `docker compose restart grafana` (2026-10-19); documented in `Infrastructure/README.md` → Troubleshooting and `CLAUDE.md` |
| Dashboard v2.0 before release: a dead node wasn't flagged, a 20-minute outage was invisible in the reachability grid, the loss chart and grid legend were unreadable, the speed table and legends were cut off, and the "below plan" columns weren't colored. | Synthetic-data test and screenshot review | Fixed before commit (`1900b40`) |

**Open**

| Bug | Found by | Severity | Where it gets fixed |
| --- | --- | --- | --- |
| A failed InfluxDB write (e.g. `401`) is an unhandled promise rejection that **crashes the Node process** after logging the points as written; that batch's data is lost. | Manual run with a wrong password | High | Phase 3 #3 |
| Commands never reject: `onClose()` gets no exit code, so every `reject` branch is dead code. | Phase 2 tests | Medium | Phase 3 #9 |
| `PingCommand` doesn't normalise comma decimals in round-trip times (only in the loss percentage). Documentation said all parsers did. | Phase 2 tests | Medium (only under a comma-decimal locale) | Phase 3 #10 |
| `CurlCommand` writes `null` fields when output doesn't match. | Phase 2 tests (`todo`) | Medium | Phase 3 #5 |
| `DataUsedCommand.parseOutput` throws a `TypeError` on unrecognised output. | Phase 2 tests (`todo`) | Low while disabled | Phase 3 #1 |
| The migration steps in `Infrastructure/README.md` were followed on a **fresh** install; their `SET PASSWORD` set the service user's password to `haslo`, and Grafana and the service failed with `authorization failed` until it was reset by hand. | Real deployment on the dev machine | Medium (docs) | Docs follow-up under Phase 5: say the migration is only for databases created by the old scripts, and read passwords from `.env` instead of typing them. |
| Ookla's apt repository has no Ubuntu 24.04 (noble) release (`404`), yet its install script reports success; the broken source then makes every `apt update` fail. Ookla's package also conflicts with sivel's `speedtest-cli`, which installs the same `/usr/bin/speedtest`. | Local install on Ubuntu 24.04 | Low (local runs only; the Docker image downloads the binary directly) | Docs: `Service/README.md` should give the `jammy` workaround or the static binary, and say to remove `speedtest-cli` first. |
| Each speed test saturates the connection for ~25 s, so ping and curl results from that minute, on **every** node, show inflated latency, and the dashboard doesn't mark them. | Ookla data-cost/interference review | Low | Phase 4 scheduler: skip or tag the `frequent` batch during the node's own test. Other nodes' tests can only be shown, e.g. as Grafana annotations. |
| An Ookla failure records only `count = 1`; the reason (a JSON log message on stderr) is lost. | Real failure captured for the tests | Low | With Phase 3 #1: store the message, e.g. as a tag with low cardinality, or log it. |
| Ookla prints its licence notice on stderr on every run, which fills `cron2.log`. | Real Ookla runs | Cosmetic | Redirect or filter stderr when it's not an error. |
| Dashboard v2.0 "Failures (last hour)" only shows tiles for failure types that happened; there are no `0` tiles for the others. | Dashboard v2.0 review | Cosmetic | A future dashboard version |
| Dashboard v2.0 reachability grid: outages shorter than one cell (5 min at 24 h) aren't visible there (they are under *Failures over time*), and the first slice before the range can be a clipped false "no reply". | Dashboard v2.0 test | Low, by design | Documented in the panel description |
| InfluxDB's healthcheck passes against the temporary server it runs during first-start setup, so connections can be refused for a few seconds right after the very first start. | Phase 5 fresh-install test | Low, first start only | Documented in `Infrastructure/README.md` → Troubleshooting |
| Grafana 12 logs that anonymous Admin access is deprecated; a future version will limit anonymous users to Viewer, which would make the dashboards read-only without a login. | Phase 5 Grafana logs | Low, future | Still works in 13.2.4 (checked 2026-10-19). Check again at every Grafana upgrade. |
| Dashboard v1.0 (kept as-is): speed gauges turn red when the connection is *fast* (default "red above 80"), no units, a hardcoded router IP (`192.168.192.1`) mixes the router into internet averages, and a fixed `SensorID` list (`pi3,pi4,pi5`) hides other nodes. | Dashboard analysis | Superseded by v2.0 | Not fixing; v1.0 stays for comparison |

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
