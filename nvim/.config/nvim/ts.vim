" TypeScript

"" syntax highlight
autocmd BufNewFile,BufRead *.ts set syntax=typescript
autocmd BufNewFile,BufRead *.tsx set syntax=typescript.tsx
autocmd BufNewFile,BufRead *.tsx set filetype=typescript.tsx
let g:syntastic_typescript_checkers = ['tslint', 'tsc']

let g:syntastic_check_on_open=1
let g:syntastic_enable_signs=1

"" tsuquyomi
let g:tsuquyomi_single_quote_import=1

nmap <F2> :TsuImport<CR>
