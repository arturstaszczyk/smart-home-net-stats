#!/bin/bash

docker stop smart-home-service
docker rm smart-home-service

docker run -d --env-file .env -v /var/lib/smart-home/service:/var/log --name=smart-home-service smart-home-service
