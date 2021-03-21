docker build --tag smart-home-service --file Dockerfile.service .
docker build --tag smart-home-influx --file Dockerfile.influx .
docker build --tag smart-home-init-influx --file Dockerfile.init-influx .
