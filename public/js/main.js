/**
 * Main Application - Audio Analyzer
 * WebAssembly + AudioWorklet統合
 */

import { Visualizer } from "./visualizer.js";
import { UIController } from "./ui-controller.js";

class AudioAnalyzerApp {
  constructor() {
    this.isInitialized = false;
    this.isRunning = false;
    this.isPaused = false;

    // Wasm関連
    this.wasmModule = null;
    this.wasmReady = false;

    // Audio関連
    this.audioContext = null;
    this.workletNode = null;
    this.gainNode = null;
    this.mediaStream = null;

    // データバッファ
    this.magnitudes = null;
    this.peakHold = null;
    this.timeDomain = null;
    this.frequencies = null;

    // 設定
    this.binCount = 1024;
    this.sampleRate = 48000;
    this.fftSize = 2048;

    // コンポーネント
    this.visualizer = null;
    this.uiController = null;

    // アニメーション
    this.animationId = null;

    this.init();
  }

  async init() {
    try {
      // Visualizer初期化
      const canvas = document.getElementById("visualizer");
      this.visualizer = new Visualizer(canvas);

      // UIController初期化
      this.uiController = new UIController(this);

      // Wasm初期化を試みる（存在しない場合はフォールバック）
      await this.initWasm();

      // ローディング非表示
      this.uiController.hideLoading();
      this.isInitialized = true;
    } catch (error) {
      console.error("Initialization error:", error);
      // フォールバック: JavaScript FFTを使用
      this.useFallbackFFT();
      this.uiController.hideLoading();
      this.isInitialized = true;
    }
  }

  async initWasm() {
    try {
      // ES6モジュールとしてWasmをインポート
      const createModule = await import("./wasm/analyzer.js");
      this.wasmModule = await createModule.default();

      // アナライザー初期化
      this.wasmModule._create_analyzer();

      // 設定取得
      this.binCount = this.wasmModule._get_bin_count();
      this.fftSize = this.wasmModule._get_fft_size();
      this.sampleRate = this.wasmModule._get_sample_rate();

      this.wasmReady = true;
      console.log("WebAssembly module loaded successfully");
    } catch (error) {
      console.warn("WebAssembly not available, using fallback:", error);
      throw error;
    }
  }

  useFallbackFFT() {
    // JavaScriptフォールバック用の設定
    this.wasmReady = false;
    this.binCount = 1024;
    this.fftSize = 2048;
    this.sampleRate = 48000;

    // 空のデータバッファを作成
    this.magnitudes = new Float32Array(this.binCount);
    this.peakHold = new Float32Array(this.binCount);
    this.timeDomain = new Float32Array(this.fftSize);
    this.frequencies = new Float32Array(this.binCount);

    // 周波数テーブル
    const binWidth = this.sampleRate / this.fftSize;
    for (let i = 0; i < this.binCount; i++) {
      this.frequencies[i] = i * binWidth;
    }

    // ピークホールド初期化
    this.peakHold.fill(-100);

    console.log("Using JavaScript fallback for FFT");
  }

  async start() {
    if (this.isRunning) return;

    try {
      // マイクアクセス取得（モバイル対応設定）
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Microphone access granted');

      // AudioContext作成
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();

      // モバイルブラウザではAudioContextがsuspended状態で始まることがある
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // 実際のサンプリングレートを取得
      this.sampleRate = this.audioContext.sampleRate;
      console.log("AudioContext started, sampleRate:", this.sampleRate);

      // ノード作成
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.gainNode = this.audioContext.createGain();
      
      // AudioWorkletを試す、失敗したらAnalyserNodeにフォールバック
      let useWorklet = false;
      
      try {
        await this.audioContext.audioWorklet.addModule("./js/audio-processor.js");
        this.workletNode = new AudioWorkletNode(this.audioContext, "audio-analyzer-processor");
        
        // 接続
        source.connect(this.gainNode);
        this.gainNode.connect(this.workletNode);
        
        // Workletからのメッセージ処理
        this.workletNode.port.onmessage = (event) => {
          if (event.data.type === "audioData") {
            this.processAudioData(event.data.buffer);
          }
        };
        
        useWorklet = true;
        console.log("Using AudioWorklet for audio processing");
      } catch (workletError) {
        console.warn("AudioWorklet not available, using AnalyserNode fallback:", workletError);
      }
      
      // AudioWorkletが使えない場合はAnalyserNodeを使用
      if (!useWorklet) {
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = this.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.3;
        
        // 接続
        source.connect(this.gainNode);
        this.gainNode.connect(this.analyserNode);
        
        // フォールバック用のデータ配列を初期化
        this.useFallbackFFT();
        this.useAnalyserFallback = true;
        
        console.log("Using AnalyserNode for audio processing");
      }

      this.isRunning = true;
      this.uiController.showPauseButton();

      // アニメーションループ開始
      this.startAnimationLoop();
    } catch (error) {
      console.error("Failed to start audio:", error);
      alert("マイクへのアクセスに失敗しました: " + error.message);
    }
  }

