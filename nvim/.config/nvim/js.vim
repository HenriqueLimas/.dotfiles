" JavaScript

"" syntax highlight for json
autocmd BufNewFile,BufRead *.json setlocal syntax=javascript
autocmd BufNewFile,BufRead *.marko setlocal syntax=jsx

let g:jsx_ext_required=0 " Allow JSX in normal JS files
let g:closetag_filenames = "*.html,*.xhtml,*.phtml"
