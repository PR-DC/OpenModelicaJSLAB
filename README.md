# OpenModelicaJSLAB

OpenModelicaJSLAB is the Modelica compiler and simulation engine embedded by
[JSLAB](https://github.com/PR-DC/JSLAB). It is maintained as a focused fork of
[OpenModelica](https://github.com/OpenModelica/OpenModelica) and preserves the
Modelica language frontend, compiler pipeline and simulation runtime needed by
JSLAB Simulate.

The `jslab-release` build produces a versioned browser-compatible runtime with:

- the Modelica compiler;
- the in-process simulation engine and required solver modules;
- the `jslab_*` bridge ABI used by JSLAB workers;
- progress, cancellation, virtual-file and result-column integration; and
- a SHA-256 manifest for deterministic JSLAB packaging.

It does not build or package standalone graphical, notebook, shell or plotting
applications. The diagram editor, messages, parameters, workspace results and
2D/3D visualization are provided by JSLAB.

## Build

From the repository root:

```sh
cmake -S . -B build-jslab -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DOM_OMC_WASM=ON -DOM_ENABLE_GUI_CLIENTS=OFF \
  -DRUST_OMC_WASM_MODE=jslab-release -DRUST_OMC_CI=ON
cmake --build build-jslab --target install
```

The lean runtime bundle is installed to `share/omc/jslab`. Its bridge ABI is
documented in
[`OMCompiler/Compiler/OpenModelica.rs/wasm/jslab/README.md`](OMCompiler/Compiler/OpenModelica.rs/wasm/jslab/README.md).

## Upstream and license

The compiler is derived from OpenModelica. This repository starts from the
reviewed OpenModelicaJSLAB source snapshot; upstream notices and licenses are
preserved. Future upstream updates must retain those notices. See
[`OSMC-License.txt`](OSMC-License.txt) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
