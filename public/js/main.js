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
    
    // デバッグ
    this.debugLog = document.getElementById('debugLog');
    this.setupDebug();

    this.init();
  }
  
  // デバッグログ関数
  setupDebug() {
    document.getElementById('clearDebugBtn').addEventListener('click', () => {
      this.debugLog.innerHTML = '';
    });
  }
  
  log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    this.debugLog.appendChild(entry);
    this.debugLog.scrollTop = this.debugLog.scrollHeight;
    console.log(`[${type}] ${message}`);
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
      this.log('Starting audio capture...', 'info');
      
      // マイクアクセス取得（モバイル対応設定）
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      this.log('Requesting microphone access...', 'info');
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.log('Microphone access granted!', 'success');

      // AudioContext作成
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      this.log(`AudioContext created, state: ${this.audioContext.state}`, 'info');

      // モバイルブラウザではAudioContextがsuspended状態で始まることがある
      if (this.audioContext.state === "suspended") {
        this.log('AudioContext suspended, resuming...', 'warn');
        await this.audioContext.resume();
        this.log(`AudioContext resumed, state: ${this.audioContext.state}`, 'success');
      }

      // 実際のサンプリングレートを取得
      this.sampleRate = this.audioContext.sampleRate;
      this.log(`Sample rate: ${this.sampleRate} Hz`, 'info');

      // ノード作成
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.gainNode = this.audioContext.createGain();
      this.log('Audio nodes created', 'info');
      
      // モバイル判定
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      
      // AudioWorkletを試す（モバイルではスキップしてAnalyserNodeを使用）
      let useWorklet = false;
      
      if (isMobile) {
        this.log('Mobile device detected - using AnalyserNode', 'info');
      } else {
        try {
          this.log('Trying AudioWorklet...', 'info');
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
          this.log('Using AudioWorklet - OK!', 'success');
        } catch (workletError) {
          this.log(`AudioWorklet failed: ${workletError.message}`, 'warn');
        }
      }
      
      // AudioWorkletが使えない場合はAnalyserNodeを使用
      if (!useWorklet) {
        this.log('Using AnalyserNode fallback...', 'info');
        
        // MediaStreamのトラック情報を確認
        const tracks = this.mediaStream.getAudioTracks();
        this.log(`Audio tracks: ${tracks.length}`, 'info');
        if (tracks.length > 0) {
          const track = tracks[0];
          this.log(`Track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}, state: ${track.readyState}`, 'info');
        }
        
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = this.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.3;
        this.analyserNode.minDecibels = -100;
        this.analyserNode.maxDecibels = 0;
        
        // 接続（一部のブラウザではdestinationへの接続が必要）
        source.connect(this.gainNode);
        this.gainNode.connect(this.analyserNode);
        
        // ミュート状態でdestinationにも接続（オーディオパイプラインを活性化）
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0; // 無音
        this.analyserNode.connect(silentGain);
        silentGain.connect(this.audioContext.destination);
        this.log('Connected to destination (silent)', 'info');
        
        // フォールバック用のデータ配列を初期化
        this.useFallbackFFT();
        this.useAnalyserFallback = true;
        
        this.log('AnalyserNode configured - OK!', 'success');
      }

      this.isRunning = true;
      this.uiController.showPauseButton();
      this.log('Audio capture started!', 'success');

      // アニメーションループ開始
      this.startAnimationLoop();
    } catch (error) {
      this.log(`ERROR: ${error.message}`, 'error');
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
    let frameCount = 0;
    let lastLogTime = Date.now();
    
    const loop = () => {
      if (!this.isRunning) return;
      
      frameCount++;

      // AnalyserNodeフォールバック時はここでデータを取得
      if (this.useAnalyserFallback && this.analyserNode) {
        this.processAnalyserData();
      }
      
      // 3秒ごとにデータ状態をログ
      const now = Date.now();
      if (now - lastLogTime > 3000) {
        const maxMag = this.magnitudes ? Math.max(...this.magnitudes) : -100;
        const mode = this.useAnalyserFallback ? 'AnalyserNode' : 'AudioWorklet';
        this.log(`[${mode}] frames:${frameCount}, maxdB:${maxMag.toFixed(1)}`, 'info');
        frameCount = 0;
        lastLogTime = now;
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
    
    // デバッグ用カウンター初期化
    if (!this.analyserDebugCount) this.analyserDebugCount = 0;
    this.analyserDebugCount++;
    
    // 周波数データを取得
    const freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqData);
    
    // 時間領域データを取得
    const timeData = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeData);
    
    // 5秒ごとに生データをログ
    if (this.analyserDebugCount % 300 === 1) {
      const maxRaw = Math.max(...freqData);
      const sum = freqData.reduce((a, b) => a + b, 0);
      const first10 = Array.from(freqData.slice(0, 10)).join(',');
      this.log(`Raw: max=${maxRaw}, sum=${sum}, bins=${freqData.length}`, 'info');
      this.log(`First10: [${first10}]`, 'info');
      
      // 時間領域データも確認（128が無音の中心値）
      const timeMax = Math.max(...timeData);
      const timeMin = Math.min(...timeData);
      this.log(`Time domain: min=${timeMin}, max=${timeMax}`, 'info');
    }
    
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
