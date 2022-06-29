" Prettier
let g:prettier#autoformat = 0
if filereadable(findfile('.prettierrc.js', '.;'))
  echo "Using prettier..."
  autocmd BufWritePre *.js,*.jsx,*.mjs,*.ts,*.tsx,*.css,*.less,*.scss,*.json,*.graphql,*.vue,*.yaml,*.html PrettierAsync
endif

