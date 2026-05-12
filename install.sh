#! /usr/bin/env bash

folders="bin nvim tmux zsh karabiner rust agents"

for folder in $(echo $folders)
do
  stow --delete --target=$HOME $folder
  stow --no-folding --target=$HOME $folder
done
