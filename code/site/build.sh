#!/bin/bash
# Run by bin/golive inside its build copy with OUT=<output folder>. Builds the site from the canon + runner's READY human pages.
set -euo pipefail
python3 "$(dirname "$0")/build.py" --out "$OUT"
