"""Sets dist/manifest.json's parquetUrl to the just-published GitHub Release asset URL.

Used by .github/workflows/indexer.yml after `gh release create` uploads
dist/match-index.parquet, so the manifest (contracts/match-index-format.md) points at
its own asset. Split out into a standalone script because embedding a multi-line
`python -c` script inside a YAML `run: |` block scalar is fragile (indentation rules
differ between YAML and Python).

Usage: python scripts/set_manifest_parquet_url.py <asset_url>
"""

from __future__ import annotations

import json
import sys

MANIFEST_PATH = "dist/manifest.json"


def main() -> None:
    asset_url = sys.argv[1]
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)
    manifest["parquetUrl"] = asset_url
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
