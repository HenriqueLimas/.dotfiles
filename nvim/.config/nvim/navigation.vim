"" Moving around tabs
nnoremap tn  :tabnew<CR>
nnoremap tc  :tabclose<CR>

nnoremap th  :tabfirst<CR>
nnoremap tj  :tabnext<CR>
nnoremap tk  :tabprev<CR>
nnoremap tl  :tablast<CR>

"" Buffers
nnoremap <leader>bh :bfirst<CR>
nnoremap <leader>bk :bprevious<CR>
nnoremap <leader>bj :bnext<CR>
nnoremap <leader>bl :blast<CR>
nnoremap <leader>bb :buffer<space>
nnoremap <leader>bw :bw<CR>

" Move whole line up and down and format
vnoremap J :m '>+1<CR>gv=gv
vnoremap K :m '<-2<CR>gv=gv
