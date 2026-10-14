# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted home-network monitoring stack, run on Raspberry Pis. A Node.js agent (`Service/`) periodically shells out to `ping`, `curl`, `speedtest-cli` and `ifconfig`, parses their stdout into metrics, and writes them as InfluxDB time series. `Infrastructure/` holds the config for InfluxDB 1.8 + Grafana (official images) that store and chart them. The two halves are **separate, independently deployed stacks** — each has its own `docker-compose.yml` and `.env`. `Infrastructure/` (influxdb + grafana) runs on one infrastructure host that runs **nothing else**; `Service/` runs on each measuring Pi and writes to Influx over the LAN. Never merge them into one compose file.

## Commands

All service commands run from `Service/`:

```bash
yarn install
yarn standalone-frequent      # run the frequent command batch once (ping + curl)
yarn standalone-infrequent    # run the infrequent command batch once (speedtest)
yarn lint                     # ESLint 9, flat config in eslint.config.js
```

Docker — run from `Infrastructure/` (influxdb + grafana) or `Service/` (the agent); each reads the `.env` in its own directory:

```bash
docker compose up -d --wait           # Infrastructure/
docker compose up -d --build          # Service/
docker compose ps / logs -f
```

There is no test framework yet — no test runner, test files, or test script (planned for Phase 2 of `docs/IMPROVEMENT_PLAN.md`). `Service/README.md` has the manual check: lint, a one-shot run, then query Influx.

Each half has its own `.env` from its own `.env.template`. `Service/.env` serves both `docker compose` (passed in as explicit `environment:` entries) and local `yarn` runs (`dotenv`); it is not copied into the image (`.dockerignore`). `INFLUX_DB`/`INFLUX_USER`/`INFLUX_PASS` must match between `Infrastructure/.env` and every Pi's `Service/.env`.

## Architecture

**Command pattern.** `Service/Commands/BaseCommand.js` exports a `command(CommandType, options)` factory plus a `BaseCommand._execute(cmd, name, {onSuccess, onError, onClose}, params)` helper that wraps `child_process.exec`. Each concrete command (`PingCommand`, `CurlCommand`, `SpeedTestCommand`, `DataUsedCommand`) subclasses it and:

- returns a Promise from `execute(options)` that settles in the `onClose` callback — `resolve` on exit code 0, `reject` otherwise;
- resolves/rejects with the same shape `{ metricName, metrics, tags }`, so a rejection is still a usable metric (the error path sets `metricName` to e.g. `pingError` and emits `{count: 1}` with an `error` tag);
- has a `parseOutput(stdout)` that regex-scrapes CLI output. These parsers are locale-sensitive: they all normalise comma decimal separators to dots.

`index.js` holds the batch definitions as arrays of `[CommandClass, options]` pairs — `frequentCommands` (pings and curls to the router, Google, Wikipedia, wp.pl, 8.8.8.8) and `infrequentCommands` (speedtest). It picks a batch by scanning `process.argv` for the literal `frequent`/`infrequent`, runs the commands **sequentially** (so timing measurements don't contend), then writes every result to Influx.

**Influx layer.** `Service/Influx/influxWriter.js` uses the 2.x `@influxdata/influxdb-client` against a 1.x server: the bucket is `"<INFLUX_DB>/<INFLUX_RETENTION>"`, the org is `''`, and the token is `"<INFLUX_USER>:<INFLUX_PASS>"`. Reads use Flux (hence `INFLUXDB_HTTP_FLUX_ENABLED=true` in compose). Influx auth is **on** (`INFLUX_AUTH_ENABLED`), so the service's user/pass must be valid — a mismatch shows up as `401 Unauthorized` in the cron log. All metric values are written as float fields; `tags` become Influx tags, so `computerTag` (from `COMPUTER_NAME`) is what separates data from each Pi in Grafana.

**Scheduling happens in cron inside the container**, not in Node. `containerScripts/init-container-script.sh` dumps the container env to `env.docker.sh` (cron has no env of its own), appends an `infrequent` line built from `$SPEED_TEST_MINUTE` to a copy of `containerScripts/cron-job-smart-home`, installs it in `/etc/cron.d/`, starts `cron` and tails `/var/log/cron.log` to keep PID 1 alive. The frequent batch runs every minute. Each cron line sources `env.docker.sh` then calls `run-script.sh <batch>`, which `cd`s to `/var/smart-home` and runs the matching yarn script. `cron-job-smart-home` must keep its trailing blank line.

**Infrastructure.** No custom images. `Infrastructure/influxdb/init/create-db-and-user.sh` is mounted into `/docker-entrypoint-initdb.d` and runs only on first start with an empty data dir; it replaces the image's own `INFLUXDB_DB`/`INFLUXDB_USER` handling, which doesn't quote the DB name and fails on `smart-home-db`. Don't set `INFLUXDB_DB`/`INFLUXDB_USER` in compose. Grafana's datasource (uid `smart-home-influxdb`) and dashboards are provisioned from `Infrastructure/grafana/`.

The Grafana dashboard is `Infrastructure/grafana/dashboards/ping-all-sensors.json`, loaded by provisioning (UI saves are disabled; replace the file instead). Every datasource reference in it must use uid `smart-home-influxdb`. It queries the `ping`, `pingError`, `curl`, `curlError`, `speedtest` and `speedtest-error` measurements, so renaming a `metricName` breaks it.

## Gotchas

- `DataUsedCommand` is wired up but disabled: the `measureDataUsed(...)` call in `index.js` is commented out. It depends on `WAN_INTERFACE`, which is not in `.env.template`.
- The service is native ESM (`"type": "module"`, Node 22 per `.nvmrc` and the image; no Babel): relative imports need the `.js` extension, and `dotenv` is loaded with `import 'dotenv/config'`.
- `index.js` picks the batch by scanning `process.argv` for `frequent`/`infrequent`; there is no arg-parsing library.
- `CurlCommand` invokes `./timedcurl.sh` relative to `process.cwd()`, so the service must be started from `Service/` (or `/var/smart-home` in the container).
- ESLint style here is 4-space indent, single quotes, **no semicolons**, unix line endings.
- Some Pis run 32-bit Raspberry Pi OS (arm/v7). Every image must publish `linux/arm/v7` — that rules out `node:24` (no arm/v7). Check with `docker manifest inspect <image>` before bumping a tag.
