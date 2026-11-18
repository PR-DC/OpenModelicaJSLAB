#!/usr/bin/env python3
"""Stage the upstream scene crates independently of generated compiler sources."""

import pathlib
import shutil
import sys

source = pathlib.Path(sys.argv[1]).resolve()
destination = pathlib.Path(sys.argv[2]).resolve()
if source == destination or source in destination.parents or destination in source.parents:
    raise ValueError("The scene build must be outside the compiler source checkout")
destination.mkdir(parents=True, exist_ok=True)
for name, target in (("openmodelica_animation", "animation"), ("openmodelica_animation_wasm", "bindings")):
    shutil.copytree(source / name, destination / target, dirs_exist_ok=True)
configuration = source / "wasm/jslab/scene-build"
for name in ("Cargo.toml", "Cargo.lock"):
    if (configuration / name).exists():
        shutil.copyfile(configuration / name, destination / name)
shutil.copyfile(source / "rust-toolchain.toml", destination / "rust-toolchain.toml")
