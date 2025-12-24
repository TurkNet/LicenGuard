# DevRules helper Makefile
# Usage in a repo:
#   make devrules
#   make devrules-force
#
# If DevRules is located elsewhere, override DEVRULES_DIR:
#   make devrules DEVRULES_DIR=~/DevRules

DEVRULES_DIR ?= ~/DevRules

devrules:
	node $(DEVRULES_DIR)/tools/apply-rules.mjs --repo .

devrules-force:
	node $(DEVRULES_DIR)/tools/apply-rules.mjs --repo . --force

devrules-dry:
	node $(DEVRULES_DIR)/tools/apply-rules.mjs --repo . --dry-run
