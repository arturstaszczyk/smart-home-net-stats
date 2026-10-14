# Improving smart-home-net-stats

> **Status: Phase 1 and Phase 5 done (2026-10-14, Phase 5 without CI, see its "As implemented" note); Phases 2–4 not started.**
> Phase 5 was done before 2–4 at the user's request, so the service image still runs cron until Phase 4.
> Session copy: `~/.claude/plans/goofy-popping-goose.md`.
>
> Decisions already settled, so don't re-litigate them on resume:
> - Scope covers all four areas: reliability bugfixes, runtime modernization + CI, architecture refactor, ops & deployment.
> - Runtime: **Node 22 LTS with native ESM** — Babel and nodemon get removed. (Was Node 20; moved to 22 on 2026-10-14 because 20 went EOL on 2026-04-30. Not 24: `node:24` images have no arm/v7, and some Pis run 32-bit OS.)
> - Language: **plain JavaScript**, tests on the built-in `node:test` runner.
>
> Phase order is deliberate: ESM first (unblocks `node:test`), then tests, then the correctness
> fixes the tests cover, then the refactor, then deployment. Don't refactor before Phase 2 lands.

## Context

This stack has been untouched since April 2023. It works on the Pis it already runs on, but it has rotted in ways that only show up when you try to change or redeploy it:

- **It probably can't be rebuilt.** Both halves use `FROM ubuntu` (unpinned), so a rebuild today pulls Ubuntu 24.04+, where `apt-key add` is gone, `python3-distutils` no longer exists, and PEP 668 blocks the `get-pip.py` + `pip install speedtest-cli` sequence in `Service/Dockerfile.service`. The Influx images add a `focal` apt source to a non-focal base.
- **Failures are silent.** Influx writes are fire-and-forget, and a parser that doesn't match can take down the whole run.
- **It can't be tested.** There is no test seam problem — `parseOutput` is already a pure string→object function in all four commands — there is just no runner and no fixtures.
- **Changing anything requires a rebuild.** Probe targets are hardcoded in `index.js`, so adding a Pi or a target means rebuild + push + pull on every node.

Goal: get the project buildable, testable, and changeable without a rebuild, and fix the defects found while reading it.

Good news from verification: `ping`, `timedcurl.sh`, and `ifconfig` were run against the current machine and every regex in `Service/Commands/` was checked against the real output. **All four parsers still match current CLI output**, so tests written now will pin correct behaviour, not bugs.

Phases are ordered so each one is independently shippable, and so tests exist before the refactor.

---

## Phase 1 — Runtime foundation

Unblocks everything else; no behaviour change.

- `Service/package.json`: add `"type": "module"`, drop `@babel/core`, `@babel/node`, `@babel/preset-env`, and `nodemon`. They exist only to provide `import`, which Node 20 has natively. Rewrite scripts to call `node ./index.js` directly.
- Delete `Service/.babelrc`.
- `Service/index.js`: replace the mixed `require('dotenv').config()` + `import` with `import 'dotenv/config'`. Same in `Service/Influx/influxWriter.js`. Add `.js` extensions to all relative imports (ESM requires them) across `index.js`, `Influx/influxWriter.js`, and the four files in `Commands/`.
- Remove the unused `import { ArgumentParser } from 'argparse'` in `index.js` — `argparse` is not a declared dependency and only resolves transitively via eslint.
- `Service/.nvmrc`: `v14.15.3` → `v20`.
- ESLint 7 → 9: replace `Service/.eslintrc.js` with `Service/eslint.config.js` (flat config), keeping the existing house style exactly — 4-space indent, single quotes, **no semicolons**, unix linebreaks. Add a `lint` script (there is none today).
- Delete the stray empty `yarn.lock` at the repo root (there is no root `package.json`).
- Delete `Service/libseccomp2_2.4.4-1~bpo10+1_armhf.deb` — it is referenced by no Dockerfile or script, and the cron/seccomp workaround it was for goes away in Phase 5 when cron does.
- **Rewrite `Service/README.md` around build, run, and test.** Today it only covers the Docker build/push/pull cycle and says nothing about running the service locally. After the ESM move it should have these sections:
  - **Prerequisites:** Node 20 (`nvm use` reads the new `.nvmrc`), yarn, and the CLI tools the commands shell out to (`ping`, `curl`, `speedtest-cli`, `ifconfig`), plus a reachable Influx.
  - **Configure:** copy `.env.template` to `.env`, with a table of every variable and what it is for. Call out the `INFLUS_PASS` → `INFLUX_PASS` typo until Phase 3 fixes the template.
  - **Build:** `yarn install` locally, and `./service-build.sh` for the Docker image (the existing tag/push steps stay).
  - **Run:** `yarn standalone-frequent` / `yarn standalone-infrequent` for one-shot runs. Say they must be run from `Service/` because `CurlCommand` calls `./timedcurl.sh` relative to the working directory. Then `./service-run.sh` for the container, and how to check it with `docker logs`.
  - **Test:** `yarn lint`, then a one-shot run against Influx, confirming the points arrived with the `influx -execute 'SELECT * FROM ping ORDER BY time DESC LIMIT 5'` query from the Verification section. There is no unit test runner until Phase 2, so the README should say so rather than leave the section out.
  - Keep the existing Troubleshooting entries. The cron "Operation not permitted" one stays until Phase 5 removes cron.
