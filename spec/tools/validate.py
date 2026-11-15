#!/usr/bin/env python3
"""Check the machine-readable half of the standard.

Run from anywhere:
  python3 spec/tools/validate.py   (needs jsonschema and pyyaml)

It substitutes {{wire_prefix}} from canon/names.json in memory (files are not changed), then checks:
  1. every schema in spec/schemas/ is a valid JSON Schema 2020-12, and every $ref in it resolves;
  2. every example in spec/examples/valid/<object>/ passes spec/schemas/<object>.json;
  3. every example in spec/examples/invalid/<object>/ fails it, and is listed in spec/examples/INDEX.md;
  4. spec/openapi.yaml parses as OpenAPI 3.1.x and every $ref in it resolves (local pointers and ./schemas/ files).
Exit status 0 only when everything holds.
"""
import json, os, re, sys

SPEC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SPEC)

try:
    import yaml
except ImportError:
    sys.exit("validate.py: pyyaml is missing; install it or put it on PYTHONPATH")
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

with open(os.path.join(ROOT, "canon", "names.json")) as f:
    WIRE = json.load(f)["wire_prefix"]


def load_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read().replace("{{wire_prefix}}", WIRE)


def load_json(path):
    return json.loads(load_text(path))


problems = []
counts = {"schemas": 0, "refs": 0, "valid": 0, "invalid": 0, "openapi_refs": 0, "openapi_operations": 0, "fixtures": 0}

# 1. schemas
SCHEMA_DIR = os.path.join(SPEC, "schemas")
schemas = {}
for fn in sorted(os.listdir(SCHEMA_DIR)):
    if not fn.endswith(".json"):
        continue
    try:
        sch = load_json(os.path.join(SCHEMA_DIR, fn))
    except json.JSONDecodeError as e:
        problems.append(f"schemas/{fn}: not JSON: {e}")
        continue
    if sch.get("$id") != fn:
        problems.append(f"schemas/{fn}: $id is {sch.get('$id')!r}, expected {fn!r}")
    try:
        Draft202012Validator.check_schema(sch)
    except Exception as e:  # SchemaError
        problems.append(f"schemas/{fn}: not a valid 2020-12 schema: {str(e).splitlines()[0]}")
    schemas[fn] = sch
    counts["schemas"] += 1

registry = Registry().with_resources(
    [(fn, Resource.from_contents(s, default_specification=DRAFT202012)) for fn, s in schemas.items()])


