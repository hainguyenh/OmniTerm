; DECLARATIONS AND SCOPES
(method) @local.scope

(class) @local.scope

[
  (block)
  (do_block)
] @local.scope

(identifier) @local.reference

(constant) @local.reference

(instance_variable) @local.reference

(module
  name: (constant) @local.definition.namespace)

(class
  name: (constant) @local.definition.type)

(method
  name: [
    (identifier)
    (constant)
  ] @local.definition.function)

(singleton_method
  name: [
    (identifier)
    (constant)
  ] @local.definition.function)

(method_parameters
  (identifier) @local.definition.var)

(lambda_parameters
  (identifier) @local.definition.var)

(block_parameters
  (identifier) @local.definition.var)

(splat_parameter
  (identifier) @local.definition.var)

(hash_splat_parameter
  (identifier) @local.definition.var)

(optional_parameter
  name: (identifier) @local.definition.var)

(destructured_parameter
  (identifier) @local.definition.var)

(block_parameter
  name: (identifier) @local.definition.var)

(keyword_parameter
  name: (identifier) @local.definition.var)

(assignment
  left: (_) @local.definition.var)

(left_assignment_list
  (identifier) @local.definition.var)

(rest_assignment
  (identifier) @local.definition.var)

(destructured_left_assignment
  (identifier) @local.definition.var)
