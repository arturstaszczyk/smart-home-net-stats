#!/bin/bash

docker stop smart-home-service
docker rm smart-home-service

docker run --env-file env.docker --name=smart-home-service smart-home-service
