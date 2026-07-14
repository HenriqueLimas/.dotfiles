#! /usr/bin/env bash

folders="bin nvim tmux zsh karabiner rust pi agents"

for folder in $(echo $folders)
do
  stow --delete --target=$HOME $folder
  stow --target=$HOME $folder
done
