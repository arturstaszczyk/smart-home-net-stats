#!/bin/bash

source $NVM_DIR/nvm.sh
nvm use

node --version

yarn 
yarn standalone-frequent
