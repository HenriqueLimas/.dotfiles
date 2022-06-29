" Search
nnoremap <Leader>a :lua require('telescope.builtin').grep_string({ search = vim.fn.input("Grep For > ")})<CR>

nnoremap <C-p> :lua require('telescope.builtin').git_files()<CR>
nnoremap <Leader>pf :lua require('telescope.builtin').find_files()<CR>
nnoremap <Leader>pa :lua require('hlimas.telescope').find_adr()<CR>
nnoremap <leader>gb :lua require('hlimas.telescope').git_branches()<CR>

nnoremap <leader>ba :lua require('hlimas.telescope').buffers()<cr>
