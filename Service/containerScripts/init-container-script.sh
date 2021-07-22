#!/bin/bash

printenv > env.docker.sh
cat env.docker.sh

# Add crontab file in the cron directory

echo $SPEED_TEST_MINUTE" * * * * . /var/smart-home/env.docker.sh; /var/smart-home/containerScripts/run-script.sh infrequent\n >> /var/log/cron2.log 2>&1\n" >> /var/smart-home/containerScripts/cron-job-smart-home
cp ./containerScripts/cron-job-smart-home /etc/cron.d

cat /etc/cron.d/cron-job-smart-home
ls /etc/cron.d

# Give execution rights on the cron job
chmod 0644 /etc/cron.d/cron-job-smart-home

# Apply cron job 
crontab /etc/cron.d/cron-job-smart-home


printenv > .env 
touch /var/log/cron.log 
echo "" > /var/log/cron.log 
cron
tail -f /var/log/cron.log
