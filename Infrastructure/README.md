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

## docker hub

I am using single docker repo, because it's free. I am uploading images as the same service with different tags

`docker tag smart-home-init-influx:latest <docker_id>/smart-home:init_influx`
and
`docker tag smart-home-influx:latest stasiu86/smart-home:influx`
then
`docker push <docker_id>/smart-home:init_influx`
and
`docker push <docker_id>/smart-home:influx`

Need to to reverse after pulling
