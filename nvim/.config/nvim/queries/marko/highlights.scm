(doctype) @keyword
(html_comment) @comment

(scriptlet) @keyword

(style_block_css) @keyword
(style_block_less) @keyword
(style_block_scss) @keyword
(style_block_js) @keyword
(style_block_ts) @keyword
(script_block) @keyword

(concise_tag) @tag
(concise_attribute_group
  ["[" "]"] @punctuation.bracket)
(concise_terminator) @punctuation.delimiter
(concise_fence_block
  ["---" "---"] @punctuation.special)
(concise_fence_line
  ["--"] @punctuation.special)

(placeholder
  ["${" "$!{" "}"] @punctuation.special)

(builtin_tag_name) @tag
(flow_tag_name) @conditional
(function_tag_name) @function
(dynamic_tag_name
  ["${" "}"] @punctuation.special)
(tag_variable) @variable
(tag_default_value) @operator
(tag_variable_fragment) @variable
(tag_default_fragment) @expression
(tag_parameters_fragment) @parameter
(tag_arguments_fragment) @expression
(tag_method_block_fragment) @expression
(tag_parameters
  ["|" "|"] @punctuation.delimiter)
(tag_arguments
  ["(" ")"] @punctuation.delimiter)
(tag_method
  ["{" "}"] @punctuation.delimiter)

(tag_name) @tag
(special_attribute_name) @keyword
(attribute_name) @tag.attribute
(shorthand_attribute) @tag.attribute
(attribute_arguments
  ["(" ")"] @punctuation.delimiter)
(attribute_method
  ["{" "}"] @punctuation.delimiter)
(attribute_paren_value
  ["(" ")"] @punctuation.delimiter)
(attribute_bracket_value
  ["[" "]"] @punctuation.bracket)
(attribute_arguments_fragment) @expression
(attribute_paren_fragment) @expression
(attribute_bracket_fragment) @expression
(attribute_method_fragment) @expression
(attribute_method_nested_block
  ["{" "}"] @punctuation.delimiter)
(attribute_value_fragment) @expression

[
  "<"
  "</"
  ">"
  "/>"
] @tag.delimiter

(quoted_attribute_value) @string
(unquoted_attribute_value) @string

(top_level_statement) @none
(text) @none

