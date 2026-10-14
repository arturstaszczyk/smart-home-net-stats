# smart-home-net-stats

This project monitors a home network with Raspberry Pis. Each Pi sends ping and curl requests to some targets every minute. Each Pi also does a speed test one time each hour. InfluxDB keeps the results, and Grafana shows them in charts.

The project has two parts. You install each part separately. Each part has its own `docker-compose.yml` file and its own `.env` file.

| Part | Where it runs | What it is | Instructions |
| --- | --- | --- | --- |
| `Infrastructure/` | One infrastructure host. No other part of the project runs on this host. | InfluxDB and Grafana, with the datasource and the dashboards | [Infrastructure/README.md](Infrastructure/README.md) |
| `Service/` | Each Pi that does measurements | The Node.js agent. It does the measurements and writes the results to InfluxDB through the LAN. | [Service/README.md](Service/README.md) |

## Quick start

On the infrastructure host, do these commands:

```bash
cd Infrastructure
cp .env.template .env && nano .env
sudo mkdir -p /var/lib/smart-home/{influx,grafana} && sudo chown 472:472 /var/lib/smart-home/grafana
docker compose up -d --wait
```

Grafana is then available at `http://<infrastructure host>:3000`.

On each Pi that does measurements, do these commands:

```bash
cd Service
cp .env.template .env && nano .env      # INFLUX_HOST=<infrastructure host's LAN IP>, same INFLUX_DB/USER/PASS
sudo mkdir -p /var/lib/smart-home/service
docker compose up -d --build
```

If you used the old `*-build.sh` and `*-run.sh` scripts before, a migration of InfluxDB is necessary one time. The reason is that InfluxDB now checks the user name and password. Refer to [Infrastructure/README.md, "Migrate from the old scripts"](Infrastructure/README.md#migrate-from-the-old-scripts).

For the planned and completed changes, refer to [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md).
