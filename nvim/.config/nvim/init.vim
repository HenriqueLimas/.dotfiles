" set runtimepath^=~/.vim runtimepath+=./after
" let &packpath = &runtimepath
" source ~/.vimrc
"
set nocompatible              " be iMproved, required
filetype off                  " required

call plug#begin('~/.vim/plugged')

Plug 'tpope/vim-sensible'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-vinegar'
Plug 'tpope/vim-sleuth'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-fugitive'
" Plug 'mileszs/ack.vim'
Plug 'jiangmiao/auto-pairs'
Plug 'wincent/terminus'
" Plug 'sheerun/vim-polyglot'
Plug 'prettier/vim-prettier'
Plug 'alvan/vim-closetag'
Plug 'terryma/vim-multiple-cursors'
Plug 'tmhedberg/matchit'
" Plug 'vim-airline/vim-airline'
" Plug 'vim-airline/vim-airline-themes'
Plug 'vim-syntastic/syntastic'
" Plug 'duganchen/vim-soy'
Plug 'airblade/vim-gitgutter'
Plug 'epilande/vim-es2015-snippets'
Plug 'epilande/vim-react-snippets'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jonsmithers/vim-html-template-literals'
Plug 'heavenshell/vim-jsdoc'
Plug 'fatih/vim-go'
Plug 'gruvbox-community/gruvbox'
Plug 'flazz/vim-colorschemes'
Plug 'christoomey/vim-tmux-navigator'
Plug 'jeffkreeftmeijer/vim-numbertoggle'
Plug 'jparise/vim-graphql'
Plug 'ThePrimeagen/vim-be-good'

" Fuzzy finder
" Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
" Plug 'junegunn/fzf.vim'
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'nvim-telescope/telescope-fzy-native.nvim'

" Harpoon
Plug 'ThePrimeagen/harpoon'

" Neovim Tree shitter
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" filetype on
" All of your Plugins must be added before the following line
" call vundle#end()            " required
call plug#end()
filetype plugin indent on    " required

lua require("hlimas")

"" IDE specif settings
source ~/.config/nvim/ide.vim

"" Language specific settings
source ~/.config/nvim/js.vim
source ~/.config/nvim/ts.vim
source ~/.config/nvim/git.vim
