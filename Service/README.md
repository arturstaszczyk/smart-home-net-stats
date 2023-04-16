# Smart Home Net Stats service

## Configure & Build the container

### Configure the build
Copy & Rename .env.template file to .env<br>
Set variables defined in template (In the .env file there are variables required for both:  building and running the container...)

### Build the container
>  ./service-build.sh


### Push it to the HUB
> docker tag smart-home-service:latest <your_docker_hub_id/image_name:tag> <br>
> docker push <your_docker_hub_id/image_name:tag>

## Run

### Pull the service

> docker pull <your_docker_hub_id/image_name:tag> <br>
> docker tag <your_docker_hub_id/image_name:tag> smart-home-service:latest

### configure the runtime vars
Copy & Rename .env.template file to .env <br>
Set variables defined in template (In the .env file there are variables required for both:  building and running the container...)

### run the service
> ./service-run.sh

## Troubleshooting
Operation not permitted (cron)
-> https://stackoverflow.com/questions/65717411/operation-not-permitted-during-docker-build

Very slow PING execution
-> Set the static DNS server (e.g. pointing to your router) https://pimylifeup.com/raspberry-pi-dns-settings/
