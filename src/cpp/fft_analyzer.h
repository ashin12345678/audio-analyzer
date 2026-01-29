/**
 * FFT Audio Analyzer - C++ Engine
 * High-performance FFT analysis for WebAssembly
 */

#ifndef FFT_ANALYZER_H
#define FFT_ANALYZER_H

#include <cmath>
#include <cstring>
#include <algorithm>

// FFT設定
constexpr int FFT_SIZE = 4096;
constexpr int SAMPLE_RATE = 48000;
constexpr float PI = 3.14159265358979323846f;
constexpr float TWO_PI = 2.0f * PI;

class FFTAnalyzer {
public:
    FFTAnalyzer();
    ~FFTAnalyzer();
    
    // メイン解析関数
    void processAudio(const float* input, int length);
    
    // 結果取得
    const float* getMagnitudes() const { return magnitudes_; }
    const float* getFrequencies() const { return frequencies_; }
    const float* getPeakHold() const { return peakHold_; }
    const float* getTimeDomain() const { return timeDomain_; }
    
    // ピークホールドリセット
    void resetPeakHold();
    
    // ゲイン設定
    void setGain(float gain) { gain_ = gain; }
    float getGain() const { return gain_; }
    
    // 周波数ビン数
    int getBinCount() const { return FFT_SIZE / 2; }
    
    // 特定位置の周波数とdB取得
    float getFrequencyAtBin(int bin) const;
    float getDBAtBin(int bin) const;

private:
    // FFT実行（Cooley-Tukey）
    void performFFT();
    
    // 窓関数適用
    void applyWindow();
    
    // マグニチュード計算
    void calculateMagnitudes();
    
    // ピークホールド更新
    void updatePeakHold();

    // データバッファ
    float real_[FFT_SIZE];          // 実部
    float imag_[FFT_SIZE];          // 虚部
    float window_[FFT_SIZE];        // 窓関数
    float magnitudes_[FFT_SIZE / 2]; // マグニチュード（dB）
    float frequencies_[FFT_SIZE / 2]; // 周波数ビン（Hz）
    float peakHold_[FFT_SIZE / 2];  // ピークホールド
    float timeDomain_[FFT_SIZE];    // 時間領域データ
    
    float gain_;                     // 入力ゲイン
    
    // ビット反転テーブル
    int bitReverse_[FFT_SIZE];
    
    // 事前計算された正弦・余弦
    float cosTable_[FFT_SIZE / 2];
    float sinTable_[FFT_SIZE / 2];
    
    void initTables();
};

#endif // FFT_ANALYZER_H
