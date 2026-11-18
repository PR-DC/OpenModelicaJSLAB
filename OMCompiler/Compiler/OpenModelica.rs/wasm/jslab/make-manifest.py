#!/usr/bin/env python3

import hashlib
import json
import pathlib
import subprocess
import sys


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


bundle = pathlib.Path(sys.argv[1]).resolve()
source = pathlib.Path(sys.argv[2]).resolve()
commit = subprocess.check_output(
    ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
).strip()
files = {
    str(path.relative_to(bundle)).replace("\\", "/"): sha256(path)
    for path in sorted(bundle.rglob("*"))
    if path.is_file() and path.name != "manifest.json"
}
metadata_path = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else pathlib.Path(__file__).parent / "metadata" / "metadata-version.json"
metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
library = metadata["source"]["standardLibrary"]
archive = "packages/" + library["archive"]
if files.get(archive) != metadata["source"]["standardLibraryHash"]:
    raise ValueError("The bundled standard library does not match the reviewed compiler library metadata")
library_files = {name: value for name, value in files.items() if name.startswith(("js/", "config/", "metadata/", "css/", "vendor/", "dev/"))}
(bundle / "manifest.json").write_text(
    json.dumps(
        {
            "name": "OpenModelicaJSLAB",
            "bridge_abi": 1,
            "commit": commit,
            "standard_library": library,
            "integration": {
                "version": 1,
                "content_sha256": hashlib.sha256(json.dumps(library_files, separators=(",", ":")).encode()).hexdigest(),
            },
            "files": files,
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
