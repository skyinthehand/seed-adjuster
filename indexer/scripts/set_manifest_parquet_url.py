"""Sets dist/manifest.json's parquetUrl to the raw.githubusercontent.com URL the Parquet
file will have once pushed to the `published-index` branch (contracts/match-index-format.md).

Used by .github/workflows/indexer.yml. GitHub Releases assets were tried first but don't
support CORS (no Access-Control-Allow-Origin on release-assets.githubusercontent.com), so
the browser frontend can't fetch them directly; raw.githubusercontent.com does support CORS
(`Access-Control-Allow-Origin: *`), hence publishing via a git branch instead. Split out into
a standalone script because embedding a multi-line `python -c` script inside a YAML `run: |`
block scalar is fragile (indentation rules differ between YAML and Python).

Usage: python scripts/set_manifest_parquet_url.py <parquet_url>
"""

from __future__ import annotations

import json
import sys

MANIFEST_PATH = "dist/manifest.json"


def main() -> None:
    parquet_url = sys.argv[1]
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)
    manifest["parquetUrl"] = parquet_url
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
