colorscheme gruvbox
let g:hlimas_colorscheme = "gruvbox"
fun! ColorMyPencils()
    set encoding=utf-8
    set t_Co=256
    set fillchars+=stl:\ ,stlnc:\
    if !has('nvim')
      set term=xterm-256color
    endif
    set termencoding=utf-8

    let g:gruvbox_contrast_dark = 'hard'
    if exists('+termguicolors')
        let &t_8f = "\<Esc>[38;2;%lu;%lu;%lum"
        let &t_8b = "\<Esc>[48;2;%lu;%lu;%lum"
    endif
    let g:gruvbox_invert_selection='0'

    set background=dark
    if has('nvim')
        call luaeval('vim.cmd("colorscheme " .. _A[1])', [g:hlimas_colorscheme])
    else
        " TODO: What the way to use g:hlimas_colorscheme
        colorscheme gruvbox
    endif

    highlight ColorColumn ctermbg=0 guibg=grey
    hi SignColumn guibg=none
    hi CursorLineNR guibg=None
    highlight Normal guibg=none
    highlight LineNr guifg=#5eacd3
    highlight qfFileName guifg=#aed75f
    hi TelescopeBorder guifg=#5eacd
endfun
call ColorMyPencils()

" Vim with me
nnoremap <leader>cwm :call ColorMyPencils()<CR>
nnoremap <leader>vwb :let g:hlimas_colorscheme =
lua <<EOF
require'nvim-treesitter.configs'.setup {
    ensure_installed = { 'javascript', 'css', 'go', 'rust', 'typescript', 'html', 'vim', 'scss', 'tsx', 'json', 'markdown', 'lua', 'graphql', 'make', 'python', 'yaml', 'vue', 'svelte' },
    highlight = {
        enable = true,
        additional_vim_regex_highlighting = false,
    },
    incremental_selection = {
        enable = true,
    },
    textobjects = {
        enable = true,
    },
}
EOF
