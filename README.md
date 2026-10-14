# smart-home-net-stats

Self-hosted home network monitoring for Raspberry Pis. Each Pi pings and curls a few targets every minute and runs a speed test once an hour. The results go to InfluxDB and are charted in Grafana.

The two parts are deployed independently, each with its own `docker-compose.yml` and `.env`:

| Part | Runs on | What it is | Docs |
| --- | --- | --- | --- |
| `Infrastructure/` | One infrastructure host, nothing else runs there | InfluxDB + Grafana, with the provisioned datasource and dashboard | [Infrastructure/README.md](Infrastructure/README.md) |
| `Service/` | Every measuring Pi | The Node.js agent that measures and writes to InfluxDB over the LAN | [Service/README.md](Service/README.md) |

## Quick start

On the infrastructure host:

```bash
cd Infrastructure
cp .env.template .env && nano .env
sudo mkdir -p /var/lib/smart-home/{influx,grafana} && sudo chown 472:472 /var/lib/smart-home/grafana
docker compose up -d --wait
```

Grafana is then on `http://<infrastructure host>:3000`.

On every measuring Pi:

```bash
cd Service
cp .env.template .env && nano .env      # INFLUX_HOST=<infrastructure host's LAN IP>, same INFLUX_DB/USER/PASS
sudo mkdir -p /var/lib/smart-home/service
docker compose up -d --build
```

Upgrading from the old `*-build.sh` / `*-run.sh` scripts needs a one-time InfluxDB migration (authentication is now enforced). See [Infrastructure/README.md → Migrating](Infrastructure/README.md#migrating-from-the-old-scripts).

Planned and completed improvements: [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md).
