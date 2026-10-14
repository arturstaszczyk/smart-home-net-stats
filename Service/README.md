# Smart Home Net Stats service

A Node.js agent that runs `ping`, `curl` and `speedtest-cli`, parses their output and writes the results to InfluxDB as time series. In production it runs in Docker, where cron fires the `frequent` batch (pings + curls) every minute and the `infrequent` batch (speed test) once an hour.

It runs on every Pi you want to measure from, never on the infrastructure host. Each one writes to the single InfluxDB on the infrastructure host (see `../Infrastructure/README.md`) over the LAN, tagged with its own `COMPUTER_NAME`.

## Prerequisites

**For Docker** (how it runs on the Pis): Docker with the Compose plugin (`docker compose version`). Supported: amd64, arm64 and 32-bit arm/v7.

**To run it locally** (outside Docker, for development):

* Node 22. `nvm use` picks the version up from `.nvmrc`.
* yarn 1 (`npm install --global yarn`, or `npx yarn@1 ...`). If your shell suggests `sudo apt install cmdtest`, don't. That package's `yarn` is an unrelated tool.
* The CLI tools the commands shell out to: `ping`, `curl`, `speedtest-cli` (only for the `infrequent` batch) and `ifconfig` (only for the disabled data-used command).
* `speedtest-cli` must be the Python tool by sivel (https://github.com/sivel/speedtest-cli), **not** Ookla's official `speedtest` CLI. The parser expects the output of `speedtest-cli --simple` (`Download: 93.12 Mbit/s`), which Ookla's tool doesn't support. Install it with `sudo apt install speedtest-cli` on Debian/Ubuntu/Raspberry Pi OS, or `pipx install speedtest-cli`. The Docker image installs the same Debian package.
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
| `COMPUTER_NAME` | Written as the `computerTag` tag on every point. This is what tells the Pis apart in Grafana; it must be listed in the dashboard's `SensorID` dropdown. |
| `SPEED_TEST_MINUTE` | Minute of the hour at which the container runs the speed test. Give each Pi a different minute so their tests don't compete for bandwidth. |
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

This builds `Dockerfile.service` for the current machine's architecture and tags it `$SERVICE_IMAGE`. The image is `node:22-bookworm-slim` with `ping`, `curl`, `speedtest-cli` and `cron`, plus production dependencies only.

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

   Set `INFLUX_HOST=<infrastructure host's LAN IP>`, the Influx credentials, `COMPUTER_NAME`, `ROUTER_1` and `SPEED_TEST_MINUTE`.

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

There are no unit tests yet. A test runner (`node --test`) is planned; see `../docs/IMPROVEMENT_PLAN.md`, Phase 2. Until then, check a change like this:

1. **Lint:**

   ```bash
   yarn lint
   ```

2. **Run a batch once and read the log.** Each target should print `Found PING/CURL metrics ...`. An unreachable target prints `... error for address ...` and is recorded as `pingError`/`curlError`, which is expected.

   ```bash
   yarn standalone-frequent                                                                          # locally
   docker compose exec service bash -c '. ./env.docker.sh; ./containerScripts/run-script.sh frequent'  # in the container
   ```

   No `Write to InfluxDB failed` lines should follow. A `401 Unauthorized` there means the credentials are wrong.

3. **Confirm the points reached Influx.** On the infrastructure host, from its `Infrastructure/` directory:

   ```bash
   source .env
   docker compose exec influxdb influx -username "$INFLUX_USER" -password "$INFLUX_PASS" -database "$INFLUX_DB" \
     -execute "SELECT * FROM ping WHERE computerTag = '<COMPUTER_NAME>' ORDER BY time DESC LIMIT 5"
   ```

   `address` and `computerTag` should be tags, and `min`/`avg`/`max`/`mdev` float fields. The same check works for the `curl` and `speedtest` measurements.

Don't rename measurements or fields (`ping`, `pingError`, `curl`, `curlError`, `speedtest`, `speedtest-error`). The Grafana dashboard queries them by name and silently goes blank.

## Troubleshooting

**`Write to InfluxDB failed ... 401 Unauthorized`.** `INFLUX_USER`/`INFLUX_PASS` don't match the infrastructure host. Fix `.env`, then `docker compose up -d` (this recreates the container with the new values).

**`Operation not permitted` from cron or other tools, on an older 32-bit Raspberry Pi OS (Buster).** The host's `libseccomp2` is too old for the Debian 12 image. Install `libseccomp2` 2.4.4 or newer from buster-backports, then restart Docker. Details: https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build

**Very slow PING execution.** Set a static DNS server (e.g. your router): https://pimylifeup.com/raspberry-pi-dns-settings/
