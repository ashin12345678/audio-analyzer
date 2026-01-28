/**
 * FFT Audio Analyzer - C++ Implementation
 * High-performance FFT analysis for WebAssembly
 */

#include "fft_analyzer.h"

FFTAnalyzer::FFTAnalyzer() : gain_(1.0f) {
    // バッファ初期化
    std::memset(real_, 0, sizeof(real_));
    std::memset(imag_, 0, sizeof(imag_));
    std::memset(magnitudes_, 0, sizeof(magnitudes_));
    std::memset(peakHold_, 0, sizeof(peakHold_));
    std::memset(timeDomain_, 0, sizeof(timeDomain_));
    
    // テーブル初期化
    initTables();
}

FFTAnalyzer::~FFTAnalyzer() {
    // デストラクタ（必要に応じてリソース解放）
}

void FFTAnalyzer::initTables() {
    // ハニング窓の事前計算
    for (int i = 0; i < FFT_SIZE; i++) {
        window_[i] = 0.5f * (1.0f - std::cos(TWO_PI * i / (FFT_SIZE - 1)));
    }
    
    // 周波数ビンの計算
    float binWidth = static_cast<float>(SAMPLE_RATE) / FFT_SIZE;
    for (int i = 0; i < FFT_SIZE / 2; i++) {
        frequencies_[i] = i * binWidth;
    }
    
    // ビット反転テーブル
    int bits = static_cast<int>(std::log2(FFT_SIZE));
    for (int i = 0; i < FFT_SIZE; i++) {
        int reversed = 0;
        int temp = i;
        for (int j = 0; j < bits; j++) {
            reversed = (reversed << 1) | (temp & 1);
            temp >>= 1;
        }
        bitReverse_[i] = reversed;
    }
    
    // 三角関数テーブル（FFT用）
    for (int i = 0; i < FFT_SIZE / 2; i++) {
        float angle = -TWO_PI * i / FFT_SIZE;
        cosTable_[i] = std::cos(angle);
        sinTable_[i] = std::sin(angle);
    }
}

void FFTAnalyzer::processAudio(const float* input, int length) {
    // 入力データをコピー（ゲイン適用）
    int copyLength = std::min(length, FFT_SIZE);
    
    for (int i = 0; i < copyLength; i++) {
        timeDomain_[i] = input[i] * gain_;
        real_[i] = timeDomain_[i];
    }
    
    // 不足分はゼロパディング
    for (int i = copyLength; i < FFT_SIZE; i++) {
        real_[i] = 0.0f;
        timeDomain_[i] = 0.0f;
    }
    
    // 虚部をゼロ初期化
    std::memset(imag_, 0, sizeof(imag_));
    
    // 窓関数適用
    applyWindow();
    
    // FFT実行
    performFFT();
    
    // マグニチュード計算
    calculateMagnitudes();
    
    // ピークホールド更新
    updatePeakHold();
}

void FFTAnalyzer::applyWindow() {
    for (int i = 0; i < FFT_SIZE; i++) {
        real_[i] *= window_[i];
    }
}

void FFTAnalyzer::performFFT() {
    // ビット反転並べ替え
    float tempReal[FFT_SIZE];
    float tempImag[FFT_SIZE];
    
    for (int i = 0; i < FFT_SIZE; i++) {
        tempReal[i] = real_[bitReverse_[i]];
        tempImag[i] = imag_[bitReverse_[i]];
    }
    
    std::memcpy(real_, tempReal, sizeof(real_));
    std::memcpy(imag_, tempImag, sizeof(imag_));
    
    // Cooley-Tukey FFT（基数2）
    for (int size = 2; size <= FFT_SIZE; size *= 2) {
        int halfSize = size / 2;
        int tableStep = FFT_SIZE / size;
        
        for (int i = 0; i < FFT_SIZE; i += size) {
            for (int j = 0; j < halfSize; j++) {
                int idx = i + j;
                int idx2 = idx + halfSize;
                int tableIdx = j * tableStep;
                
                float cos_val = cosTable_[tableIdx];
                float sin_val = sinTable_[tableIdx];
                
                float tReal = real_[idx2] * cos_val - imag_[idx2] * sin_val;
                float tImag = real_[idx2] * sin_val + imag_[idx2] * cos_val;
                
                real_[idx2] = real_[idx] - tReal;
                imag_[idx2] = imag_[idx] - tImag;
                real_[idx] += tReal;
                imag_[idx] += tImag;
            }
        }
    }
}

void FFTAnalyzer::calculateMagnitudes() {
    const float minDB = -100.0f;
    const float refLevel = 1.0f;
    
    for (int i = 0; i < FFT_SIZE / 2; i++) {
        // マグニチュード計算
        float magnitude = std::sqrt(real_[i] * real_[i] + imag_[i] * imag_[i]);
        
        // 正規化
        magnitude /= (FFT_SIZE / 2);
        
        // dB変換
        if (magnitude > 0.0f) {
            magnitudes_[i] = 20.0f * std::log10(magnitude / refLevel);
        } else {
            magnitudes_[i] = minDB;
        }
        
        // 最小値クランプ
        magnitudes_[i] = std::max(magnitudes_[i], minDB);
    }
}

void FFTAnalyzer::updatePeakHold() {
    for (int i = 0; i < FFT_SIZE / 2; i++) {
        if (magnitudes_[i] > peakHold_[i]) {
            peakHold_[i] = magnitudes_[i];
        }
    }
}

void FFTAnalyzer::resetPeakHold() {
    std::memset(peakHold_, 0, sizeof(peakHold_));
    // -100dBで初期化
    for (int i = 0; i < FFT_SIZE / 2; i++) {
        peakHold_[i] = -100.0f;
    }
}

float FFTAnalyzer::getFrequencyAtBin(int bin) const {
    if (bin >= 0 && bin < FFT_SIZE / 2) {
        return frequencies_[bin];
    }
    return 0.0f;
}

float FFTAnalyzer::getDBAtBin(int bin) const {
    if (bin >= 0 && bin < FFT_SIZE / 2) {
        return magnitudes_[bin];
    }
    return -100.0f;
}
