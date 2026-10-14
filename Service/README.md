# Smart Home Net Stats service

A Node.js agent that runs `ping`, `curl` and Ookla's `speedtest`, parses their output and writes the results to InfluxDB as time series. In production it runs in Docker, where cron fires the `frequent` batch (pings + curls) every minute and the `infrequent` batch (speed test) once an hour.

It runs on every Pi you want to measure from, never on the infrastructure host. Each one writes to the single InfluxDB on the infrastructure host (see `../Infrastructure/README.md`) over the LAN, tagged with its own `COMPUTER_NAME`.

## Prerequisites

**For Docker** (how it runs on the Pis): Docker with the Compose plugin (`docker compose version`). Supported: amd64, arm64 and 32-bit arm/v7.

**To run it locally** (outside Docker, for development):

* Node 22. `nvm use` picks the version up from `.nvmrc`.
* yarn 1 (`npm install --global yarn`, or `npx yarn@1 ...`). If your shell suggests `sudo apt install cmdtest`, don't. That package's `yarn` is an unrelated tool.
* The CLI tools the commands shell out to: `ping`, `curl`, `speedtest` (only for the `infrequent` batch) and `ifconfig` (only for the disabled data-used command).
* `speedtest` must be **Ookla's official Speedtest CLI** (https://www.speedtest.net/apps/cli); the parser reads its JSON output. Install it from Ookla's page above (Debian/Ubuntu/Raspberry Pi OS have an apt repository there). It is **not** the `speedtest-cli` package: that is sivel's older Python tool, it also installs a `/usr/bin/speedtest`, and it under-reports fast connections (about 700 vs Ookla's 880 Mbit/s on the same gigabit line). Remove it first (`sudo apt remove speedtest-cli`). `speedtest --version` should print `Speedtest by Ookla`. The Docker image installs Ookla's CLI itself.
* A reachable InfluxDB 1.8. See `../Infrastructure/README.md`.

## Configure

All configuration lives in `.env` in this `Service/` directory, copied from `.env.template`. The same file is used by `docker compose` and by local `yarn` runs. It is git-ignored and not copied into the image.

```bash
cd Service
cp .env.template .env && nano .env
```

