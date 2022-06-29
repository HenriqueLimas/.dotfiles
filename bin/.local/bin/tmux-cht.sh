#! /usr/bin/env bash

selection=$(cat ~/.tmux-cht-languages ~/.tmux-cht-commands | fzf)

read -p "Enter query: " query

if grep -q "$selection" ~/.tmux-cht-languages; then
  tmux split-window -h bash -c "curl cheat.sh/$selection/$(echo "$query" | tr " " "+") | less"
else
  tmux split-window -h bash -c "curl cheat.sh/$selection~$query | less"
fi
