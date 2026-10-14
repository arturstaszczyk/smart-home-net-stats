# Smart Home Net Stats: infrastructure

The storage and charting half of the stack:

* **InfluxDB 1.8** (`influxdb:1.8.10`, official image) stores the time series the service writes.
* **Grafana** (`grafana/grafana:12.0.2`) charts them. Its datasource and the dashboard are provisioned from files in this directory, so there is nothing to import by hand.

Both run from `docker-compose.yml` in this directory, on one **infrastructure host** that runs nothing else. The measuring service is a separate stack in `../Service/` that runs on the Pis; see `../Service/README.md`.

```
 Pi (Service/) ──┐
 Pi (Service/) ──┼──LAN──▶ :8086 InfluxDB ◀── Grafana :3000 ◀── browser
 Pi (Service/) ──┘          infrastructure host (Infrastructure/)
```

## What's in this directory

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | InfluxDB + Grafana. |
| `.env.template` | Configuration template; copy to `.env`. |
| `influxdb/init/create-db-and-user.sh` | Runs once, on the first start with an empty data dir: creates the database and the service user. |
| `grafana/provisioning/datasources/influxdb.yml` | The InfluxDB datasource (uid `smart-home-influxdb`), configured from `.env`. |
| `grafana/provisioning/dashboards/smart-home.yml` | Tells Grafana to load every JSON file in `grafana/dashboards/`. |
| `grafana/dashboards/network-health-v2.0.json` | **Network health v2.0**, the main dashboard (see [Dashboards](#dashboards)). |
| `grafana/dashboards/ping-all-sensors-v1.0.json` | **Ping dashboard v1.0**, the original dashboard, kept for comparison. |
| `tools/generate-network-health-dashboard.py` | Generates `network-health-v2.0.json`. Edit this, not the JSON (see [Change a dashboard](#change-a-dashboard)). |

## Prerequisites

* Docker with the Compose plugin (`docker compose version`).
* Supported host architectures: amd64, arm64 and 32-bit arm/v7 (Raspberry Pi OS 32-bit). All three images publish them.
* Ports **8086** (InfluxDB) and **3000** (Grafana) free on the host.

## Configure

All configuration lives in `.env` in this directory, copied from `.env.template`. It is git-ignored.

```bash
cd Infrastructure
cp .env.template .env
```

| Variable | Purpose |
| --- | --- |
| `DATA_DIR` | Host directory for persistent data, default `/var/lib/smart-home`. InfluxDB uses `influx/`, Grafana `grafana/`. |
| `INFLUX_DB` | Database name, e.g. `smart-home-db`. |
| `INFLUX_USER`, `INFLUX_PASS` | The account the service writes with and Grafana reads with. Every Pi's `Service/.env` needs the same values (and the same `INFLUX_DB`). |
| `INFLUX_ADMIN_USER`, `INFLUX_ADMIN_PASS` | InfluxDB admin, for user management. |
| `INFLUX_AUTH_ENABLED` | `true` (default). Set to `false` only temporarily; see [Migrating](#migrating-from-the-old-scripts). |

`INFLUX_DB`, `INFLUX_USER`, `INFLUX_PASS` and the admin pair are **only applied when InfluxDB starts with an empty data dir**. To change them later, change them in InfluxDB too (see [Manage users](#manage-influxdb-users)). Avoid single quotes (`'`) in passwords; the init script passes them inside InfluxQL quotes.

## Fresh install

From this `Infrastructure/` directory:

```bash
sudo mkdir -p /var/lib/smart-home/influx /var/lib/smart-home/grafana
sudo chown 472:472 /var/lib/smart-home/grafana     # Grafana runs as uid 472
cp .env.template .env && nano .env                  # set the passwords
docker compose up -d --wait
```

On first start InfluxDB creates the admin, the database and the service user, then restarts. `--wait` returns once InfluxDB reports healthy. Grafana takes about 10 more seconds to answer on `http://<host>:3000`.

## Migrating from the old scripts

The old setup (`infrastructure-run.sh`) ran InfluxDB with **authentication disabled** and created only a non-admin user. Turning authentication on with no admin locks out every request, including creating an admin. So the migration briefly runs with auth off to create one. The data in `/var/lib/smart-home/influx` is used as-is. Run the steps from this `Infrastructure/` directory.

1. **Stop and remove the old containers and network.** Data lives on the host, so this doesn't touch it:

   ```bash
   docker stop grafana influxdb
   docker rm grafana influxdb
   docker network rm smart-home
   ```

   If an old `smart-home-service` container also runs on this host, remove it too (`docker stop smart-home-service && docker rm smart-home-service`). The service doesn't run on the infrastructure host any more.

2. **Back up the data directory:**

   ```bash
   sudo cp -a /var/lib/smart-home /var/lib/smart-home.bak-$(date +%F)
   ```

3. **Create `.env`** from `.env.template`. Keep `INFLUX_DB=smart-home-db` and `INFLUX_USER=smart-home-user` (the names the old init created), set a **new** `INFLUX_PASS` and the admin pair.

4. **Start InfluxDB once with auth off**, create the admin and replace the old password (it was committed in the repository):

   ```bash
   INFLUX_AUTH_ENABLED=false docker compose up -d --wait influxdb
   docker compose exec influxdb influx -execute "CREATE USER \"<INFLUX_ADMIN_USER>\" WITH PASSWORD '<INFLUX_ADMIN_PASS>' WITH ALL PRIVILEGES"
   docker compose exec influxdb influx -execute "SET PASSWORD FOR \"smart-home-user\" = '<INFLUX_PASS>'"
   ```

5. **Start InfluxDB and Grafana with auth on:**

   ```bash
   docker compose up -d --wait
   ```

6. **Update every Pi's `Service/.env`** with the new `INFLUX_PASS` and restart its service (see `../Service/README.md`). Until you do, their writes fail with `401 Unauthorized`.

7. **Clean up Grafana.** Provisioning takes over the existing dashboard (same uid) and points it at the new `smart-home-influxdb` datasource. The old manually-created datasources (e.g. `SmartHome`) are no longer used. Delete them under *Connections → Data sources* once the dashboard shows data.

8. Run the [checks](#test) below.

## Run and operate

All commands run from this `Infrastructure/` directory.

| Task | Command |
| --- | --- |
| Start / apply `.env` or compose changes | `docker compose up -d --wait` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f influxdb grafana` |
| Restart one container | `docker compose restart grafana` |
| Stop (keeps data) | `docker compose down` |
| Upgrade images after changing a tag in `docker-compose.yml` | `docker compose pull && docker compose up -d --wait` |

Containers restart automatically (`restart: unless-stopped`), including after a reboot.

### Manage InfluxDB users

```bash
docker compose exec influxdb influx -username <admin> -password '<admin pass>'
> SHOW USERS
> SET PASSWORD FOR "smart-home-user" = 'new-password'
```

After changing `INFLUX_PASS`, update `.env` here (Grafana reads it at start: `docker compose up -d grafana`) and `Service/.env` on every Pi.

## Dashboards

Both are provisioned from `grafana/dashboards/`, tagged `smart-home` plus their version, and linked to each other in the dashboard header.

### Network health v2.0

Read top-down, from "is everything OK right now" to detail. Every panel has an ⓘ description explaining what it shows and what its colors mean.

* **Filters:** *Node* and *Ping target* are filled in from the data, so a new Pi appears on its own. Router vs internet is decided by address: private ranges (`10.*`, `192.168.*`, `172.16–31.*`) count as router/LAN.
* **Now:** one tile per node for internet latency, router latency, jitter and packet loss (last 15 minutes), the last download and upload, the number of speed tests below plan, and failures in the last hour. *Last report per node* shows when each node last wrote data; **0 reports in the last 10 minutes (red) means a node has stopped**.
* **Latency:** internet vs router latency per node (both high on one node: its Wi-Fi/LAN; only internet high everywhere: the ISP), jitter, packet loss, and latency per target for each node.
* **Reliability:** a grid of node × target over time (green no loss, orange some loss, red heavy loss, dark red no reply), which catches outages of 5 minutes or more at the 24 h view. Failures over time and per node.
* **Web response:** page-load time per URL for each node, where page-load time goes (DNS, connect, TLS, server wait, transfer) and DNS lookup time.
* **Bandwidth:** download and upload per node with the below-plan band shaded, a speed-vs-plan table per node, and the speed test's own ping.

Thresholds:

| Metric | Green | Orange | Red |
| --- | --- | --- | --- |
| Internet latency | < 40 ms | 40–100 ms | ≥ 100 ms |
| Router latency, jitter | < 10 ms | 10–30 ms | ≥ 30 ms |
| Packet loss | 0 % | > 0 % | ≥ 5 % |
| Download (plan 1000 Mbit/s −10 %) | ≥ 900 Mbit/s | 500–900 | < 500 |
| Upload (plan 100 Mbit/s −10 %) | ≥ 90 Mbit/s | 50–90 | < 50 |

The plan is set once at the top of the generator (`PLAN_DOWNLOAD`, `PLAN_UPLOAD`, `TOLERANCE`); the below-plan (900 / 90) and far-below (500 / 50) thresholds, queries, axis limits and panel descriptions are derived from it. If your plan changes, edit those three values and regenerate.

Node colors are fixed for `pi3` (blue), `pi4` (orange) and `pi5` (aqua), chosen to stay distinguishable for colorblind readers. Other node names get a stable color from Grafana's palette; to pin one, add it to `NODE_COLORS` in the generator.

*Where page-load time goes* and *Speed test ping* need the service version that stores the extended curl timings and the speed test's ping. Older nodes simply don't appear in those two panels.

### Ping dashboard v1.0

The original dashboard, unchanged except for its title, tags and the header link. Its `SensorID` dropdown is a fixed list (`pi3,pi4,pi5`); other node names don't appear in its filtered panels.

### Change a dashboard

The files in `grafana/dashboards/` are what Grafana loads; it won't save UI edits to a provisioned dashboard. Grafana picks up a changed file within 30 seconds, with no restart.

**v2.0 is generated.** Edit `tools/generate-network-health-dashboard.py`, then regenerate from the repository root (Python 3, standard library only):

```bash
python3 Infrastructure/tools/generate-network-health-dashboard.py
```

It overwrites `grafana/dashboards/network-health-v2.0.json`; commit both files. Don't edit the JSON by hand or replace it with a Grafana export, since the next regeneration would undo that. To try a change in the UI first, edit a copy (*Save as*), then carry the change over into the generator. The script is organised by dashboard row, with small helpers (`stat`, `timeseries`, `steps`, …) and the shared constants at the top: plan, colors, and the private-address pattern that decides router vs internet.

**v1.0 is a plain export.** To change it:

1. Edit in Grafana, then *Share → Export → Save to file* (leave "Export for sharing externally" **off**).
2. Replace `grafana/dashboards/ping-all-sensors-v1.0.json` with the export. Keep the datasource uid `smart-home-influxdb` and the dashboard's `uid`.

For a new version of either, save it as a new file with a new `uid`, title and version tag (for a generated one, a new generator script or output name), so the previous version stays available.

To check a v2.0 change, open the dashboard after regenerating and confirm the changed panels show data and no errors; every panel's ⓘ describes what it should show. A change to a query is best checked against data with known problems, such as a test stack on other ports seeded with synthetic points (the approach used to test v2.0, see `docs/IMPROVEMENT_PLAN.md`).

Panels query the measurements `ping`, `pingError`, `curl`, `curlError`, `speedtest` and `speedtest-error` by name.

## Build

Nothing to build: InfluxDB and Grafana are official images, pinned in `docker-compose.yml`. The only built image is the service, which is built on or for the Pis; see `../Service/README.md`.

## Test

After any change, from this `Infrastructure/` directory:

1. **Containers are up:** `docker compose ps` shows `influxdb` as `healthy` and `grafana` as `Up`.

2. **Auth is enforced.** An anonymous query must be rejected:

   ```bash
   curl -s 'http://localhost:8086/query?q=SHOW+DATABASES'
   # {"error":"unable to parse authentication credentials"}
   ```

3. **The service account can read data:**

   ```bash
   source .env
   docker compose exec influxdb influx -username "$INFLUX_USER" -password "$INFLUX_PASS" -database "$INFLUX_DB" \
     -execute 'SELECT * FROM ping ORDER BY time DESC LIMIT 5'
   ```

   Expect recent rows for each `computerTag` (one per Pi), with `address` and `computerTag` as tags and `avg`, `min`, `max`, `mdev` and `packetsPercent` as values. A service writes its first points at the next full minute after starting.

4. **Grafana's datasource works:**

   ```bash
   curl -s http://localhost:3000/api/datasources/uid/smart-home-influxdb/health
   # {"message":"datasource is working. N measurements found","status":"OK"}
   ```

5. **The dashboards render:** open `http://<host>:3000`, open *Network health v2.0*, and check that the panels show data with no "datasource not found" errors. *Last report per node* should list every Pi with a recent time and a green report count.

## Security notes

* **InfluxDB is reachable on port 8086 from your LAN** (the Pis need it), and authentication is on. Anyone on the LAN without the credentials gets nothing.
* **Grafana has no login:** anonymous visitors are Admins, which was already the case before. Grafana 12 logs `auth.anonymous.org_role is deprecated` for this, and a future version will limit anonymous users to Viewer. Don't expose port 3000 beyond your LAN.
* Grafana reads InfluxDB with the same account the service writes with, which has full rights on the database.

## Troubleshooting

**Service logs `401 Unauthorized` / `authorization failed`.** The service's `INFLUX_USER`/`INFLUX_PASS` don't match an InfluxDB user. Check with `SHOW USERS` (see [Manage users](#manage-influxdb-users)). On an existing install, follow the [migration](#migrating-from-the-old-scripts).

**Every request says `error authorizing query: no user provided`, even with credentials.** Auth is on but no admin user exists. Do step 4 of the [migration](#migrating-from-the-old-scripts).

**`Failed to connect to http://localhost:8086` right after the very first start.** InfluxDB restarts once after creating its database and users. Wait a few seconds.

**Grafana exits with `permission denied` on `/var/lib/grafana`.** The data directory must belong to uid 472: `sudo chown -R 472:472 /var/lib/smart-home/grafana`.

**Grafana logs `Could not register plugin ... table is already registered`.** Harmless Grafana 12.0 startup noise.

**Graphs are blank but the datasource health check is OK.** Check *Last report per node* in v2.0: a node missing there has never written data, and a red count means it stopped. In v1.0, a node also has to be in its fixed `SensorID` list.
