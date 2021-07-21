docker build --no-cache --tag smart-home-service --build-arg SPEED_TEST_MUNUTE=${1-7} --file Dockerfile.service .
