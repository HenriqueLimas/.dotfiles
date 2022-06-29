" Run lint on save
autocmd BufWritePost,FileWritePost *.go execute 'Lint' | cwindow
