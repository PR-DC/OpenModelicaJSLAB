# SDK-only updates reuse a completed compiler build and never create an empty bundle.
if(NOT EXISTS "${RUNTIME_FILE}" OR NOT EXISTS "${LOADER_FILE}")
  message(FATAL_ERROR "Build rust_wasm before packaging the JSLAB compiler SDK.")
endif()
file(READ "${RUNTIME_FILE}" _jslab_wasm_magic LIMIT 4 HEX)
if(NOT _jslab_wasm_magic STREQUAL "0061736d")
  message(FATAL_ERROR "The existing JSLAB compiler is not a valid WebAssembly module.")
endif()