- Fix `yarn start` while touching the scripts: today it runs `index.js` with no batch argument, so it does nothing. Either point it at `frequent` or drop it, and make the README match.

## Phase 2 — Tests

Use the built-in `node:test` runner and `node:assert` — zero new dependencies, which is the main payoff of the ESM move. Add `"test": "node --test"` to `Service/package.json`.

- `Service/Commands/__tests__/*.test.js`, one per command, exercising `parseOutput` against fixtures of **real** captured output (verified samples exist for ping, curl, and ifconfig; capture `speedtest-cli --simple` once during implementation). Cover, per parser: the happy path, the no-match path, and a comma-decimal variant — every parser does `.replace(',', '.')`, so the Polish-locale case is deliberate behaviour worth pinning.
- The no-match cases are where the bugs are; write them as assertions on the *desired* behaviour and let them fail until Phase 3 fixes them. `DataUsedCommand.parseOutput` currently does `downloadBytes[1]` on a possibly-`null` match, and `CurlCommand`/`SpeedTestCommand` return `null` field values.
- `Service/Commands/__tests__/baseCommand.test.js`: drive `BaseCommand._execute` against real trivial shell commands (`echo hi`, `sh -c 'exit 3'`) to pin the success/error/close contract and the `{metricName, metrics, tags}` resolve/reject shape.
- `Service/Influx/__tests__/influxWriter.test.js`: inject a stub write API (see the Phase 3 constructor change) and assert tags become Influx tags and metrics become float fields.
- Extend the README's **Test** section from Phase 1: `yarn test`, how to run a single file (`node --test Commands/__tests__/pingCommand.test.js`), where the fixtures live and how to capture a new one from real CLI output, and a note that the no-match tests fail on purpose until Phase 3.

## Phase 3 — Correctness fixes

Each of these is a real defect, not a style preference:

1. **A throwing parser crashes the whole run.** In `Service/Commands/BaseCommand.js`, `onSuccess`/`onError` are invoked from the `exec` callback — *outside* the `new Promise` executor — so a `TypeError` in `parseOutput` becomes an uncaught exception rather than a rejection. This is the likely reason `DataUsedCommand` is commented out in `index.js:67`. Fix by rewriting `_execute` on top of `promisify(exec)` (or `execFile`) with `try/catch` around the parse, so a parse failure degrades to an error metric like every other failure.
2. **A command that never closes hangs the run forever.** The promise settles only in the `'close'` handler, and only `SpeedTestCommand` passes a `timeout`. With cron firing `frequent` every minute, one stuck `ping` accumulates processes indefinitely. Give every command a default timeout in `BaseCommand`.
3. **Influx writes are unverified.** `influxWriter.storeMetrics` calls `this.writeAPI.flush()` without awaiting the returned promise, and `close()` is never called, so write failures are invisible and nothing guarantees completion before the process exits. Make `storeMetrics` await, add a `close()` method, and have `runCommands` in `index.js` await all writes then close — one flush for the whole batch instead of one HTTP round trip per point.
4. **Garbage points on a malformed result.** `runCommands` pushes whatever it catches into `outputs`, then unconditionally calls `storeMetrics(output.metricName, ...)`. A non-metric throw yields `storeMetrics(undefined, undefined, undefined)` and a fieldless point. Guard on `metricName` being present and log a skip.
5. **`null` field values.** `CurlCommand` and `SpeedTestCommand` assign `match && match[1]`, so a non-match writes `null` into `floatField`. Omit unmatched fields instead, and emit the `*Error` measurement when nothing parsed.
6. **Broken log rotation.** `Service/containerScripts/cron-job-smart-home:4` copies to `/var/cron/log2.bak` — a directory that does not exist (the sibling line correctly uses `/var/log`). Moot once Phase 5 removes cron, but fix it if Phase 5 is deferred.
7. Make `InfluxWriter`'s constructor accept its config/client so it is injectable for the Phase 2 test, rather than reading `process.env` at module scope.
8. Fix the `INFLUS_PASS` typo in `Service/.env.template` (the code reads `INFLUX_PASS`), and add the missing `WAN_INTERFACE` used by `DataUsedCommand`.

