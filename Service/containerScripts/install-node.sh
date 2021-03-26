#!/bin/bash

pwd
source $NVM_DIR/nvm.sh
nvm install
nvm use

node --version

npm install --global yarn
yarn install
