#!/bin/bash

echo "Printing content of env variables of Docker container"
printenv > env.docker.sh
cat env.docker.sh

# Add crontab file in the cron directory
echo "Adding cron config for infrequent command"
rm /var/smart-home/containerScripts/cron-job-smart-home.copy
cp /var/smart-home/containerScripts/cron-job-smart-home /var/smart-home/containerScripts/cron-job-smart-home.copy
echo $SPEED_TEST_MINUTE" * * * * . /var/smart-home/env.docker.sh; /var/smart-home/containerScripts/run-script.sh infrequent >> /var/log/cron2.log 2>&1" >> /var/smart-home/containerScripts/cron-job-smart-home.copy
echo "" >> /var/smart-home/containerScripts/cron-job-smart-home.copy
cp ./containerScripts/cron-job-smart-home.copy /etc/cron.d/cron-job-smart-home

echo "Printing cron config"
cat /etc/cron.d/cron-job-smart-home
echo "Printing cron.d content"
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
 