#!/bin/bash

docker stop smart-home-service
docker rm smart-home-service

docker run -d --env-file env.docker -v ~/Project/smart-home-net-stats/data/log:/var/log --name=smart-home-service smart-home-service
