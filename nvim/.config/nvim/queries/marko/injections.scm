(scriptlet) @injection.content
(scriptlet) @injection.language

(placeholder
  (javascript_fragment) @injection.content)

((placeholder
  (javascript_fragment) @injection.content)
 (#set! injection.language "javascript"))

((scriptlet) @injection.content
 (#set! injection.language "javascript"))

((style_block_css
  (style_block_content) @injection.content)
 (#set! injection.language "css"))

((style_block_less
  (style_block_content) @injection.content)
 (#set! injection.language "less"))

((style_block_scss
  (style_block_content) @injection.content)
 (#set! injection.language "scss"))

((style_block_js
  (script_block_content) @injection.content)
 (#set! injection.language "javascript"))

((style_block_ts
  (script_block_content) @injection.content)
 (#set! injection.language "typescript"))

((script_block
  (script_block_content) @injection.content)
 (#set! injection.language "javascript"))

((top_level_statement) @injection.content
 (#set! injection.language "typescript")
 (#set! injection.include-children))

((attribute_arguments_fragment) @injection.content
 (#set! injection.language "javascript"))

((attribute_paren_fragment) @injection.content
 (#set! injection.language "javascript"))

((attribute_bracket_value) @injection.content
 (#set! injection.language "javascript"))

((attribute_method_fragment) @injection.content
 (#set! injection.language "javascript"))

((attribute_value_fragment) @injection.content
 (#set! injection.language "javascript"))

((attribute_expression_value) @injection.content
 (#set! injection.language "typescript"))

((tag_default_fragment) @injection.content
 (#set! injection.language "javascript"))

((tag_parameters_fragment) @injection.content
 (#set! injection.language "javascript"))

((tag_arguments_fragment) @injection.content
 (#set! injection.language "javascript"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#any-of? @tag "script" "html-script")
 (#set! injection.language "javascript"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag
    (shorthand_attribute) @ext)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#eq? @tag "style")
 (#eq? @ext ".less")
 (#set! injection.language "less"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag
    (shorthand_attribute) @ext)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#eq? @tag "style")
 (#eq? @ext ".scss")
 (#set! injection.language "scss"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag
    (shorthand_attribute) @ext)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#eq? @tag "style")
 (#any-of? @ext ".js" ".mjs" ".cjs")
 (#set! injection.language "javascript"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag
    (shorthand_attribute) @ext)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#eq? @tag "style")
 (#any-of? @ext ".ts" ".mts" ".cts")
 (#set! injection.language "typescript"))

((normal_element
  (start_tag
    (builtin_tag_name) @tag)
  (text) @injection.content
  (end_tag
    (builtin_tag_name)))
 (#any-of? @tag "style" "html-style")
 (#set! injection.language "css"))

