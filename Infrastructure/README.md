# Smart Home Net Stats: infrastructure

This part of the project keeps the measurement data and shows it in charts:

* **InfluxDB 1.8** (`influxdb:1.8.10`, the official image) keeps the time series that the service writes.
* **Grafana** (`grafana/grafana:12.0.2`) shows the data in charts. Grafana gets its datasource and its dashboards from files in this directory. Thus, you do not import them manually.

The two containers start from `docker-compose.yml` in this directory. They run on one **infrastructure host**, and no other part of the project runs on this host. The service that does the measurements is a different part in `../Service/`, and it runs on the Pis. Refer to `../Service/README.md`.

```
 Pi (Service/) ──┐
 Pi (Service/) ──┼──LAN──▶ :8086 InfluxDB ◀── Grafana :3000 ◀── browser
 Pi (Service/) ──┘          infrastructure host (Infrastructure/)
```

## Contents of this directory

| Path | Function |
| --- | --- |
| `docker-compose.yml` | Starts InfluxDB and Grafana. |
| `.env.template` | The template for the configuration. Copy it to `.env`. |
| `influxdb/init/create-db-and-user.sh` | Runs one time, at the first start with an empty data directory. It makes the database and the service user. |
| `grafana/provisioning/datasources/influxdb.yml` | The InfluxDB datasource (uid `smart-home-influxdb`). It gets its values from `.env`. |
| `grafana/provisioning/dashboards/smart-home.yml` | Tells Grafana to load each JSON file in `grafana/dashboards/`. |
| `grafana/dashboards/network-health-v2.0.json` | **Network health v2.0**, the primary dashboard. Refer to [Dashboards](#dashboards). |
| `grafana/dashboards/ping-all-sensors-v1.0.json` | **Ping dashboard v1.0**, the original dashboard. It stays available for comparison. |
| `tools/generate-network-health-dashboard.py` | Makes `network-health-v2.0.json`. Change this script, not the JSON file. Refer to [Change a dashboard](#change-a-dashboard). |

## Requirements

* Docker with the Compose plugin. To examine it, do the command `docker compose version`.
* A host with one of these architectures: amd64, arm64, or 32-bit arm/v7 (Raspberry Pi OS 32-bit). The two images are available for all three.
* Ports **8086** (InfluxDB) and **3000** (Grafana) must be free on the host.

## Configure

All of the configuration is in the file `.env` in this directory. Make this file from `.env.template`. Git does not keep this file.

```bash
cd Infrastructure
cp .env.template .env
```

| Variable | Function |
| --- | --- |
| `DATA_DIR` | The host directory for the data. The default is `/var/lib/smart-home`. InfluxDB uses `influx/` and Grafana uses `grafana/`. |
| `INFLUX_DB` | The name of the database, for example `smart-home-db`. |
| `INFLUX_USER`, `INFLUX_PASS` | The account that the service writes with and that Grafana reads with. The `Service/.env` file on each Pi must have the same values and the same `INFLUX_DB`. |
| `INFLUX_ADMIN_USER`, `INFLUX_ADMIN_PASS` | The InfluxDB administrator. Use this account to manage users. |
| `INFLUX_AUTH_ENABLED` | `true` (the default). Set it to `false` only for a short time. Refer to [Migrate from the old scripts](#migrate-from-the-old-scripts). |

InfluxDB uses `INFLUX_DB`, `INFLUX_USER`, `INFLUX_PASS` and the two administrator values **only when it starts with an empty data directory**. If you change these values later, you must also change them in InfluxDB. Refer to [Manage InfluxDB users](#manage-influxdb-users).

CAUTION: Do not use single quotes (`'`) in passwords. The initialization script puts the passwords between InfluxQL quotes.

## New installation

Do these commands in this `Infrastructure/` directory:

```bash
sudo mkdir -p /var/lib/smart-home/influx /var/lib/smart-home/grafana
sudo chown 472:472 /var/lib/smart-home/grafana     # Grafana runs as uid 472
cp .env.template .env && nano .env                  # set the passwords
docker compose up -d --wait
```

At the first start, InfluxDB makes the administrator, the database and the service user. Then InfluxDB starts again. The command `--wait` stops when InfluxDB is healthy. Grafana starts to reply at `http://<host>:3000` approximately 10 seconds later.

## Migrate from the old scripts

Do this procedure only if InfluxDB has a database that the old scripts made. Do not do this procedure for a new installation.

The old configuration (`infrastructure-run.sh`) ran InfluxDB **without authentication**. It made only a user that is not an administrator. If you start authentication when there is no administrator, InfluxDB refuses all requests. It also refuses the request that makes an administrator. Thus, the procedure starts InfluxDB without authentication for a short time to make an administrator. InfluxDB uses the data in `/var/lib/smart-home/influx` without changes. Do the steps in this `Infrastructure/` directory.

1. **Stop and remove the old containers and the old network.** The data is on the host, thus these commands do not change the data:

   ```bash
   docker stop grafana influxdb
   docker rm grafana influxdb
   docker network rm smart-home
   ```

   If an old `smart-home-service` container also runs on this host, remove it (`docker stop smart-home-service && docker rm smart-home-service`). The service does not run on the infrastructure host now.

2. **Make a backup of the data directory:**

   ```bash
   sudo cp -a /var/lib/smart-home /var/lib/smart-home.bak-$(date +%F)
   ```

3. **Make the `.env` file** from `.env.template`. Keep `INFLUX_DB=smart-home-db` and `INFLUX_USER=smart-home-user`. These are the names that the old scripts made. Set a **new** `INFLUX_PASS`. Set the two administrator values.

4. **Start InfluxDB one time without authentication.** Make the administrator. Replace the old password, because the old password is in the history of the repository:

   ```bash
   INFLUX_AUTH_ENABLED=false docker compose up -d --wait influxdb
   docker compose exec influxdb influx -execute "CREATE USER \"<INFLUX_ADMIN_USER>\" WITH PASSWORD '<INFLUX_ADMIN_PASS>' WITH ALL PRIVILEGES"
   docker compose exec influxdb influx -execute "SET PASSWORD FOR \"smart-home-user\" = '<INFLUX_PASS>'"
   ```

   CAUTION: Use the same password as `INFLUX_PASS` in `.env`. If the two passwords are different, Grafana and the service cannot write or read data.

5. **Start InfluxDB and Grafana with authentication:**

   ```bash
   docker compose up -d --wait
   ```

6. **Put the new `INFLUX_PASS` in the `Service/.env` file on each Pi.** Then start the service on each Pi again (refer to `../Service/README.md`). Until you do this step, the Pis cannot write data. They get the error `401 Unauthorized`.

7. **Remove the old Grafana datasources.** Grafana uses the provisioned dashboard in place of the old dashboard, because the two dashboards have the same uid. The provisioned dashboard uses the new `smart-home-influxdb` datasource. Grafana does not use the old datasources that you made manually (for example `SmartHome`). When the dashboard shows data, delete the old datasources in *Connections → Data sources*.

8. Do the [tests](#test) that follow.

## Operation

Do all of these commands in this `Infrastructure/` directory.

| Task | Command |
| --- | --- |
| Start, or apply changes to `.env` or to the compose file | `docker compose up -d --wait` |
| Show the status | `docker compose ps` |
| Show the logs | `docker compose logs -f influxdb grafana` |
| Start one container again | `docker compose restart grafana` |
| Stop (the data stays) | `docker compose down` |
| Get new images after you change a tag in `docker-compose.yml` | `docker compose pull && docker compose up -d --wait` |

The containers start again automatically (`restart: unless-stopped`). They also start again after the host starts.

### Manage InfluxDB users

```bash
docker compose exec influxdb influx -username <admin> -password '<admin pass>'
> SHOW USERS
> SET PASSWORD FOR "smart-home-user" = 'new-password'
```

If you change `INFLUX_PASS`, also change it in these two locations:

1. In `.env` in this directory. Then do `docker compose up -d grafana`, because Grafana reads the password when it starts.
2. In `Service/.env` on each Pi.

## Dashboards

Grafana loads the two dashboards from `grafana/dashboards/`. Each dashboard has the tag `smart-home` and a tag for its version. Each dashboard has a link to the other dashboard at the top.

### Network health v2.0

Read the dashboard from top to bottom. The top shows the current status. The lower rows show more detail. Each panel has an ⓘ icon. The ⓘ icon tells what the panel shows and what the colors mean.

* **Filters:** The *Node* and *Ping target* lists get their values from the data. Thus, a new Pi shows automatically. The address tells if a target is the router or the internet. Private address ranges (`10.*`, `192.168.*`, `172.16–31.*`) are the router or the LAN.
* **Now:** For each node, there is one tile for each of these values: internet latency, router latency, jitter and packet loss (last 15 minutes). Other tiles show the last download and the last upload. Two more tiles show the speed tests below the plan and the failures in the last hour. The table *Last report per node* shows when each node wrote data last. **If a node has 0 reports in the last 10 minutes (red), the node has stopped.**
* **Latency:** This row compares internet latency and router latency for each node. If the two values are high on one node, the problem is the Wi-Fi or the LAN of that node. If only the internet latency is high on all nodes, the problem is the ISP. The row also shows jitter, packet loss and the latency for each target.
* **Reliability:** A grid shows each node and target over time. Green is no loss, orange is some loss, red is heavy loss, and dark red is no reply. At the 24-hour view, the grid shows all outages of 5 minutes or longer. The row also shows the failures over time and the failures for each node.
* **Web response:** This row shows the time to load each URL for each node. It also shows how that time divides into steps (DNS, connect, TLS, server wait, transfer) and the DNS lookup time.
* **Bandwidth:** This row shows the download and the upload for each node. A shaded band shows the area below the plan. A table compares the speed of each node with the plan. The row also shows the ping that the speed test measures.

Thresholds:

| Metric | Green | Orange | Red |
| --- | --- | --- | --- |
| Internet latency | < 40 ms | 40–100 ms | ≥ 100 ms |
| Router latency, jitter | < 10 ms | 10–30 ms | ≥ 30 ms |
| Packet loss | 0 % | > 0 % | ≥ 5 % |
| Download (plan 1000 Mbit/s −10 %) | ≥ 900 Mbit/s | 500–900 | < 500 |
| Upload (plan 100 Mbit/s −10 %) | ≥ 90 Mbit/s | 50–90 | < 50 |

The plan is set one time, at the top of the generator script (`PLAN_DOWNLOAD`, `PLAN_UPLOAD`, `TOLERANCE`). The script calculates the thresholds from the plan (900 / 90 and 500 / 50). It also calculates the queries, the axis limits and the panel descriptions. If your plan changes, change these three values. Then make the dashboard again.

The node colors are fixed for `pi3` (blue), `pi4` (orange) and `pi5` (aqua). Persons who are colorblind can also see the difference between these colors. Grafana gives a color to each other node name, and this color does not change. To set a color for a node, add the node to `NODE_COLORS` in the generator script.

The panels *Where page-load time goes* and *Speed test ping* use data that only the newer service version writes. Older nodes do not show in these two panels.

### Ping dashboard v1.0

This is the original dashboard. Only its title, its tags and the link at the top are different. Its `SensorID` list has fixed values (`pi3,pi4,pi5`). Thus, its filtered panels do not show other node names.

### Change a dashboard

Grafana loads the files in `grafana/dashboards/`. Grafana does not save changes that you make to these dashboards in the user interface. When a file changes, Grafana loads it again in 30 seconds or less. It is not necessary to start Grafana again.

**A script makes v2.0.** To change v2.0, do these steps:

1. Change `tools/generate-network-health-dashboard.py`.
2. In the root directory of the repository, do this command (Python 3 with only the standard library is necessary):

   ```bash
   python3 Infrastructure/tools/generate-network-health-dashboard.py
   ```

3. The script writes `grafana/dashboards/network-health-v2.0.json` again. Commit the two files.

CAUTION: Do not change the JSON file manually. Do not replace it with an export from Grafana. The next run of the script removes these changes.

To try a change in the user interface first, change a copy of the dashboard (*Save as*). Then put the change into the script. The script has one part for each row of the dashboard. It has small helper functions (`stat`, `timeseries`, `steps`, …). The shared values are at the top: the plan, the colors, and the address pattern that tells the router from the internet.

**v1.0 is a usual export.** To change v1.0, do these steps:

1. Change the dashboard in Grafana. Then select *Share → Export → Save to file*. Do not select "Export for sharing externally".
2. Replace `grafana/dashboards/ping-all-sensors-v1.0.json` with the export. Keep the datasource uid `smart-home-influxdb` and the `uid` of the dashboard.

To make a new version of a dashboard, save it in a new file. Give it a new `uid`, a new title and a new version tag. For a dashboard that a script makes, use a new script or a new output name. Thus, the previous version stays available.

To examine a change to v2.0, open the dashboard after the script runs. Make sure that the changed panels show data and no errors. The ⓘ icon of each panel tells what the panel must show. To examine a change to a query, use data that has known problems. For example, use a test installation on different ports with data that you write for the test. This is the method that the test of v2.0 used. Refer to `docs/IMPROVEMENT_PLAN.md`.

The panels use the names of the measurements `ping`, `pingError`, `curl`, `curlError`, `speedtest` and `speedtest-error`.

## Build

It is not necessary to build an image. InfluxDB and Grafana are official images, and `docker-compose.yml` sets their versions. Only the service has an image that you build, on the Pis or for the Pis. Refer to `../Service/README.md`.

## Test

After each change, do these tests in this `Infrastructure/` directory:

1. **Make sure that the containers run.** The command `docker compose ps` shows `influxdb` as `healthy` and `grafana` as `Up`.

2. **Make sure that InfluxDB checks the user name and password.** InfluxDB must refuse a query without a user name:

   ```bash
   curl -s 'http://localhost:8086/query?q=SHOW+DATABASES'
   # {"error":"unable to parse authentication credentials"}
   ```

3. **Make sure that the service account can read data:**

   ```bash
   source .env
   docker compose exec influxdb influx -username "$INFLUX_USER" -password "$INFLUX_PASS" -database "$INFLUX_DB" \
     -execute 'SELECT * FROM ping ORDER BY time DESC LIMIT 5'
   ```

   The result must show recent rows for each `computerTag` (one for each Pi). `address` and `computerTag` must be tags. `avg`, `min`, `max`, `mdev` and `packetsPercent` must be values. A service writes its first data at the start of the next minute after it starts.

4. **Make sure that the Grafana datasource operates:**

   ```bash
   curl -s http://localhost:3000/api/datasources/uid/smart-home-influxdb/health
   # {"message":"datasource is working. N measurements found","status":"OK"}
   ```

5. **Make sure that the dashboards show data.** Open `http://<host>:3000`, then open *Network health v2.0*. Make sure that the panels show data and no "datasource not found" errors. The table *Last report per node* must show each Pi with a recent time and a green number of reports.

## Security

* **The Pis must connect to InfluxDB on port 8086 through your LAN.** InfluxDB checks the user name and password. A person on the LAN without them cannot read or write data.
* **Grafana does not ask for a login.** All visitors are administrators. This was also true before. Grafana 12 writes the warning `auth.anonymous.org_role is deprecated` for this configuration. A future Grafana version will let anonymous visitors only read dashboards.

  WARNING: Do not make port 3000 available outside your LAN. All visitors are administrators and can change Grafana.

* Grafana reads InfluxDB with the same account that the service writes with. This account has full rights on the database.

## Troubleshooting

**The service log shows `401 Unauthorized` or `authorization failed`.** The `INFLUX_USER` or `INFLUX_PASS` of the service is not correct for an InfluxDB user. Examine the users with `SHOW USERS` (refer to [Manage InfluxDB users](#manage-influxdb-users)). If InfluxDB has a database from the old scripts, do the [migration](#migrate-from-the-old-scripts).

**All requests show `error authorizing query: no user provided`, also with a user name and password.** Authentication is on, but there is no administrator. Do step 4 of the [migration](#migrate-from-the-old-scripts).

**`Failed to connect to http://localhost:8086` immediately after the first start.** InfluxDB starts again one time after it makes its database and users. Wait some seconds.

**Grafana stops with `permission denied` on `/var/lib/grafana`.** The user with uid 472 must own the data directory. Do `sudo chown -R 472:472 /var/lib/smart-home/grafana`.

**The Grafana log shows `Could not register plugin ... table is already registered`.** Grafana 12.0 writes this message when it starts. It does not cause a problem.

**The charts are empty, but the datasource test is OK.** Look at the table *Last report per node* in v2.0. If a node is not in the table, it has not written data. If a node has a red number, it has stopped. In v1.0, a node must also be in the fixed `SensorID` list.
