#!/bin/bash

docker stop grafana influxdb
docker rm grafana influxdb

mkdir -p /var/lib/smart-home/influx
mkdir -p /var/lib/smart-home/grafana

sudo chown 472:472 /var/lib/smart-home/grafana

docker network create smart-home
docker run -d -p 3000:3000 -v /var/lib/smart-home/grafana:/var/lib/grafana --net=smart-home --network-alias=grafana --name=grafana grafana/grafana
docker run -d -p 8086:8086 -v /var/lib/smart-home/influx:/var/lib/influxdb --net=smart-home --network-alias=influxdb --name=influxdb smart-home-influx
sleep 10
docker run --net=smart-home smart-home-init-influx
docker ps