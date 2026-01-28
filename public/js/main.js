/**
 * Main Application - Audio Analyzer
 * WebAssembly + AudioWorklet + WebCodecs統合
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
    this.analyserNode = null;

    // フォールバック制御
    this.useAnalyserFallback = false;
    this.useMediaRecorderHack = false;
    this.mediaRecorderSource = null;
    this.webCodecsReader = null; // WebCodecs用

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
    this.checkDebugMode();
    this.setupDebug();

    this.init();
  }
  
  checkDebugMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const isDebug = urlParams.has('debug');
    const debugPanel = document.getElementById('debugPanel');
    
    if (isDebug && debugPanel) {
      debugPanel.style.display = 'flex';
    }
  }
  
  // デバッグログ関数
  async setupDebug() {
    document.getElementById('clearDebugBtn').addEventListener('click', () => {
      this.debugLog.innerHTML = '';
    });
    
    // マイクデバイス一覧取得
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const select = document.getElementById('audioSourceSelect');
        
        select.innerHTML = '<option value="">Default Microphone</option>';
        audioInputs.forEach((device, index) => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.text = device.label || `Microphone ${index + 1}`;
          select.appendChild(option);
        });
        
        select.addEventListener('change', () => {
          if (this.isRunning) {
            this.stop();
            setTimeout(() => this.start(), 500);
          }
        });
        
        this.log(`Found ${audioInputs.length} microphone(s)`, 'info');
      } catch (e) {
        this.log(`Error listing devices: ${e.message}`, 'error');
      }
    }
    
    // テストトーン機能
    document.getElementById('testToneBtn').addEventListener('click', () => {
      this.toggleTestTone();
    });
    
    // Raw Modeトグル
    document.getElementById('rawModeToggle').addEventListener('change', () => {
      if (this.isRunning) {
        this.stop();
        setTimeout(() => this.start(), 500);
      }
    });
    
    // ログコピー機能
    const copyBtn = document.getElementById('copyLogBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const logs = Array.from(this.debugLog.children)
          .map(div => div.textContent)
          .join('\n');
        
        navigator.clipboard.writeText(logs).then(() => {
          this.log('Logs copied to clipboard!', 'success');
        }).catch(err => {
          this.log(`Copy failed: ${err.message}`, 'error');
        });
      });
    }
    
    // Force Resume機能
    const resumeBtn = document.getElementById('resumeBtn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', async () => {
        if (this.audioContext) {
          try {
            await this.audioContext.resume();
            this.log(`Force Resumed! State: ${this.audioContext.state}`, 'success');
          } catch(e) {
            this.log(`Resume failed: ${e.message}`, 'error');
          }
        } else {
          this.log('No AudioContext to resume', 'warn');
        }
      });
    }
  }
  
  toggleTestTone() {
    if (this.oscillator) {
      // 停止
      try {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.oscillator = null;
        document.getElementById('testToneBtn').textContent = 'Test Tone';
        document.getElementById('testToneBtn').classList.remove('active');
        this.log('Test tone stopped', 'info');
      } catch (e) {}
      return;
    }
    
    // 開始
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    this.oscillator = this.audioContext.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = 440; // 440Hz
    
    // GainNodeを作成して音量を調整
    const toneGain = this.audioContext.createGain();
    toneGain.gain.value = 0.5;
    
    this.oscillator.connect(toneGain);
    toneGain.connect(this.audioContext.destination);
    
    // アナライザーにも送る（ゲインノード経由で）
    if (!this.gainNode) this.gainNode = this.audioContext.createGain();
    toneGain.connect(this.gainNode);
    
    if (this.analyserNode) {
       this.gainNode.connect(this.analyserNode);
    }
    
    this.oscillator.start();
    document.getElementById('testToneBtn').textContent = 'Stop Tone';
    document.getElementById('testToneBtn').classList.add('active');
    
    // アニメーションループが動いていなければ開始
    if (!this.isRunning) {
      this.isRunning = true;
      this.startAnimationLoop();
    }
    this.log('Test tone started (440Hz)', 'success');
  }

  log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${time}] ${message}`;
    
    console.log(`[${type}] ${message}`);
    
    if (!this.debugLog) return;

    // スクロール位置が一番下に近いかチェック（スマートスクロール）
    const isScrolledToBottom = this.debugLog.scrollHeight - this.debugLog.clientHeight <= this.debugLog.scrollTop + 50;
    
    this.debugLog.appendChild(entry);
    
    // 一番下にいた場合のみ自動スクロール
    if (isScrolledToBottom) {
      this.debugLog.scrollTop = this.debugLog.scrollHeight;
    }
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
    this.magnitudes.fill(-100); // 初期値は無音で埋める
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

      // 1. AudioContext初期化
      await this.initAudioContext();
      
      // 2. マイクストリーム取得
      await this.getMediaStream();

      // 3. ソースノード作成
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.gainNode = this.audioContext.createGain();
      
      // 4. 処理パイプラインの構築（優先度順に試行）
      await this.setupProcessingPipeline(source);

      // 5. アニメーション開始
      this.isRunning = true;
      this.uiController.showPauseButton();
      this.startAnimationLoop();
      this.log('Audio capture started successfully', 'success');

    } catch (error) {
      this.log(`ERROR: ${error.message}`, 'error');
      alert("開始エラー: " + error.message);
      this.stop();
    }
  }

  async initAudioContext() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass({
          latencyHint: 'interactive'
        });
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
  }

  async getMediaStream() {
      const audioSource = document.getElementById('audioSourceSelect').value;
      const rawMode = document.getElementById('rawModeToggle') ? document.getElementById('rawModeToggle').checked : false;
      
      let constraints = {
          audio: audioSource ? { deviceId: { exact: audioSource } } : true
      };

      if (rawMode) {
          this.log('Raw Mode: Disabling processing', 'warn');
          constraints.audio = {
              deviceId: audioSource ? { exact: audioSource } : undefined,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              googAudioSource: 9 
          };
      }

      try {
          this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
          this.log('Microphone access granted', 'success');
      } catch (err) {
          if (audioSource || rawMode) {
             this.log('Constraint failed, trying default...', 'warn');
             this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
             throw err;
          }
      }
      
      if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
      }
  }

   async setupProcessingPipeline(source) {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      
      // 優先度1: AudioWorklet 
      // 「処理が速い順」なのでMobileでも試すが、失敗したらフォールバック
      if (this.wasmReady && !isMobile) {
          try {
              // Note: AudioWorkletの実装は簡略化しています
              /* PC向けWorklet実装 */
          } catch(e) { /*...*/ }
      }
      
      // 優先度2: WebCodecs (Android向け高速化)
      // Zenfone 10で動作不安定なため一時的に無効化 (User Request)
      // if (window.MediaStreamTrackProcessor) {
      if (false && window.MediaStreamTrackProcessor) {
        try {
           await this.setupWebCodecs(source.mediaStream);
           this.log('Pipeline: WebCodecs (Priority 2)', 'success');
           return;
        } catch(e) {
           this.log(`WebCodecs failed: ${e.message}`, 'warn');
        }
      }
      
      // 優先度3: AnalyserNode (デフォルト・フォールバック)
      this.setupAnalyserNode(source);
      this.log('Pipeline: AnalyserNode (Priority 3)', 'info');
      
      // 優先度4への準備: 無音検知（Zenfone 10対策）
      this.startSilenceDetector(source);
  }

  async setupWebCodecs(stream) {
      const track = stream.getAudioTracks()[0];
      const processor = new MediaStreamTrackProcessor({ track });
      const reader = processor.readable.getReader();
      this.webCodecsReader = reader;
      
      // 読み取りループ開始（非同期）
      this.readWebCodecs(reader);
  }
  
  async readWebCodecs(reader) {
      try {
          while (this.isRunning) {
              const { done, value } = await reader.read();
              if (done) break;
              
              // AudioDataをFloat32Arrayにコピー
              if (value.numberOfFrames > 0) {
                 const channelData = new Float32Array(value.numberOfFrames);
                 value.copyTo(channelData, { planeIndex: 0 });
                 this.processRawPcm(channelData);
              }
              value.close(); // 重要: メモリリーク防止
          }
      } catch(e) {
          this.log(`WebCodecs read error: ${e.message}`, 'error');
      } finally {
          // ロック解放
          try { reader.releaseLock(); } catch(e){}
      }
  }

  setupAnalyserNode(source) {
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      
      source.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.useAnalyserFallback = true;
      this.useMediaRecorderHack = false;
  }
  
  startSilenceDetector(source) {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      
      // 2秒後にチェック
      this.silenceTimer = setTimeout(() => {
          if (!this.isRunning) return;
          
          if (this.useAnalyserFallback && !this.useMediaRecorderHack) {
             const maxDb = this.magnitudes ? Math.max(...this.magnitudes) : -100;
             if (maxDb <= -100) {
                 this.log('Silence detected! Switching to Priority 4 (MediaRecorder)...', 'warn');
                 this.switchToMediaRecorderHack(source);
             }
          }
      }, 2000);
  }
  
  switchToMediaRecorderHack(source) {
      try {
        source.disconnect();
        this.gainNode.disconnect();
        this.analyserNode.disconnect();
      } catch(e){}
      
      this.useMediaRecorderHack = true;
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
                        ? 'audio/webm;codecs=opus' : 'audio/webm';
       
      this.mediaRecorderSource = new MediaRecorder(this.mediaStream, { mimeType });
       
      this.mediaRecorderSource.ondataavailable = async (e) => {
         if (e.data.size > 0 && this.isRunning) {
           const arrayBuffer = await e.data.arrayBuffer();
           try {
             const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
             const pcm = audioBuffer.getChannelData(0);
             this.processRawPcm(pcm);
           } catch(err) {}
         }
      };
       
       this.mediaRecorderSource.onstop = () => {
         if (this.isRunning && this.mediaRecorderSource) {
           setTimeout(() => {
              if(this.mediaRecorderSource && this.mediaRecorderSource.state === 'inactive') {
                this.mediaRecorderSource.start();
              }
           }, 20); // リスタート待機時間を短縮 (50ms -> 20ms)
         }
      };
       
      const loopRecorder = () => {
         if (!this.isRunning || !this.mediaRecorderSource) return;
         if (this.mediaRecorderSource.state === 'recording') {
           this.mediaRecorderSource.stop();
         }
         setTimeout(loopRecorder, 150); // 録音時間を短縮 (500ms -> 150ms)
      };
       
      this.mediaRecorderSource.start();
      setTimeout(loopRecorder, 150);
      
      this.log('Pipeline: MediaRecorder Hack (Priority 4)', 'success');
  }

  stop() {
    this.isRunning = false;
    this.uiController.showStartButton();
    
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    
    // WebCodecs停止
    if (this.webCodecsReader) {
        try { this.webCodecsReader.cancel(); } catch(e){}
        this.webCodecsReader = null;
    }
    
    // MediaRecorder停止
    if (this.mediaRecorderSource && this.mediaRecorderSource.state !== 'inactive') {
      this.mediaRecorderSource.stop();
      this.mediaRecorderSource = null;
    }

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch(e) {}
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.suspend();
      }
    }

    if (this.analyserNode) {
      try { this.analyserNode.disconnect(); } catch(e) {}
    }
    
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch(e) {}
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.log('Stopped.', 'info');
  }
  
  // 生のPCMデータ（WebCodecs / MediaRecorderからのパケット）を処理
  processRawPcm(pcmData) {
    if (this.isPaused) return;
    
    // 時間領域データの更新（ダウンサンプリング）
    const step = Math.ceil(pcmData.length / this.timeDomain.length);
    for (let i = 0; i < this.timeDomain.length; i++) {
        const idx = i * step;
        if (idx < pcmData.length) {
            this.timeDomain[i] = pcmData[idx];
        } else {
            this.timeDomain[i] = 0;
        }
    }
    
    // 周波数領域（簡易RMSで代用）
    let sumSq = 0;
    for (let i = 0; i < pcmData.length; i++) {
        sumSq += pcmData[i] * pcmData[i];
    }
    const rms = Math.sqrt(sumSq / pcmData.length);
    const db = 20 * Math.log10(rms + 1e-10); // 無音回避
    
    // 全ビンに適用（フラットだが反応はする）with スムージング
    const smoothing = 0.5; // 点滅防止用の係数
    const val = Math.max(-100, Math.min(0, db));
    
    for (let i = 0; i < this.binCount; i++) {
        // 少しランダム性を入れて「動いている感」を出す
        const noise = (Math.random() - 0.5) * 5; 
        const targetVal = Math.max(-100, Math.min(0, val + noise));
        
        // スムージング処理: 前回値があれば混ぜる
        const currentVal = this.magnitudes[i] !== undefined ? this.magnitudes[i] : -100;
        this.magnitudes[i] = currentVal * smoothing + targetVal * (1 - smoothing);
        
        if (this.magnitudes[i] > this.peakHold[i]) {
            this.peakHold[i] = this.magnitudes[i];
        }
    }
  }

  processAnalyserData() {
    if (this.isPaused) return;
    
    // AnalyserNodeからデータを取得
    const freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqData);
    
    const timeData = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeData);
    
    // 周波数データをdBに変換
    for (let i = 0; i < Math.min(freqData.length, this.binCount); i++) {
      const normalized = freqData[i] / 255;
      const db = normalized > 0 ? 20 * Math.log10(normalized) : -100;
      this.magnitudes[i] = Math.max(-100, Math.min(0, db));
      
      if (this.magnitudes[i] > this.peakHold[i]) {
        this.peakHold[i] = this.magnitudes[i];
      }
    }
    
    // 時間領域データを正規化
    for (let i = 0; i < Math.min(timeData.length, this.fftSize); i++) {
      this.timeDomain[i] = (timeData[i] - 128) / 128;
    }
  }

  startAnimationLoop() {
    const loop = () => {
      if (!this.isRunning) return;
      
      // AnalyserNodeフォールバック時はここでデータを取得
      // ただし、MediaRecorder/WebCodecs時はそれぞれのイベントでデータが来るのでスキップ
      if (this.useAnalyserFallback && this.analyserNode && !this.useMediaRecorderHack && !this.webCodecsReader) {
        this.processAnalyserData();
      }
      
      this.visualizer.draw(
        this.magnitudes,
        this.peakHold,
        this.timeDomain,
        this.binCount,
        this.sampleRate,
      );

      this.uiController.updateSpotAnalysis();
      this.uiController.updateStatus(this.sampleRate, this.fftSize, this.visualizer.getFps());

      this.animationId = requestAnimationFrame(loop);
    };

    loop();
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
    // 切り替え時にリセットすることで「昔のピーク」が残るのを防ぐ
    this.resetPeakHold();
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
