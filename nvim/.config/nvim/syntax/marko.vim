" Vim syntax file
" Language:     Marko
" Maintainer:   Local configuration
" Last Change:  2026 Apr 07

" quit when a syntax file was already loaded
if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn case match

" Embedded syntaxes.
unlet! b:current_syntax
syn include @markoHtml syntax/html.vim
unlet! b:current_syntax
syn include @markoJs syntax/javascript.vim
if filereadable(expand("$VIMRUNTIME/syntax/typescript.vim"))
  unlet! b:current_syntax
  syn include @markoTs syntax/typescript.vim
endif
unlet! b:current_syntax
syn include @markoCss syntax/css.vim
if filereadable(expand("$VIMRUNTIME/syntax/scss.vim"))
  unlet! b:current_syntax
  syn include @markoScss syntax/scss.vim
endif
if filereadable(expand("$VIMRUNTIME/syntax/less.vim"))
  unlet! b:current_syntax
  syn include @markoLess syntax/less.vim
endif

syn cluster markoJsExpr contains=@markoJs,@markoTs

" ---------------------------------------------------------------------
" Top-level JS/TS and placeholders
" ---------------------------------------------------------------------

syn match  markoScriptletDollar /^	*\$\ze\s\+/ contained
syn region markoScriptlet      start=/^\s*\$\s\+/ end=/$/ contains=markoScriptletDollar,@markoJsExpr keepend
syn match  markoScriptletDollar /^\s*\$\ze\s\+/ contained

syn region markoPlaceholder start=/\$!?{/ end=/}/ contains=@markoJsExpr,markoPlaceholder keepend
syn match  markoPlaceholderDelim /\$!?{/ containedin=markoPlaceholder
syn match  markoPlaceholderEnd   /}/      containedin=markoPlaceholder

syn match  markoTopLevelJsKW /^\s*\%(static\|server\|client\)\>/ contained
syn region markoTopLevelJs   start=/^\s*\%(static\|server\|client\)\>/ end=/$/ contains=markoTopLevelJsKW,@markoJsExpr keepend transparent
syn region markoTopLevelDecl start=/^\s*\%(class\|import\|export\)\>/ end=/$/ contains=@markoJsExpr keepend transparent

" ---------------------------------------------------------------------
" Markup modes
" ---------------------------------------------------------------------

syn match  markoHtmlComment /<!--\_.\{-}-->/
syn match  markoCdata       /<!\[CDATA\[\_.\{-}\]\]>/
syn region markoDoctype     start=/\s*<!\cDOCTYPE\>/ end=/>/ keepend
syn region markoDecl        start=/<?\s*[A-Za-z0-9_$-]\+/ end=/?>/ keepend

" ---------------------------------------------------------------------
" Tag parsing
" ---------------------------------------------------------------------

syn match  markoTagOpen  /</ contained nextgroup=markoTagSlash,markoTagBuiltin,markoTagFlow,markoTagFn,markoTagAttrTag,markoTagName skipwhite
syn match  markoTagClose />/ contained
syn match  markoTagSlash /\// contained nextgroup=markoTagBuiltin,markoTagFlow,markoTagFn,markoTagAttrTag,markoTagName skipwhite

