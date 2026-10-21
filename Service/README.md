# Smart Home Net Stats service

The service is a Node.js agent. It runs `ping`, `curl`, `dig` and the Ookla `speedtest` command. It reads their output and writes the results to InfluxDB as time series. In the installed system, the service runs in Docker. Cron starts the `frequent` batch (ping, curl and DNS) every minute. Cron starts the `infrequent` batch (speed test) one time each hour.

The service runs on each Pi that does measurements. It does not run on the infrastructure host. Each Pi writes to the InfluxDB on the infrastructure host through the LAN. Refer to `../Infrastructure/README.md`. Each Pi adds its `COMPUTER_NAME` as a tag to its data.

## Requirements

**For Docker** (the usual installation on the Pis): Docker with the Compose plugin. To examine it, do the command `docker compose version`. The image is available for amd64, arm64 and 32-bit arm/v7.

**To run the service without Docker** (for development):

* Node 22. The command `nvm use` reads the version from `.nvmrc`.
* yarn 1 (`npm install --global yarn`, or `npx yarn@1 ...`).

  CAUTION: If your shell tells you to do `sudo apt install cmdtest`, do not do it. The `yarn` command in that package is a different tool.

* The commands that the service runs: `ping`, `curl`, `dig` (package `dnsutils` on Debian and Ubuntu), `speedtest` (only for the `infrequent` batch) and `ifconfig` (only for the data-used command, which is off).
* The `speedtest` command must be the **official Ookla Speedtest CLI** (https://www.speedtest.net/apps/cli). The service reads its JSON output. Install it from the Ookla page. For Debian, Ubuntu and Raspberry Pi OS, the page has an apt repository.
* Do not use the `speedtest-cli` package. It is an older Python tool from sivel. It also installs a `/usr/bin/speedtest` command. It shows speeds that are too low on fast connections (approximately 700 Mbit/s, where Ookla shows 880 Mbit/s on the same gigabit line). Remove it before you install the Ookla tool (`sudo apt remove speedtest-cli`). The command `speedtest --version` must show `Speedtest by Ookla`. The Docker image installs the Ookla tool itself.
* An InfluxDB 1.8 that the computer can connect to. Refer to `../Infrastructure/README.md`.

## Configure

All of the configuration is in the file `.env` in this `Service/` directory. Make this file from `.env.template`. `docker compose` and the `yarn` commands use the same file. Git does not keep this file, and the image does not contain it.

```bash
cd Service
cp .env.template .env && nano .env
```

| Variable | Function |
| --- | --- |
| `INFLUX_HOST`, `INFLUX_PORT` | The LAN address of the infrastructure host, and `8086`. |
| `INFLUX_DB`, `INFLUX_RETENTION` | The database and the retention policy. The service joins them into the bucket `<db>/<retention>` (usually `autogen`). |
| `INFLUX_USER`, `INFLUX_PASS` | The InfluxDB user name and password. `INFLUX_DB`, `INFLUX_USER` and `INFLUX_PASS` must be the same as in `Infrastructure/.env` on the infrastructure host. InfluxDB checks the user name and password. |
| `ROUTER_1` | The address of your router. The service sends ping and curl requests to it, as to the other targets. |
| `COMPUTER_NAME` | The service writes this name as the `computerTag` tag on all data. Grafana uses it to show the Pis separately. Dashboard v2.0 shows new names automatically. Dashboard v1.0 shows only `pi3`, `pi4` and `pi5`. |
| `SPEED_TEST_MINUTE` | The minute of the hour (0–59) when this Pi does its speed test. A test uses all of the internet connection for approximately 25 seconds. Thus, give each Pi a different minute, with equal intervals (for 3 Pis: `0`, `20`, `40`). |
| `SPEED_TEST_SERVER_ID` | Optional. The ID of the Ookla server for all tests (`speedtest --servers` shows the servers near you). Use the same ID on all Pis. Then you can compare the results. If it is empty, Ookla selects the nearest server for each test. |
| `DNS_SERVERS` | Optional. More DNS resolvers to examine every minute, as `name=address` pairs with commas between them. For example: `local=10.0.0.53,router=10.0.0.1,public=1.1.1.1`. Use only the resolvers that this node can reach. The service always examines the usual resolver of the node ("system"). Refer to [DNS checks](#dns-checks). |
| `DNS_CACHED_NAME` | Optional. The name for the "cached" query. The default is `google.com`. |
| `DNS_UNCACHED_DOMAIN` | Optional. The domain for the random names of the "uncached" query. The default is `example.com`. |
| `SERVICE_IMAGE` | Only for Docker. `smart-home-service` to build the image on this computer, or your Docker Hub tag to download it (refer to [Build](#build)). |
| `DATA_DIR` | Only for Docker. The host directory for the logs (`<DATA_DIR>/service/`). The default is `/var/lib/smart-home`. |

## Build

### Without Docker

```bash
cd Service
yarn install
```

### The Docker image

Do this command in this `Service/` directory:

```bash
docker compose build
```

This command builds `Dockerfile.service` for the architecture of this computer. It gives the image the tag `$SERVICE_IMAGE`. The image is `node:22-bookworm-slim` with `ping`, `curl`, `dig`, the Ookla `speedtest` command and `cron`. The image contains only the production dependencies. The Ookla tool has the fixed version 1.2.0, and the build examines its checksum for each architecture.

You can build the image on each Pi, but this is slow. It is faster to build the image one time for all Pi architectures and send it to Docker Hub:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm,arm64   # once per build machine, enables ARM emulation
docker buildx create --use                                           # once per build machine
docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -f Dockerfile.service -t <docker_hub_id>/smart-home:service --push .
```

Then set `SERVICE_IMAGE=<docker_hub_id>/smart-home:service` in the `Service/.env` file on each Pi.

## Run

### On a Pi, in Docker

1. Copy this `Service/` directory to the Pi. You can clone the repository, or copy only `Service/`. Then do these commands:

   ```bash
   cd Service
   cp .env.template .env && nano .env
   ```

   Set these values: `INFLUX_HOST=<infrastructure host's LAN IP>`, the InfluxDB user name and password, `COMPUTER_NAME`, `ROUTER_1` and `SPEED_TEST_MINUTE` (a different minute on each Pi). Optionally, set `SPEED_TEST_SERVER_ID`.

2. Make the log directory and start the service:

   ```bash
   sudo mkdir -p /var/lib/smart-home/service
   docker compose pull              # if SERVICE_IMAGE points to Docker Hub
   docker compose up -d             # add --build to build locally instead
   ```

The container starts again automatically (`restart: unless-stopped`). The logs are in `/var/lib/smart-home/service/`. `cron.log` is for the `frequent` batch, and `cron2.log` is for the speed test. The command `docker compose logs -f service` shows only `cron.log`.

Do the `docker compose` commands in this `Service/` directory. To use a new image, do `docker compose pull && docker compose up -d`.

**Migrate from `service-run.sh`:** First, remove the old container (`docker stop smart-home-service && docker rm smart-home-service`). Then do the steps above. Use the new `INFLUX_PASS` from the migration of the infrastructure.

### Without Docker, one time

Do these commands in this `Service/` directory. `CurlCommand` starts `./timedcurl.sh` from the current directory.

```bash
yarn standalone-frequent      # pings + curls
yarn standalone-infrequent    # speed test
```

Each command runs the commands of the batch one after the other and writes each result to the log. Then it writes the results to InfluxDB and stops.

## Test

### Unit tests

Do these commands in this `Service/` directory:

```bash
yarn test                                                  # whole suite
node --test Commands/__tests__/speedTestCommand.test.js    # one file
yarn lint
```

The tests use the test runner that is part of Node (`node:test`). It is not necessary to install other software. The tests do not use the network.

* **Parsers:** The tests compare the result of `parseOutput` of each command with real output in `Commands/__tests__/fixtures/`. The README in that directory tells how each file was made and how to add a file. The tests also use variants with a comma as the decimal mark.
* **Speed test, all steps:** `SpeedTestCommand.execute` runs with a test `speedtest` script on the `PATH`. The tests use a successful result and the real Ookla failure (exit code 2).
* **`BaseCommand`:** The tests examine the success, error and close functions with real, simple shell commands.

The tests with the **`todo`** mark are for known errors. The plan has the repair of these errors (`../docs/IMPROVEMENT_PLAN.md`, Phase 3). The test runner shows these tests with ⚠ and lists them in the summary as "failing tests". They do not cause the test run to fail. When you repair one of these errors, remove the `todo` mark from its test. Then the test makes sure that the error does not occur again. A test run is successful when the last lines show `fail 0`.

These parts do not have unit tests yet: `InfluxWriter` and `index.js`. `InfluxWriter` reads its configuration when it is imported (plan, Phase 3 #7).

### With a real InfluxDB

If a change affects how the commands run or how the data is written, also do these steps:

1. **Run a batch one time and read the log.** For each target, the log must show `Found PING/CURL metrics ...`. For a target that does not reply, the log shows `... error for address ...`. The service then writes `pingError` or `curlError`. This is correct.

   ```bash
   yarn standalone-frequent                                                                          # locally
   docker compose exec service bash -c '. ./env.docker.sh; ./containerScripts/run-script.sh frequent'  # in the container
   ```

   After these lines, the log must not show `Write to InfluxDB failed`. If the log shows `401 Unauthorized`, the user name or password is not correct.

2. **Make sure that the data is in InfluxDB.** Do this command on the infrastructure host, in its `Infrastructure/` directory:

   ```bash
   source .env
   docker compose exec influxdb influx -username "$INFLUX_USER" -password "$INFLUX_PASS" -database "$INFLUX_DB" \
     -execute "SELECT * FROM ping WHERE computerTag = '<COMPUTER_NAME>' ORDER BY time DESC LIMIT 5"
   ```

   `address` and `computerTag` must be tags. `min`, `avg`, `max` and `mdev` must be float fields. You can do the same test for the `curl` and `speedtest` measurements.

The data that each batch writes:

| Measurement | Tags | Fields |
| --- | --- | --- |
| `ping` | `address`, `computerTag` | `avg`, `min`, `max`, `mdev` (ms), `packetsPercent`, `packetsSent` |
| `curl` | `address`, `computerTag` | `namelookup`, `connect`, `appconnect`, `pretransfer`, `starttransfer`, `total`: the time in seconds from the start of the request to each step (`appconnect` is 0 for HTTP without TLS) |
| `dns` | `computerTag`, `resolver`, `query` (`cached` or `uncached`) | `queryTime` (ms) |
| `speedtest` | `computerTag` | `download`, `upload` (Mbit/s), `ping`, `jitter` (ms), `packetLoss` (%, if the server measures it), `downloadLatency`, `uploadLatency` (ms, the latency while the test uses all of the connection), `serverId` |
| `pingError`, `curlError`, `speedtest-error`, `dnsError` | `computerTag` (and `address`, or `resolver` and `query`), `error` | `count` = 1 for each command that failed. For `dnsError`, `error` is `no reply` or the status of the resolver, for example `servfail`. |

CAUTION: Do not change the names of the measurements or the fields (`ping`, `pingError`, `curl`, `curlError`, `dns`, `dnsError`, `speedtest`, `speedtest-error`). The Grafana dashboards use these names. If a name changes, the dashboards show no data and no error.

### DNS checks

Every minute, the service sends DNS queries with `dig`. Each query goes to one resolver:

* "system": the usual resolver of the node. Applications use this resolver. The service always examines it.
* Each resolver in `DNS_SERVERS`. The service sends the query directly to the address of that resolver.

The service sends two queries to each resolver:

* "cached": a query for `DNS_CACHED_NAME`. The resolver usually has this name in its memory. Thus, this query measures the path to the resolver.
* "uncached": a query for a new random name in `DNS_UNCACHED_DOMAIN`. A local resolver (for example a Pi-hole or a router) must ask its upstream server. Thus, this query also measures the upstream path. A large public resolver can answer it from its memory.

If a resolver does not reply, or replies with an error (for example SERVFAIL), the service writes `dnsError`.

Use the results to find which device makes DNS slow:

* If only "system" is slow, the problem is on the node.
* If a local resolver is slow for "cached" queries, the problem is that resolver or the path to it.
* If a local resolver is slow only for "uncached" queries, the problem is its upstream server.
* If the public resolver is also slow, the problem is the internet connection.

Each query takes approximately 1–100 ms. If a resolver does not reply, the query stops after 2 seconds.

### Speed test: tool, schedule and cost

The speed test uses the **official Ookla Speedtest CLI**. It replaced the `speedtest-cli` tool from sivel. The older tool showed speeds that were approximately 20 % too low on a gigabit line. Thus, the bandwidth charts show a step up at the time of the change.

Each Pi does one test each hour, at its `SPEED_TEST_MINUTE`. On a 1000/100 Mbit/s line, one test transfers approximately **1.2 GB**. Thus, 3 Pis use approximately 85 GB each day (approximately 2.6 TB each month). During a test, the test uses all of the connection for approximately 25 seconds. Thus, the ping and curl results of that minute show a higher latency on all Pis.

**Licence:** You can use the Ookla tool only for personal use that is not commercial (https://www.speedtest.net/about/eula). The built image contains the Ookla program.

CAUTION: Read the EULA before you send the image to a **public** Docker Hub repository. A private repository, or a build on each Pi, prevents this problem.

A Pi can measure only the speed of its own connection. The Ethernet connection of a Raspberry Pi 3B+ has a maximum of approximately 300 Mbit/s. A Pi 3B has a maximum of 100 Mbit/s. Wi-Fi usually has 100–300 Mbit/s. Only a Pi 4 or a Pi 5 with a cable can measure a gigabit plan.

## Troubleshooting

**`Write to InfluxDB failed ... 401 Unauthorized`.** `INFLUX_USER` or `INFLUX_PASS` is different from the values on the infrastructure host. Correct `.env`. Then do `docker compose up -d`. This command makes the container again with the new values.

**`Operation not permitted` from cron or other tools, on an older 32-bit Raspberry Pi OS (Buster).** The `libseccomp2` of the host is too old for the Debian 12 image. Install `libseccomp2` 2.4.4 or newer from buster-backports. Then start Docker again. For more data, refer to https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build

**The speed test always fails (`speedtest-error`) without Docker.** Do the command `speedtest --version`. If the output is not `Speedtest by Ookla`, the `speedtest-cli` package from sivel is installed. Remove that package. The Ookla tool writes its licence text to the cron log for each test. This is correct.

**The ping commands are very slow.** Set a static DNS server, for example your router: https://pimylifeup.com/raspberry-pi-dns-settings/
