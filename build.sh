#!/bin/bash
# WebAssembly Build Script

# エラー時に停止
set -e

echo "=== Audio Analyzer WebAssembly Build ==="

# Emscripten環境をソース
if [ -f "./emsdk/emsdk_env.sh" ]; then
    source ./emsdk/emsdk_env.sh
elif [ -n "$EMSDK" ]; then
    source "$EMSDK/emsdk_env.sh"
else
    echo "Error: Emscripten SDK not found!"
    exit 1
fi

# ビルドディレクトリ作成
mkdir -p build
cd build

# CMake設定
echo "Configuring with CMake..."
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# ビルド
echo "Building..."
emmake make -j$(nproc 2>/dev/null || echo 4)

echo "=== Build Complete ==="
echo "Output: public/wasm/analyzer.js"
echo "Output: public/wasm/analyzer.wasm"
