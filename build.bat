@echo off
REM WebAssembly Build Script for Windows

echo === Audio Analyzer WebAssembly Build ===

REM Emscripten環境設定
if exist "emsdk\emsdk_env.bat" (
    call emsdk\emsdk_env.bat
) else if defined EMSDK (
    call "%EMSDK%\emsdk_env.bat"
) else (
    echo Error: Emscripten SDK not found!
    exit /b 1
)

REM ビルドディレクトリ作成
if not exist "build" mkdir build
cd build

REM CMake設定
echo Configuring with CMake...
call emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -G "MinGW Makefiles"

if %ERRORLEVEL% neq 0 (
    echo CMake configuration failed!
    exit /b 1
)

REM ビルド
echo Building...
call emmake mingw32-make -j4

if %ERRORLEVEL% neq 0 (
    echo Build failed!
    exit /b 1
)

cd ..

echo === Build Complete ===
echo Output: public\wasm\analyzer.js
echo Output: public\wasm\analyzer.wasm