syn match markoTagAttrTag /@[^\t >/]\+/ contained
syn match markoTagName    /[A-Za-z0-9_@][A-Za-z0-9_:@.-]*/ contained
syn match markoTagBuiltin /\%(script\|style\|html-script\|html-style\|html-comment\)\ze\%([\t >./(|[{]\||\|$\)/ contained
syn match markoTagFlow    /\%(for\|if\|while\|else-if\|else\|try\|await\|return\)\ze\%([\t >./(=|[{]\||\|$\)/ contained
syn match markoTagFn      /\%(const\|context\|debug\|define\|id\|let\|log\|lifecycle\)\ze\%([\t >./(|[{]\||\|$\)/ contained
syn match markoTagStyleExt /\.[A-Za-z0-9_$-]\+\(\.[A-Za-z0-9_$-]\+\)*/ contained

syn match  markoTagShorthand /[.#][A-Za-z0-9_$-]\+/ contained
syn match  markoTagVarSep    /\%(<\)\@<!\// contained
syn region markoTagVar       start=/\%(<\)\@<!\// end=/\%([,;(|/>\t ]\|:\?=\|$\)/ contains=@markoJsExpr keepend contained

syn region markoTagTypeArgs start=/\%([A-Za-z0-9_@.-]\)\@<=\s*<\ze[^/]/ end=/>/ contains=@markoJsExpr keepend contained
syn region markoTagParams   start=/\%([A-Za-z0-9_@.-]\)\@<=\s*|/ end=/|/ contains=@markoJsExpr keepend contained
syn region markoTagArgs     start=/\%([A-Za-z0-9_@.-]\)\@<=\s*(/ end=/)/ contains=@markoJsExpr keepend contained
syn region markoTagMethod   start=/\s*{/ end=/}/ contains=@markoJsExpr,markoPlaceholder keepend contained

" ---------------------------------------------------------------------
" Attributes
" ---------------------------------------------------------------------

syn match  markoAttrSpecial /\%(^\|\s\)\zs\%(key\|on[A-Za-z0-9_$-]\+\|[A-Za-z0-9_$]\+Change\|no-update\%(-body\)\?\%(-if\)\?\)\ze\%([:=\t >,/\]]\|$\)/ contained
syn match  markoAttrName    /\%(^\|\s\)\zs[A-Za-z0-9_$][A-Za-z0-9_$-]*\%(:[A-Za-z0-9_$][A-Za-z0-9_$-]*\)\?/ contained
syn match  markoAttrShort   /\%(^\|\s\)\zs#[A-Za-z0-9_$][A-Za-z0-9_$-]*/ contained
syn match  markoAttrSpread  /\.\.\./ contained
syn match  markoAttrAssign  /=/ contained

syn region markoAttrArgs   start=/\s*(/ end=/)/ contains=@markoJsExpr keepend contained
syn region markoAttrMethod start=/\s*{/ end=/}/ contains=@markoJsExpr,markoPlaceholder keepend contained
syn region markoAttrValue  start=/\s*=\s*/ end=/\%([,;\]>]\|\/\?>\|$\)/ contains=markoString,@markoJsExpr,markoPlaceholder keepend contained

syn region markoString start=/"/ skip=/\\./ end=/"/ keepend contained
syn region markoString start=/'/ skip=/\\./ end=/'/ keepend contained

syn region markoTag start=/</ end=/>/ keepend contains=markoTagOpen,markoTagClose,markoTagSlash,markoTagAttrTag,markoTagBuiltin,markoTagFlow,markoTagFn,markoTagName,markoTagStyleExt,markoTagTypeArgs,markoTagParams,markoTagArgs,markoTagMethod,markoTagShorthand,markoTagVarSep,markoTagVar,markoAttrSpecial,markoAttrName,markoAttrShort,markoAttrSpread,markoAttrAssign,markoAttrArgs,markoAttrMethod,markoAttrValue,markoString,markoPlaceholder

" ---------------------------------------------------------------------
" Style/script content tags and top-level style blocks
" ---------------------------------------------------------------------

syn match  markoStyleKw  /^\s*style\ze\%(\.[^[:space:]{}]\+\)\?\s\+{/ contained
syn match  markoStyleMod /^\s*style\zs\.[^[:space:]{}]\+\ze\s\+{/ contained
syn region markoStyleBlockCss  start=/^\s*style\%\(\.[^[:space:]{}]*\.css\)\?\s\+{/ end=/}/ contains=markoStyleKw,markoStyleMod,@markoCss,markoPlaceholder keepend
syn region markoStyleBlockLess start=/^\s*style\.[^[:space:]{}]*\.less\s\+{/ end=/}/ contains=markoStyleKw,markoStyleMod,@markoLess,markoPlaceholder keepend
syn region markoStyleBlockScss start=/^\s*style\.[^[:space:]{}]*\.scss\s\+{/ end=/}/ contains=markoStyleKw,markoStyleMod,@markoScss,markoPlaceholder keepend
syn region markoStyleBlockTs   start=/^\s*style\.[^[:space:]{}]*\.[tj]s\s\+{/ end=/}/ contains=markoStyleKw,markoStyleMod,@markoJsExpr,markoPlaceholder keepend

syn region markoHtmlStyleLess start=/\s*<\%(html-\)\?style\b[^>]*\.less[^>]*>/ end=/\s*<\/\%(html-\)\?style\s*>/ contains=markoTag,@markoLess,markoPlaceholder keepend
syn region markoHtmlStyleScss start=/\s*<\%(html-\)\?style\b[^>]*\.scss[^>]*>/ end=/\s*<\/\%(html-\)\?style\s*>/ contains=markoTag,@markoScss,markoPlaceholder keepend
syn region markoHtmlStyleTs   start=/\s*<\%(html-\)\?style\b[^>]*\.[tj]s[^>]*>/ end=/\s*<\/\%(html-\)\?style\s*>/ contains=markoTag,@markoJsExpr,markoPlaceholder keepend
syn region markoHtmlStyleCss  start=/\s*<\%(html-\)\?style\b[^>]*>/ end=/\s*<\/\%(html-\)\?style\s*>/ contains=markoTag,@markoCss,markoPlaceholder keepend
syn region markoHtmlScript    start=/\s*<\%(html-\)\?script\b[^>]*>/ end=/\s*<\/\%(html-\)\?script\s*>/ contains=markoTag,@markoJsExpr,markoPlaceholder keepend
syn region markoHtmlCommentTag start=/\s*<html-comment\b[^>]*>/ end=/\s*<\/html-comment\s*>/ contains=markoTag,markoPlaceholder,markoHtmlComment keepend

" ---------------------------------------------------------------------
" Concise mode
" ---------------------------------------------------------------------

syn match  markoConciseFence /\s*--\+\s*$/
syn region markoConciseFenceBlock start=/^\s*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=@markoHtml,markoTag,markoPlaceholder,markoScriptlet,markoHtmlComment keepend
syn region markoConciseFenceLine  start=/^\s*--\+\s\+/ end=/$/ contains=@markoHtml,markoTag,markoPlaceholder keepend

syn region markoConciseCommentBlock start=/^\s*html-comment\b.*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,markoHtmlComment keepend
syn region markoConciseCommentLine  start=/^\s*html-comment\b.*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,markoHtmlComment keepend

syn region markoConciseScriptBlock start=/^\s*\%(html-\)\?script\b.*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,@markoJsExpr keepend
syn region markoConciseScriptLine  start=/^\s*\%(html-\)\?script\b.*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,@markoJsExpr keepend

syn region markoConciseStyleBlock     start=/^\s*\%(html-\)\?style\b.*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,@markoCss keepend
syn region markoConciseStyleLine      start=/^\s*\%(html-\)\?style\b.*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,@markoCss keepend
syn region markoConciseStyleBlockLess start=/^\s*\%(html-\)\?style\b[^\n]*\.less[^\n]*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,@markoLess keepend
syn region markoConciseStyleLineLess  start=/^\s*\%(html-\)\?style\b[^\n]*\.less[^\n]*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,@markoLess keepend
syn region markoConciseStyleBlockScss start=/^\s*\%(html-\)\?style\b[^\n]*\.scss[^\n]*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,@markoScss keepend
syn region markoConciseStyleLineScss  start=/^\s*\%(html-\)\?style\b[^\n]*\.scss[^\n]*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,@markoScss keepend
syn region markoConciseStyleBlockTs   start=/^\s*\%(html-\)\?style\b[^\n]*\.[tj]s[^\n]*\z(--\+\)\s*$/ end=/^\s*\z1\s*$/ contains=markoTag,markoPlaceholder,@markoJsExpr keepend
syn region markoConciseStyleLineTs    start=/^\s*\%(html-\)\?style\b[^\n]*\.[tj]s[^\n]*--\+\s\+/ end=/$/ contains=markoTag,markoPlaceholder,@markoJsExpr keepend

syn match  markoConciseTerm /\s*;\s*$/
syn region markoConciseTagLine start=/^[ \t]*\%\(\%(class\|import\|export\|type\|interface\|enum\|function\|var\)\>\)\@!\ze[A-Za-z0-9_$@.#]/ end=/$/ contains=markoTagBuiltin,markoTagFlow,markoTagFn,markoTagAttrTag,markoTagName,markoTagStyleExt,markoTagTypeArgs,markoTagParams,markoTagArgs,markoTagMethod,markoTagShorthand,markoAttrSpecial,markoAttrName,markoAttrShort,markoAttrSpread,markoAttrAssign,markoAttrArgs,markoAttrMethod,markoAttrValue,markoString,markoPlaceholder,markoConciseTerm,@markoJsExpr keepend
syn region markoConciseAttrGroup start=/\[/ end=/\]/ contains=markoConciseAttrGroup,markoAttrSpecial,markoAttrName,markoAttrShort,markoAttrSpread,markoAttrAssign,markoAttrArgs,markoAttrMethod,markoAttrValue,markoString,markoPlaceholder,@markoJsExpr keepend

" ---------------------------------------------------------------------
" Highlight links
" ---------------------------------------------------------------------

hi def link markoScriptletDollar Keyword
hi def link markoScriptlet       PreProc
hi def link markoPlaceholder     Special
hi def link markoPlaceholderDelim Delimiter
hi def link markoPlaceholderEnd   Delimiter
hi def link markoTopLevelJsKW    Keyword
hi def link markoTopLevelJs      Statement
hi def link markoTopLevelDecl    Statement

hi def link markoHtmlComment Comment
hi def link markoCdata       String
hi def link markoDoctype     PreProc
hi def link markoDecl        PreProc

hi def link markoTagOpen     Delimiter
hi def link markoTagClose    Delimiter
hi def link markoTagSlash    Delimiter
hi def link markoTagAttrTag  Identifier
hi def link markoTagBuiltin  Tag
hi def link markoTagFlow     Conditional
hi def link markoTagFn       Function
hi def link markoTagName     Tag
hi def link markoTagStyleExt Type
hi def link markoTagTypeArgs Delimiter
hi def link markoTagParams   Delimiter
hi def link markoTagArgs     Delimiter
hi def link markoTagMethod   Delimiter
hi def link markoTagShorthand Type
hi def link markoTagVarSep   Delimiter
hi def link markoTagVar      Identifier

hi def link markoAttrSpecial Keyword
hi def link markoAttrName    Identifier
hi def link markoAttrShort   Identifier
hi def link markoAttrSpread  Operator
hi def link markoAttrAssign  Operator
hi def link markoAttrArgs    Delimiter
hi def link markoAttrMethod  Delimiter
hi def link markoAttrValue   Expression
hi def link markoString      String

hi def link markoStyleKw        Keyword
hi def link markoStyleMod       Type
hi def link markoStyleBlockCss  PreProc
hi def link markoStyleBlockLess PreProc
hi def link markoStyleBlockScss PreProc
hi def link markoStyleBlockTs   PreProc

hi def link markoConciseFence           Delimiter
hi def link markoConciseFenceBlock      Delimiter
hi def link markoConciseFenceLine       Delimiter
hi def link markoConciseCommentBlock    Comment
hi def link markoConciseCommentLine     Comment
hi def link markoConciseScriptBlock     PreProc
hi def link markoConciseScriptLine      PreProc
hi def link markoConciseStyleBlock      PreProc
hi def link markoConciseStyleLine       PreProc
hi def link markoConciseStyleBlockLess  PreProc
hi def link markoConciseStyleLineLess   PreProc
hi def link markoConciseStyleBlockScss  PreProc
hi def link markoConciseStyleLineScss   PreProc
hi def link markoConciseStyleBlockTs    PreProc
hi def link markoConciseStyleLineTs     PreProc
hi def link markoConciseTerm            Delimiter
hi def link markoConciseTagLine         Statement
hi def link markoConciseAttrGroup       Delimiter

let b:current_syntax = "marko"

let &cpo = s:cpo_save
unlet s:cpo_save
