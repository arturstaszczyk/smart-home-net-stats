#!/bin/bash

ping influxdb -c 4
influx -host influxdb -execute "CREATE DATABASE \"smart-home-db\""
influx -host influxdb -execute "CREATE USER \"smart-home-user\" WITH PASSWORD 'haslo'"
influx -host influxdb -execute "GRANT ALL on \"smart-home-db\" TO \"smart-home-user\""
