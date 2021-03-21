#!/bin/bash

pwd
source $NVM_DIR/nvm.sh
nvm use

node --version

yarn 
yarn standalone-$1
