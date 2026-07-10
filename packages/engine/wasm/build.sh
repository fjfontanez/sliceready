#!/usr/bin/env bash
# Reproducible ADMesh -> WASM build. Runs emcc inside the official emscripten
# image so no local Emscripten install is needed. Produces admesh.mjs + admesh.wasm.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="emscripten/emsdk:3.1.74"

# emscripten/emsdk:3.1.74 is amd64-only (verify with `docker manifest inspect
# "$IMAGE"`; prefer a multi-arch tag if one becomes available). On Apple
# Silicon (arm64) this means running under QEMU emulation. --platform is set
# explicitly rather than left to Docker's default so the emulation/build-time
# tradeoff is a visible, intentional choice, not a silent fallback.
PLATFORM_FLAG=()
if [ "$(uname -m)" = "arm64" ]; then
  PLATFORM_FLAG=(--platform linux/amd64)
fi

# -D__linux__ : ADMesh's portable_endian.h only knows __linux__/__APPLE__/BSD/
# Windows and #errors otherwise. Emscripten doesn't define __linux__, so without
# this it hits "platform not supported" and leaves le32toh() undeclared. Defining
# __linux__ makes it include <endian.h>, which Emscripten's musl sysroot provides.
docker run --rm "${PLATFORM_FLAG[@]}" -v "$PWD":/src -w /src "$IMAGE" \
  emcc \
    admesh-src/src/connect.c \
    admesh-src/src/normals.c \
    admesh-src/src/shared.c \
    admesh-src/src/stl_io.c \
    admesh-src/src/stlinit.c \
    admesh-src/src/util.c \
    repair_wrapper.c \
    -I admesh-src/src \
    -D__linux__ \
    -O3 \
    -o admesh.mjs \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sFORCE_FILESYSTEM=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=4GB \
    -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
    -sEXPORTED_FUNCTIONS=_repair,_malloc,_free \
    -sENVIRONMENT=web,worker,node

echo "Built: $(ls -la admesh.mjs admesh.wasm)"