  processAudioData(buffer) {
    if (this.isPaused) return;

    if (this.wasmReady) {
      // Wasmで処理
      const inputPtr = this.wasmModule._malloc(buffer.length * 4);
      this.wasmModule.HEAPF32.set(buffer, inputPtr / 4);

      this.wasmModule._process_audio(inputPtr, buffer.length);

      // 結果取得
      const magPtr = this.wasmModule._get_magnitudes();
      const peakPtr = this.wasmModule._get_peak_hold();
      const timePtr = this.wasmModule._get_time_domain();

      this.magnitudes = new Float32Array(this.wasmModule.HEAPF32.buffer, magPtr, this.binCount);
      this.peakHold = new Float32Array(this.wasmModule.HEAPF32.buffer, peakPtr, this.binCount);
      this.timeDomain = new Float32Array(this.wasmModule.HEAPF32.buffer, timePtr, this.fftSize);

      this.wasmModule._free(inputPtr);
    } else {
      // JavaScriptフォールバック（簡易FFT）
      this.fallbackProcess(buffer);
    }
  }

  fallbackProcess(buffer) {
    // 時間領域データをコピー
    this.timeDomain.set(buffer.slice(0, this.fftSize));

    // 簡易的なスペクトル近似（実際のFFTではない）
    // Web Audio APIのAnalyserNodeを使う代替案
    const gain = this.gainNode ? this.gainNode.gain.value : 1;

    for (let i = 0; i < this.binCount; i++) {
      // サンプルの絶対値平均を使った簡易的な近似
      let sum = 0;
      const samplesPerBin = Math.floor(buffer.length / this.binCount);
      for (let j = 0; j < samplesPerBin; j++) {
        const idx = i * samplesPerBin + j;
        if (idx < buffer.length) {
          sum += Math.abs(buffer[idx]);
        }
      }
      const avg = (sum / samplesPerBin) * gain;

      // dB変換
      const db = avg > 0 ? 20 * Math.log10(avg) : -100;
      this.magnitudes[i] = Math.max(-100, Math.min(0, db));

      // ピークホールド更新
      if (this.magnitudes[i] > this.peakHold[i]) {
        this.peakHold[i] = this.magnitudes[i];
      }
    }
  }

  startAnimationLoop() {
    const loop = () => {
      if (!this.isRunning) return;

      // AnalyserNodeフォールバック時はここでデータを取得
      if (this.useAnalyserFallback && this.analyserNode) {
        this.processAnalyserData();
      }

      // 描画
      this.visualizer.draw(
        this.magnitudes,
        this.peakHold,
        this.timeDomain,
        this.binCount,
        this.sampleRate,
      );

      // スポット解析のリアルタイム更新
      this.uiController.updateSpotAnalysis();

      // ステータス更新
      this.uiController.updateStatus(this.sampleRate, this.fftSize, this.visualizer.getFps());

      this.animationId = requestAnimationFrame(loop);
    };

    loop();
  }
  
  // AnalyserNodeからデータを取得して処理
  processAnalyserData() {
    if (this.isPaused) return;
    
    // 周波数データを取得
    const freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqData);
    
    // 時間領域データを取得
    const timeData = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeData);
    
    // 周波数データをdBに変換
    const gain = this.gainNode ? this.gainNode.gain.value : 1;
    for (let i = 0; i < Math.min(freqData.length, this.binCount); i++) {
      // 0-255を-100dB〜0dBに変換
      const normalized = freqData[i] / 255;
      const db = normalized > 0 ? 20 * Math.log10(normalized) : -100;
      this.magnitudes[i] = Math.max(-100, Math.min(0, db));
      
      // ピークホールド更新
      if (this.magnitudes[i] > this.peakHold[i]) {
        this.peakHold[i] = this.magnitudes[i];
      }
    }
    
    // 時間領域データを正規化
    for (let i = 0; i < Math.min(timeData.length, this.fftSize); i++) {
      this.timeDomain[i] = (timeData[i] - 128) / 128;
    }
  }

  stop() {
    this.isRunning = false;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    this.uiController.showStartButton();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.visualizer.setPaused(this.isPaused);
    this.uiController.setPauseButtonState(this.isPaused);
  }

  setMode(mode) {
    this.visualizer.setMode(mode);
  }

  setScale(scale) {
    this.visualizer.setScale(scale);
  }

  setGain(gain) {
    if (this.gainNode) {
      this.gainNode.gain.value = gain;
    }
    if (this.wasmReady && this.wasmModule) {
      this.wasmModule._set_gain(gain);
    }
  }

  setShowPeakHold(show) {
    this.visualizer.setShowPeakHold(show);
  }

  resetPeakHold() {
    if (this.wasmReady && this.wasmModule) {
      this.wasmModule._reset_peak_hold();
    } else if (this.peakHold) {
      this.peakHold.fill(-100);
    }
  }

  setZoom(zoom) {
    this.visualizer.setZoom(zoom);
  }

  getDataAtPosition(x, y) {
    if (this.magnitudes) {
      return this.visualizer.getDataAtPosition(
        x,
        y,
        this.magnitudes,
        this.binCount,
        this.sampleRate,
      );
    }
    return null;
  }
}

// アプリケーション起動
window.addEventListener("DOMContentLoaded", () => {
  window.app = new AudioAnalyzerApp();
});
