# This is infrastructure setup for running smart-home-net-stats
Consists of
* Grafana instance in docker
* Influx instance in docker

## Configuration file for influx is in containerScripts/influx-config-override.config
It overrides HTTP.flux-enabled to `true`

## Schema/user creation for influx is in containerScripts/initializeDB.sh
You can set username, db name and password for the service

## Usage
`./infrastructure-build.sh`
Will build docker images

`./infrastructure-run.sh` 
Will run docker images, initialize DB and hook them up into one network