#! /usr/bin/env bash

folders="bin nvim tmux zsh karabiner rust pi"

for folder in $(echo $folders)
do
  stow --delete --target=$HOME $folder
  stow --target=$HOME $folder
done
