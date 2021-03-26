#!/bin/bash

cd /var/smart-home
pwd
source /usr/local/nvm/nvm.sh
nvm use

node --version

npm install --global yarn
yarn install
yarn standalone-$1
