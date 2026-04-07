(doctype) @keyword

(scriptlet) @keyword

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
(tag_method_fragment) @expression
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
(attribute_arguments_fragment) @expression
(attribute_method_fragment) @expression
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
