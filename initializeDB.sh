#!/bin/bash

influx -execute "CREATE DATABASE \"smart-home-db\""
influx -execute "CREATE USER \"smart-home-user\" WITH PASSWORD 'haslo'"
influx -execute "GRANT ALL on \"smart-home-db\" TO \"smart-home-user\""
