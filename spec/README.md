# The standard's source

This folder is the source of the standard. The text to read, with every name filled in, is published at
https://spec.person.tools/ (the text as Markdown at `/0.1.md`, and the schemas, examples and OpenAPI file beside it).

- `src/*.md` is the text, in order. `schemas/`, `examples/`, `openapi.yaml` and `screening_fixtures.json` are its
  machine-readable parts.
- Words in double braces, such as `{{wire_prefix}}` or `{{standard}}`, are filled at build from `canon/names.json`, so
  that a name changes in one edit. In 0.1 `{{wire_prefix}}` is `x-hc-draft`. Read and build against the published copy,
  or run `build.sh`, which writes the filled copy to `site/`.
- `tools/validate.py` checks every example against its schema and the OpenAPI file against the schemas.
