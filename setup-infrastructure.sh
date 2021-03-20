#!/bin/bash

docker stop grafana influxdb
docker rm grafana influxdb

docker run -d -p 3000:3000 --net=smart-home --network-alias=grafana --name=grafana grafana/grafana
docker run -d -p 8086:8086 -v ~/Project/influxdb:/var/lib/influxdb --net=smart-home --network-alias=influxdb --name=influxdb smart-home-influx
docker ps