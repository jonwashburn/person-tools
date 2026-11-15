#!/bin/bash
# Run by the deploy script in a copy of spec/: builds site/ from src/, schemas/, examples/, openapi.yaml and the canon.
# HC_WORK names the work folder (for canon/ and code/conformance/); BUILD_PYTHON and PYTHON_EXTRA_PATH come from the environment.
set -euo pipefail
: "${HC_WORK:?set HC_WORK to the work folder}"
HC_CANON="${HC_CANON:-$HC_WORK/canon}" "${BUILD_PYTHON:-python3}" build.py