def walk_refs(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str):
                yield path, v
            else:
                yield from walk_refs(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_refs(v, f"{path}/{i}")


for fn, sch in schemas.items():
    resolver = registry.resolver(base_uri=fn)
    for where, ref in walk_refs(sch):
        counts["refs"] += 1
        try:
            resolver.lookup(ref)
        except Exception as e:
            problems.append(f"schemas/{fn}{where}: $ref {ref!r} does not resolve ({type(e).__name__})")


def validator_for(obj):
    """examples/<side>/<object>/ checks against schemas/<object>.json; examples/<side>/<file>.<def>/ against the
    $def <def> of schemas/<file>.json (such as tool_args.results)."""
    name, _, frag = obj.partition(".")
    fn = name + ".json"
    if fn not in schemas:
        return None
    if frag:
        if frag not in schemas[fn].get("$defs", {}):
            return None
        return Draft202012Validator({"$ref": f"{fn}#/$defs/{frag}"}, registry=registry)
    return Draft202012Validator(schemas[fn], registry=registry)


# 2 and 3. examples
EX = os.path.join(SPEC, "examples")
index_text = ""
if os.path.exists(os.path.join(EX, "INDEX.md")):
    with open(os.path.join(EX, "INDEX.md"), encoding="utf-8") as f:
        index_text = f.read()
else:
    problems.append("examples/INDEX.md is missing")

for side in ("valid", "invalid"):
    base = os.path.join(EX, side)
    if not os.path.isdir(base):
        problems.append(f"examples/{side}/ is missing")
        continue
    for obj in sorted(os.listdir(base)):
        d = os.path.join(base, obj)
        if not os.path.isdir(d):
            continue
        v = validator_for(obj)
        if v is None:
            problems.append(f"examples/{side}/{obj}/: no schema (or $def) named {obj}")
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json"):
                continue
            rel = f"{side}/{obj}/{fn}"
            try:
                inst = load_json(os.path.join(d, fn))
            except json.JSONDecodeError as e:
                problems.append(f"examples/{rel}: not JSON: {e}")
                continue
            errs = sorted(v.iter_errors(inst), key=lambda e: list(e.absolute_path))
            if side == "valid":
                counts["valid"] += 1
                for e in errs[:3]:
                    loc = "/".join(str(p) for p in e.absolute_path) or "(root)"
                    problems.append(f"examples/{rel}: should pass but fails at {loc}: {e.message[:160]}")
            else:
                counts["invalid"] += 1
                if not errs:
                    problems.append(f"examples/{rel}: should fail but passes")
                if rel not in index_text:
                    problems.append(f"examples/{rel}: not listed with its reason in examples/INDEX.md")

# 3b. The published screening fixtures (SCREEN-7): shape only
FX = os.path.join(SPEC, "screening_fixtures.json")
if os.path.exists(FX) and "screening_fixtures.json" in schemas:
    try:
        fxe = list(Draft202012Validator(schemas["screening_fixtures.json"], registry=registry).iter_errors(load_json(FX)))
        for e in fxe[:5]:
            loc = "/".join(str(p) for p in e.absolute_path) or "(root)"
            problems.append(f"screening_fixtures.json: fails its schema at {loc}: {e.message[:160]}")
        counts["fixtures"] = 1
    except json.JSONDecodeError as e:
        problems.append(f"screening_fixtures.json: not JSON: {e}")
else:
    problems.append("screening_fixtures.json or its schema is missing")

# 4. OpenAPI
OA = os.path.join(SPEC, "openapi.yaml")
if not os.path.exists(OA):
    problems.append("openapi.yaml is missing")
else:
    try:
        oa = yaml.safe_load(load_text(OA))
    except yaml.YAMLError as e:
        oa = None
        problems.append(f"openapi.yaml: does not parse: {e}")
    if oa is not None:
        if not str(oa.get("openapi", "")).startswith("3.1"):
            problems.append(f"openapi.yaml: openapi is {oa.get('openapi')!r}, expected 3.1.x")
        for k in ("info", "paths"):
            if k not in oa:
                problems.append(f"openapi.yaml: no {k}")

        def pointer(doc, frag):
            node = doc
            if frag in ("", "/"):
                return node
            for part in frag.lstrip("/").split("/"):
                part = part.replace("~1", "/").replace("~0", "~")
                if isinstance(node, list):
                    node = node[int(part)]
                else:
                    node = node[part]
            return node

        for where, ref in walk_refs(oa):
            counts["openapi_refs"] += 1
            target, _, frag = ref.partition("#")
            try:
                if target == "":
                    pointer(oa, frag)
                else:
                    p = os.path.normpath(os.path.join(SPEC, target))
                    if not p.startswith(SCHEMA_DIR + os.sep):
                        raise KeyError("outside schemas/")
                    pointer(load_json(p), frag)
            except Exception as e:
                problems.append(f"openapi.yaml{where}: $ref {ref!r} does not resolve ({type(e).__name__}: {e})")
        for path, item in (oa.get("paths") or {}).items():
            for method, op in item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                counts["openapi_operations"] += 1
                if "responses" not in op:
                    problems.append(f"openapi.yaml: {method.upper()} {path} has no responses")
                    continue
                for status, resp in op["responses"].items():
                    if str(status).startswith(("4", "5")) or status == "default":
                        text = json.dumps(resp)
                        if "error.json" not in text and "#/components/responses/" not in text:
                            problems.append(f"openapi.yaml: {method.upper()} {path} {status} does not use error.json")

print(f"schemas {counts['schemas']} (refs {counts['refs']}); examples valid {counts['valid']}, invalid "
      f"{counts['invalid']}; screening fixtures checked {counts['fixtures']}; openapi operations {counts['openapi_operations']} (refs {counts['openapi_refs']})")
if problems:
    print(f"{len(problems)} problem(s):")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("all checks pass (wire_prefix = %s)" % WIRE)
