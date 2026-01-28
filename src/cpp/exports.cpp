/**
 * WebAssembly Export Functions
 * C++ to JavaScript interface
 */

#include "fft_analyzer.h"
#include <emscripten/emscripten.h>

// グローバルアナライザーインスタンス
static FFTAnalyzer* g_analyzer = nullptr;

extern "C" {

// アナライザー生成
EMSCRIPTEN_KEEPALIVE
void create_analyzer() {
    if (g_analyzer) {
        delete g_analyzer;
    }
    g_analyzer = new FFTAnalyzer();
}

// アナライザー破棄
EMSCRIPTEN_KEEPALIVE
void destroy_analyzer() {
    if (g_analyzer) {
        delete g_analyzer;
        g_analyzer = nullptr;
    }
}

// オーディオ処理
EMSCRIPTEN_KEEPALIVE
void process_audio(float* input, int length) {
    if (g_analyzer) {
        g_analyzer->processAudio(input, length);
    }
}

// マグニチュードデータ取得（ポインタを返す）
EMSCRIPTEN_KEEPALIVE
float* get_magnitudes() {
    if (g_analyzer) {
        return const_cast<float*>(g_analyzer->getMagnitudes());
    }
    return nullptr;
}

// 周波数データ取得
EMSCRIPTEN_KEEPALIVE
float* get_frequencies() {
    if (g_analyzer) {
        return const_cast<float*>(g_analyzer->getFrequencies());
    }
    return nullptr;
}

// ピークホールドデータ取得
EMSCRIPTEN_KEEPALIVE
float* get_peak_hold() {
    if (g_analyzer) {
        return const_cast<float*>(g_analyzer->getPeakHold());
    }
    return nullptr;
}

// 時間領域データ取得
EMSCRIPTEN_KEEPALIVE
float* get_time_domain() {
    if (g_analyzer) {
        return const_cast<float*>(g_analyzer->getTimeDomain());
    }
    return nullptr;
}

// ピークホールドリセット
EMSCRIPTEN_KEEPALIVE
void reset_peak_hold() {
    if (g_analyzer) {
        g_analyzer->resetPeakHold();
    }
}

// ゲイン設定
EMSCRIPTEN_KEEPALIVE
void set_gain(float gain) {
    if (g_analyzer) {
        g_analyzer->setGain(gain);
    }
}

// ゲイン取得
EMSCRIPTEN_KEEPALIVE
float get_gain() {
    if (g_analyzer) {
        return g_analyzer->getGain();
    }
    return 1.0f;
}

// FFTビン数取得
EMSCRIPTEN_KEEPALIVE
int get_bin_count() {
    if (g_analyzer) {
        return g_analyzer->getBinCount();
    }
    return 0;
}

// 特定ビンの周波数取得
EMSCRIPTEN_KEEPALIVE
float get_frequency_at_bin(int bin) {
    if (g_analyzer) {
        return g_analyzer->getFrequencyAtBin(bin);
    }
    return 0.0f;
}

// 特定ビンのdB取得
EMSCRIPTEN_KEEPALIVE
float get_db_at_bin(int bin) {
    if (g_analyzer) {
        return g_analyzer->getDBAtBin(bin);
    }
    return -100.0f;
}

// FFTサイズ取得
EMSCRIPTEN_KEEPALIVE
int get_fft_size() {
    return FFT_SIZE;
}

// サンプリングレート取得
EMSCRIPTEN_KEEPALIVE
int get_sample_rate() {
    return SAMPLE_RATE;
}

} // extern "C"
