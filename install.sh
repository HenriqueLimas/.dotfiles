#! /usr/bin/env bash

folders="bin nvim zsh karabiner rust pi agents herdr"

for folder in $(echo $folders)
do
  stow --delete --target=$HOME $folder
  stow --target=$HOME $folder
done
