# Smart Home Net Stats service

A Node.js agent that runs `ping`, `curl` and `speedtest-cli`, parses their output and writes the results to InfluxDB as time series. In production it runs in Docker, where cron fires the `frequent` batch every minute and the `infrequent` batch once an hour.

## Prerequisites

To run it locally (outside Docker):

* Node 20+. `nvm use` picks the version up from `.nvmrc`.
* yarn 1 (`npm install --global yarn`, or `npx yarn@1 ...`). If your shell suggests `sudo apt install cmdtest`, don't. That package's `yarn` is an unrelated tool.
* The CLI tools the commands shell out to: `ping`, `curl`, `speedtest-cli` (only for the `infrequent` batch) and `ifconfig` (only for the disabled data-used command).
* `speedtest-cli` must be the Python tool by sivel (https://github.com/sivel/speedtest-cli), **not** Ookla's official `speedtest` CLI. The parser expects the output of `speedtest-cli --simple` (`Download: 93.12 Mbit/s`), which Ookla's tool doesn't support. Install it with `sudo apt install speedtest-cli` on Debian/Ubuntu/Raspberry Pi OS, or `pipx install speedtest-cli`. The Docker image installs it from PyPI with `pip`.
* A reachable InfluxDB 1.8 with Flux enabled. See `../Infrastructure/README.md`.

To build and run the container you only need Docker.

## Configure

Copy `.env.template` to `.env` and fill it in. The same file feeds the local run, the Docker build and the container runtime.

| Variable | Purpose |
| --- | --- |
| `ROUTER_1` | Address of your router. It is pinged and curled with the other targets. |
| `INFLUX_HOST`, `INFLUX_PORT` | Where InfluxDB listens. |
| `INFLUX_DB`, `INFLUX_RETENTION` | Database and retention policy. They are combined into the bucket `<db>/<retention>` (usually `autogen`). |
| `INFLUX_USER`, `INFLUX_PASS` | Influx credentials. |
| `COMPUTER_NAME` | Written as the `computerTag` tag on every point. This is what tells the Pis apart in Grafana. |
| `SPEED_TEST_MINUTE` | Minute of the hour at which the container runs the speed test. |

> **Note:** the template spells the password variable `INFLUS_PASS`. The code reads `INFLUX_PASS`, so use that name in your `.env`.

## Build

Locally:

> yarn install

The Docker image:

> ./service-build.sh

To push it to Docker Hub:

> docker tag smart-home-service:latest <your_docker_hub_id/image_name:tag> <br>
> docker push <your_docker_hub_id/image_name:tag>

## Run

### Locally, once

Run these from this `Service/` directory. `CurlCommand` calls `./timedcurl.sh` relative to the working directory.

> yarn standalone-frequent &nbsp;&nbsp;&nbsp;# pings + curls <br>
> yarn standalone-infrequent &nbsp;# speed test

Each run executes the batch sequentially, logs every result, then writes them to Influx and exits.

### In Docker

On the target machine, pull the image if you built it elsewhere:

> docker pull <your_docker_hub_id/image_name:tag> <br>
> docker tag <your_docker_hub_id/image_name:tag> smart-home-service:latest

Put a `.env` next to `service-run.sh`, then:

> ./service-run.sh

This (re)creates the `smart-home-service` container with `--restart unless-stopped`. Logs land on the host in `/var/lib/smart-home/service/`: `cron.log` for the `frequent` batch and `cron2.log` for the speed test. `docker logs -f smart-home-service` follows `cron.log` only.

## Test

There are no unit tests yet. A test runner (`node --test`) is planned; see `../docs/IMPROVEMENT_PLAN.md`, Phase 2. Until then, check a change like this:

1. Lint:

   > yarn lint

2. Run a batch once and read the log. Each target should print `Found PING/CURL metrics ...`. An unreachable target prints `... error for address ...` and is recorded as `pingError`/`curlError`, which is expected.

   > yarn standalone-frequent

3. Confirm the points reached Influx (from the Influx host or container):

   > influx -database <INFLUX_DB> -execute 'SELECT * FROM ping ORDER BY time DESC LIMIT 5'

   `address` and `computerTag` should be tags, and `min`/`avg`/`max`/`mdev` float fields. The same check works for the `curl` and `speedtest` measurements.

Don't rename measurements or fields (`ping`, `pingError`, `curl`, `curlError`, `speedtest`, `speedtest-error`). The Grafana dashboard queries them by name and silently goes blank.

## Troubleshooting

Operation not permitted (cron)
-> https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build

Very slow PING execution
-> Set the static DNS server (e.g. pointing to your router) https://pimylifeup.com/raspberry-pi-dns-settings/
