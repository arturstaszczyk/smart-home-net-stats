# Sourced by the influxdb image's init script on first start only (empty data dir).
# $INFLUX_CMD is already authenticated as the admin user.
# Replaces the image's own INFLUXDB_DB / INFLUXDB_USER handling, which doesn't quote
# the database name and so fails on "smart-home-db" (hyphens), skipping the user too.
$INFLUX_CMD "CREATE DATABASE \"$SMART_HOME_DB\""
$INFLUX_CMD "CREATE USER \"$SMART_HOME_USER\" WITH PASSWORD '$SMART_HOME_PASS'"
$INFLUX_CMD "GRANT ALL ON \"$SMART_HOME_DB\" TO \"$SMART_HOME_USER\""
