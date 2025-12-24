# DevRules helper justfile
# Usage in a repo:
#   just devrules
#   just devrules-force
#
# If DevRules is located elsewhere:
#   just devrules DEVRULES_DIR=~/DevRules

DEVRULES_DIR := env_var_or_default("DEVRULES_DIR", "~/DevRules")

devrules:
  node {{DEVRULES_DIR}}/tools/apply-rules.mjs --repo .

devrules-force:
  node {{DEVRULES_DIR}}/tools/apply-rules.mjs --repo . --force

devrules-dry:
  node {{DEVRULES_DIR}}/tools/apply-rules.mjs --repo . --dry-run
