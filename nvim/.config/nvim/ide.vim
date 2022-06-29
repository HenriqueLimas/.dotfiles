" IDE

" Remove trailing white spacing in the file
function! CustomStripWhitespace()
  if has("persistent_undo") && !empty(@%)
    " Preparation: save last search, and cursor position.
    let _s=@/
    let l = line(".")
    let c = col(".")

    %s/\s\+$//e
    exe "w"

    " clean up: restore previous search history, and cursor position
    let @/=_s
    call cursor(l, c)
  endif
endfunction

" Always remove the whistespace if the following command is used
command! W call CustomStripWhitespace()

"" Enable mouse
if !has('nvim')
  set ttymouse=xterm2
endif
se mouse=a

nnoremap <C-d> :sh<cr>
nnoremap <tab> :noh<cr>

""" remap <C-b> motion
nnoremap <C-b><C-b> <C-b>

" Move whole line up and down and format
vnoremap J :m '>+1<CR>gv=gv
vnoremap K :m '<-2<CR>gv=gv

" Copy whole file to clipboard
nnoremap <leader>Y gg"+yG
vnoremap <leader>y "+y
nnoremap <leader>y "+y

" replace currently selected text with default register
" without yanking it
vnoremap <leader>p "_dP

nnoremap <C-t> :silent !tmux neww tmux-sessionizer<CR>

command! Q :q

source ~/.config/nvim/sets.vim
source ~/.config/nvim/coc.vim
" source ~/.config/nvim/airline.vim
source ~/.config/nvim/color.vim
source ~/.config/nvim/git.vim
source ~/.config/nvim/go.vim
source ~/.config/nvim/harpoon.vim
source ~/.config/nvim/navigation.vim
source ~/.config/nvim/netrw.vim
source ~/.config/nvim/parenthesis.vim
source ~/.config/nvim/prettier.vim
source ~/.config/nvim/syntastic.vim
source ~/.config/nvim/telescope.vim
source ~/.config/nvim/terminal.vim

let g:markdown_fenced_languages = ['html', 'typescript', 'javascript' , 'typescriptreact', 'css', 'less']