| Variable | Purpose |
| --- | --- |
| `INFLUX_HOST`, `INFLUX_PORT` | The infrastructure host's LAN address, and `8086`. |
| `INFLUX_DB`, `INFLUX_RETENTION` | Database and retention policy. They are combined into the bucket `<db>/<retention>` (usually `autogen`). |
| `INFLUX_USER`, `INFLUX_PASS` | InfluxDB credentials. `INFLUX_DB`, `INFLUX_USER` and `INFLUX_PASS` must match `Infrastructure/.env` on the infrastructure host; authentication is enforced. |
| `ROUTER_1` | Address of your router. It is pinged and curled with the other targets. |
| `COMPUTER_NAME` | Written as the `computerTag` tag on every point. This is what tells the Pis apart in Grafana. Dashboard v2.0 picks up new names automatically; v1.0 only shows `pi3`, `pi4`, `pi5`. |
| `SPEED_TEST_MINUTE` | Minute of the hour (0–59) at which this Pi runs its hourly speed test. A test saturates the whole internet connection for ~25 s, so give each Pi its own minute, spread evenly (3 Pis: `0`, `20`, `40`). |
| `SPEED_TEST_SERVER_ID` | Optional. Ookla server ID to always test against (`speedtest --servers` lists nearby ones). Use the same ID on every Pi so results are comparable. Empty: nearest server each time. |
| `SERVICE_IMAGE` | Docker only. `smart-home-service` to build locally, or your Docker Hub tag to pull (see [Build](#build)). |
| `DATA_DIR` | Docker only. Host directory for logs (`<DATA_DIR>/service/`), default `/var/lib/smart-home`. |

## Build

### Locally

```bash
cd Service
yarn install
```

### The Docker image

From this `Service/` directory:

```bash
docker compose build
```

This builds `Dockerfile.service` for the current machine's architecture and tags it `$SERVICE_IMAGE`. The image is `node:22-bookworm-slim` with `ping`, `curl`, Ookla's `speedtest` (pinned to 1.2.0, checksum-verified per architecture) and `cron`, plus production dependencies only.

Building on each Pi works but is slow. Instead, build once for all Pi architectures and push to Docker Hub:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm,arm64   # once per build machine, enables ARM emulation
docker buildx create --use                                           # once per build machine
docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -f Dockerfile.service -t <docker_hub_id>/smart-home:service --push .
```

Then set `SERVICE_IMAGE=<docker_hub_id>/smart-home:service` in each Pi's `Service/.env`.

## Run

### On a Pi, in Docker

1. Get this `Service/` directory onto the Pi (clone the repository, or copy just `Service/`), then:

   ```bash
   cd Service
   cp .env.template .env && nano .env
   ```

   Set `INFLUX_HOST=<infrastructure host's LAN IP>`, the Influx credentials, `COMPUTER_NAME`, `ROUTER_1`, `SPEED_TEST_MINUTE` (different on every Pi) and, optionally, `SPEED_TEST_SERVER_ID`.

2. Create the log directory and start:

   ```bash
   sudo mkdir -p /var/lib/smart-home/service
   docker compose pull              # if SERVICE_IMAGE points to Docker Hub
   docker compose up -d             # add --build to build locally instead
   ```

The container restarts on its own (`restart: unless-stopped`). Logs land in `/var/lib/smart-home/service/`: `cron.log` for the `frequent` batch and `cron2.log` for the speed test. `docker compose logs -f service` follows `cron.log` only.

Run `docker compose` commands from this `Service/` directory. To update to a new image: `docker compose pull && docker compose up -d`.

**Migrating from `service-run.sh`:** remove the old container first (`docker stop smart-home-service && docker rm smart-home-service`), then follow the steps above. Use the new `INFLUX_PASS` set during the infrastructure migration.

### Locally, once

Run these from this `Service/` directory. `CurlCommand` calls `./timedcurl.sh` relative to the working directory.

```bash
yarn standalone-frequent      # pings + curls
yarn standalone-infrequent    # speed test
```

Each run executes the batch sequentially, logs every result, then writes them to Influx and exits.

## Test

### Unit tests

From this `Service/` directory:

```bash
yarn test                                                  # whole suite
node --test Commands/__tests__/speedTestCommand.test.js    # one file
yarn lint
```

They use Node's built-in test runner (`node:test`), so there is nothing extra to install, and they need no network:

* **Parsers:** each command's `parseOutput` is checked against real captured output in `Commands/__tests__/fixtures/` (see the README there for how each file was captured and how to add one), including comma-decimal variants.
* **Speed test end to end:** `SpeedTestCommand.execute` runs against a fake `speedtest` script put on `PATH`, covering both a successful result and Ookla's real failure (exit code 2).
* **`BaseCommand`:** the success/error/close callback contract, against real trivial shell commands.

Tests marked **`todo`** describe known bugs that are planned to be fixed (`../docs/IMPROVEMENT_PLAN.md`, Phase 3). They are reported with ⚠ and listed under "failing tests" in the summary, but they don't fail the run. When you fix one, remove its `todo` option so it guards the fix. A run passes when it ends with `fail 0`.

Not covered by unit tests yet: `InfluxWriter` (it reads its config at import time; plan, Phase 3 #7) and `index.js`.

### Against a real InfluxDB

For a change that touches running commands or writing data, also check a real run:

1. **Run a batch once and read the log.** Each target should print `Found PING/CURL metrics ...`. An unreachable target prints `... error for address ...` and is recorded as `pingError`/`curlError`, which is expected.

   ```bash
   yarn standalone-frequent                                                                          # locally
   docker compose exec service bash -c '. ./env.docker.sh; ./containerScripts/run-script.sh frequent'  # in the container
   ```

   No `Write to InfluxDB failed` lines should follow. A `401 Unauthorized` there means the credentials are wrong.

2. **Confirm the points reached Influx.** On the infrastructure host, from its `Infrastructure/` directory:

   ```bash
   source .env
   docker compose exec influxdb influx -username "$INFLUX_USER" -password "$INFLUX_PASS" -database "$INFLUX_DB" \
     -execute "SELECT * FROM ping WHERE computerTag = '<COMPUTER_NAME>' ORDER BY time DESC LIMIT 5"
   ```

   `address` and `computerTag` should be tags, and `min`/`avg`/`max`/`mdev` float fields. The same check works for the `curl` and `speedtest` measurements.

What each batch writes:

| Measurement | Tags | Fields |
| --- | --- | --- |
| `ping` | `address`, `computerTag` | `avg`, `min`, `max`, `mdev` (ms), `packetsPercent`, `packetsSent` |
| `curl` | `address`, `computerTag` | `namelookup`, `connect`, `appconnect`, `pretransfer`, `starttransfer`, `total`: cumulative seconds from the start of the request (`appconnect` is 0 for plain HTTP) |
| `speedtest` | `computerTag` | `download`, `upload` (Mbit/s), `ping`, `jitter` (ms), `packetLoss` (%, when the server reports it), `downloadLatency`, `uploadLatency` (ms, latency while the link is saturated), `serverId` |
| `pingError`, `curlError`, `speedtest-error` | `computerTag` (+ `address`), `error` | `count` = 1 per failed command |

Don't rename measurements or fields (`ping`, `pingError`, `curl`, `curlError`, `speedtest`, `speedtest-error`). The Grafana dashboard queries them by name and silently goes blank.

### Speed test: tool, schedule and cost

The speed test uses **Ookla's official Speedtest CLI**, which replaced sivel's `speedtest-cli`. Results from before the switch were measured with the older tool and are about 20 % lower on a gigabit line, so expect a step up in the bandwidth charts at the switch.

Each Pi runs one test an hour, at its own `SPEED_TEST_MINUTE`. One test transfers about **1.2 GB** on a 1000/100 Mbit/s line, so 3 Pis use about 85 GB a day (~2.6 TB a month). During a test the connection is saturated for ~25 s, so ping and curl results from that minute (on every Pi) show higher latency.

**Licence:** Ookla's CLI is free for personal, non-commercial use only (https://www.speedtest.net/about/eula). The binary is inside the built image, so check the EULA before pushing the image to a **public** Docker Hub repository. A private repository, or building on each Pi, avoids the question.

Note that a Pi can only measure what its own connection allows: a Raspberry Pi 3B+ tops out around 300 Mbit/s over Ethernet (100 Mbit/s on a Pi 3B), and Wi-Fi is usually 100–300 Mbit/s. Only a wired Pi 4 or 5 can confirm a gigabit plan.

## Troubleshooting

**`Write to InfluxDB failed ... 401 Unauthorized`.** `INFLUX_USER`/`INFLUX_PASS` don't match the infrastructure host. Fix `.env`, then `docker compose up -d` (this recreates the container with the new values).

**`Operation not permitted` from cron or other tools, on an older 32-bit Raspberry Pi OS (Buster).** The host's `libseccomp2` is too old for the Debian 12 image. Install `libseccomp2` 2.4.4 or newer from buster-backports, then restart Docker. Details: https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build

**Speed test always fails (`speedtest-error`) when running locally.** Check `speedtest --version`: if it is not `Speedtest by Ookla`, sivel's `speedtest-cli` package is shadowing it; remove that package. In the cron log, Ookla prints its licence notice on every run; that is expected.

**Very slow PING execution.** Set a static DNS server (e.g. your router): https://pimylifeup.com/raspberry-pi-dns-settings/
