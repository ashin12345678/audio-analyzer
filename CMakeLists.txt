cmake_minimum_required(VERSION 3.10)
project(AudioAnalyzer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ソースファイル
set(SOURCES
    src/cpp/fft_analyzer.cpp
    src/cpp/exports.cpp
)

# ヘッダーファイル
set(HEADERS
    src/cpp/fft_analyzer.h
)

# 実行ファイル（Wasmモジュール）
add_executable(analyzer ${SOURCES} ${HEADERS})

# Emscripten設定
if(EMSCRIPTEN)
    set_target_properties(analyzer PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public/wasm"
    )
    
    # Emscriptenリンカーフラグ
    target_link_options(analyzer PRIVATE
        # メモリ設定
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=16777216
        -sMAXIMUM_MEMORY=268435456
        
        # エクスポート設定
        -sEXPORTED_FUNCTIONS=[
            '_create_analyzer',
            '_destroy_analyzer',
            '_process_audio',
            '_get_magnitudes',
            '_get_frequencies',
            '_get_peak_hold',
            '_get_time_domain',
            '_reset_peak_hold',
            '_set_gain',
            '_get_gain',
            '_get_bin_count',
            '_get_frequency_at_bin',
            '_get_db_at_bin',
            '_get_fft_size',
            '_get_sample_rate',
            '_malloc',
            '_free'
        ]
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPF32']
        
        # モジュール設定
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME='createAnalyzerModule'
        -sENVIRONMENT='web'
        
        # 最適化
        -O3
        -flto
        
        # WebAssemblyファイル生成
        -sWASM=1
        -sSINGLE_FILE=0
    )
    
    # コンパイラ最適化フラグ
    target_compile_options(analyzer PRIVATE
        -O3
        -flto
        -ffast-math
    )
endif()