## Phase 4 — Architecture

- **Collapse the command boilerplate.** All four commands repeat the same ~35-line `new Promise` + `tags`/`metrics`/`metricName` + success/error/close block; only four things actually vary: the shell command, the measurement name, the tags, and `parseOutput`. Turn `BaseCommand.execute` into a template method owning the promise, timeout, and error-metric construction, so each subclass declares `buildCommand(options)`, `metricName`, `errorMetricName`, `buildTags(options)`, and `parseOutput(stdout)`. Keeps the `command(CommandType, options)` factory and the `{metricName, metrics, tags}` contract intact, so `index.js` and the Grafana dashboard are unaffected. Expect the four command files to shrink by roughly half.
- **Make probe targets configuration, not code.** Move the `frequentCommands`/`infrequentCommands` arrays out of `index.js` into `Service/config/probes.js`, driven by comma-separated `PING_TARGETS` / `CURL_TARGETS` env vars (defaulting to today's list: wp.pl, pl.wikipedia.org, google.com, `$ROUTER_1`, 8.8.8.8). Adding a target becomes an `.env` edit plus a restart — no rebuild/push/pull cycle across the Pis. Add the new vars to `.env.template`.
- **Replace container cron with an in-process scheduler.** `index.js` becomes a long-running process with a small minute-aligned scheduler (~30 lines, no new dependency): `frequent` every minute, `infrequent` at `$SPEED_TEST_MINUTE`. Keep the existing one-shot CLI mode for ad-hoc runs and for the tests. This deletes all three files in `Service/containerScripts/`, the `printenv > env.docker.sh` dump and its fragile re-sourcing (it breaks on any value containing spaces or newlines), the log-rotation cron lines, and the `tail -f` PID-1 hack — and it makes Docker's `--restart unless-stopped` actually supervise the app instead of supervising `tail`. Trade-off to accept: a crash now pauses collection until Docker restarts the container, where cron would have retried the next minute independently; Docker's restart policy covers this, and container logs become the app's stdout.

## Phase 5 — Ops, deployment, CI

> **As implemented (2026-10-14)**, where it differs from the bullets below:
> - **No CI.** The user chose not to add a GitHub workflow.
> - **Port 8086 stays on the LAN, with InfluxDB auth enabled** instead of binding to `127.0.0.1`: the Pis write to Influx over the LAN, so a localhost bind would cut them off. Existing installs need a one-time migration (auth off → create admin → reset service password → auth on), documented and tested in `Infrastructure/README.md`.
> - **Node 22** image (`node:22.21.1-bookworm-slim`), not 20 or 24 (see the decisions at the top).
> - **cron is still in the service image**, because Phase 4 (in-process scheduler) hasn't happened. Drop `cron` from `Service/Dockerfile.service` as part of Phase 4. The `/var/cron/log2.bak` rotation bug (Phase 3 #6) was fixed now for the same reason.
> - The image's `INFLUXDB_DB`/`INFLUXDB_USER` init doesn't quote the DB name and fails on `smart-home-db`, so DB and user creation is a mounted init script, `Infrastructure/influxdb/init/create-db-and-user.sh`.
> - Grafana provisioning lives under `Infrastructure/grafana/`. The dashboard's two datasource uids (`Gv-wFIiRz`, `SmartHome`) were changed to `smart-home-influxdb`. `1ojbtE-Mz` is the dashboard's own uid and was kept, so provisioning takes over the already-imported copy.
> - **Two separate compose stacks, not one root file** (user decision: the halves were never meant to be together): `Infrastructure/docker-compose.yml` + `.env.template` (influxdb + grafana, on an infrastructure host that runs nothing else) and `Service/docker-compose.yml` + `.env.template` (each Pi, writing over the LAN). No profiles. `Service/.env` serves both compose and local `yarn` runs, so its `INFLUS_PASS` typo (Phase 3 #8) was fixed now.
> - Bind mounts under `DATA_DIR` (default `/var/lib/smart-home`) rather than named volumes, so existing data is used in place.
> - Found while doing this: `Service/.dockerignore` didn't exclude `.env`, so old images had the credentials baked in. Fixed.
> - READMEs: detailed `Infrastructure/README.md` (configure, fresh install, migration, operate, test, troubleshooting), `Service/README.md` updated for compose, and a short root `README.md`.


- **Service image**: `FROM ubuntu` + the 20-line nvm dance → `FROM node:20-bookworm-slim`, with `apt-get install -y iputils-ping curl ca-certificates speedtest-cli`. `speedtest-cli` is a packaged Debian/Ubuntu binary, which removes `wget get-pip.py`, `pip`, `python3-distutils`, and the PEP 668 problem entirely. Also drops `vim` and `cron`. Pin the tag so the build stays reproducible; `node:20-bookworm-slim` publishes `arm64` and `arm/v7`, so Pi 3 through Pi 5 all stay supported.
- **Infrastructure**: replace `Dockerfile.influx`, `Dockerfile.init-influx`, `containerScripts/initializeDB.sh`, and the ~200-line `influx-config-override.config` with the official `influxdb:1.8` image, configured by environment: `INFLUXDB_DB`, `INFLUXDB_USER`, `INFLUXDB_USER_PASSWORD`, `INFLUXDB_HTTP_FLUX_ENABLED=true` (the one setting the config override existed for). This also deletes the hardcoded `'haslo'` password currently committed in `initializeDB.sh`, and the `sleep 20` + separate init-container race in `infrastructure-run.sh`.
- **`docker-compose.yml`** (as implemented: one per half, see the note above) replacing `infrastructure-build.sh` / `infrastructure-run.sh` / `service-build.sh` / `service-run.sh`: influxdb + grafana + service, one network, named volumes matching today's `/var/lib/smart-home/*` bind mounts, `depends_on` with a healthcheck instead of `sleep 20`. Keep the service deployable on its own (the Pis run it against a remote Influx) via a compose profile or a service-only compose file.
- Publish Influx on `127.0.0.1:8086` rather than `0.0.0.0`. Note that Influx currently runs with `auth-enabled = false` while 8086 is exposed on the LAN, so the configured user/password is decorative today.
- **Grafana provisioning** so the dashboard is code, not a manual re-import: `grafana/provisioning/datasources/influxdb.yml` pinning a stable datasource uid, plus a dashboards provider pointing at the checked-in JSON. The export currently references three different datasource uids (`1ojbtE-Mz`, `Gv-wFIiRz`, `SmartHome`), which must be normalized to the provisioned uid. Rename the file to something without spaces (`grafana/dashboards/ping-all-sensors.json`).
- **CI** — `.github/workflows/ci.yml`: Node 20, install, `lint`, `node --test`, plus a `docker build` (buildx, no push) of both images. The build job is the one that would have caught this whole class of rot.
- Update the Build/Run sections written in Phase 1 for compose in `Service/README.md`, and update `Infrastructure/README.md` too, and refresh `CLAUDE.md` — most of its "Gotchas" section describes things these phases delete.

---

## Verification

- `cd Service && npm install && npm run lint && npm test` — lint clean, all tests green.
- One-shot behaviour, which is what cron used to do: `node ./index.js --once frequent` and `--once infrequent` against a local Influx from compose. Confirm in `docker logs` that each command resolves, then query Influx for the written points: `influx -database smart-home-db -execute 'SELECT * FROM ping ORDER BY time DESC LIMIT 5'` — check `computerTag` and `address` are present as tags and `min`/`avg`/`max`/`mdev` as float fields.
- Error paths, which are the point of Phase 3: run with `PING_TARGETS=no-such-host.invalid` and confirm the process does **not** crash, a `pingError` point is written, and the other commands in the batch still complete.
- `docker compose up -d --build` then `docker compose ps` — all three healthy. Open Grafana on :3000 and confirm the provisioned dashboard renders with the provisioned datasource and no manual import.
- Let the scheduler run ~3 minutes and confirm from `docker logs -f` that `frequent` fires each minute and `infrequent` fires once at `$SPEED_TEST_MINUTE`.
- Before/after sanity on the Grafana panels: the measurement and field names (`ping`, `pingError`, `curl`, `curlError`, `speedtest`, `speedtest-error`) must be byte-identical, or the dashboard silently goes blank. Worth diffing explicitly after Phase 4.

## Deliberately not doing

- **InfluxDB 1.8 → 2.x/3.** `influxWriter.js` already uses the 2.x client against 1.x via the `db/retention` bucket and `user:pass` token trick, so it technically works. Migrating means moving historical data, rewriting every dashboard query to Flux, and reworking auth — large, risky, and it buys this project nothing.
- **TypeScript** — decided against; the tests cover the parser contract.
- **Re-enabling `DataUsedCommand`** beyond fixing its crash: it needs `WAN_INTERFACE` and only makes sense on the router-adjacent host. Phase 3 makes it safe to turn on, but leave the `index.js` call commented until you want it.
