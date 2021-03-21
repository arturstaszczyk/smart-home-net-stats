#!/bin/bash

cd /var/smart-home
pwd
source /usr/local/nvm/nvm.sh
nvm use

node --version

yarn 
yarn standalone-$1
