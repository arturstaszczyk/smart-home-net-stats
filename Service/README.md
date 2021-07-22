# Smart Home Net Stats service

## Configure & Build the container

### Configure the build
Copy .env.template file to /var/lib/smart-home/service and rename it to .env
Set variables defined in template (In the .env file there are variables required for both:  building and running the container...)

### Build the container
run ./service-build.sh

### Push it to the HUB
docker tag smart-home-service:latest <your_docker_hub_id/image_name:tag>
docker push <your_docker_hub_id/image_name:tag>

## Run

### Pull the service
docker pull <your_docker_hub_id/image_name:tag>
docker tag <your_docker_hub_id/image_name:tag> smart-home-service:latest

### configure the runtime vars
Copy .env.template file to /var/lib/smart-home/service and rename it to .env
Set variables defined in template (In the .env file there are variables required for both:  building and running the container...)

### run the service
service-run.sh

## Troubleshooting
Operation not permitted (cron)
https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build
