/**
 * Main Application - Audio Analyzer
 * WebAssembly + AudioWorklet + WebCodecs統合
 */

import { Visualizer } from "./visualizer.js";
import { UIController } from "./ui-controller.js";

// 簡易FFTクラス
class SimpleFFT {
    constructor(size) {
        this.size = size;
        this.windowType = 'rectangular';
        this.windowTable = new Float32Array(size).fill(1.0);
        this.acGain = 1.0; // 振幅補正係数（リニア倍率）

        this.reverseTable = new Uint32Array(size);
        this.sinTable = new Float32Array(size);
        this.cosTable = new Float32Array(size);
        
        this.initTables();
        this.setWindowType('hanning'); // Default
    }

    initTables() {
        const size = this.size;
        let limit = 1;
        let bit = size >> 1;
        while (limit < size) {
            for (let i = 0; i < limit; i++) {
                this.reverseTable[i + limit] = this.reverseTable[i] + bit;
            }
            limit <<= 1;
            bit >>= 1;
        }

        for (let i = 0; i < size; i++) {
            this.sinTable[i] = Math.sin(-Math.PI / i);
            this.cosTable[i] = Math.cos(-Math.PI / i);
        }
    }

    setWindowType(type) {
        this.windowType = type;
        const n = this.size;
        
        if (type === 'hanning') {
            // Hanning Window
            // w(n) = 0.5 - 0.5 * cos(2*PI*n / (N-1))
            // AC Gain (Amplitude Correction) ≈ 2.0 (+6.02dB)
            this.acGain = 2.0; 
            for(let i=0; i<n; i++) {
                this.windowTable[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
            }
        } else if (type === 'blackman') {
            // Blackman-Harris (approx) or Standard Blackman
            // Standard Blackman: w(n) = 0.42 - 0.5*cos(...) + 0.08*cos(...)
            // AC Gain ≈ 2.38 (+7.53dB)
            this.acGain = 2.38;
            for(let i=0; i<n; i++) {
                const a0 = 0.42, a1 = 0.5, a2 = 0.08;
                const phase = (2 * Math.PI * i) / (n - 1);
                this.windowTable[i] = a0 - a1 * Math.cos(phase) + a2 * Math.cos(2 * phase);
            }
        } else {
            // Rectangular (None)
            // AC Gain = 1.0 (0dB)
            this.acGain = 1.0;
            this.windowTable.fill(1.0);
        }
    }

    calculateSpectrum(input) {
        const n = this.size;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);

        // ビット反転コピー
        for (let i = 0; i < n; i++) {
            real[i] = input[this.reverseTable[i]];
            imag[i] = 0;
        }

        // Butterfly演算
        let halfSize = 1;
        while (halfSize < n) {
            const phaseShiftStepReal = Math.cos(-Math.PI / halfSize);
            const phaseShiftStepImag = Math.sin(-Math.PI / halfSize);
            
            let currentPhaseShiftReal = 1.0;
            let currentPhaseShiftImag = 0.0;

            for (let fftStep = 0; fftStep < halfSize; fftStep++) {
                for (let i = fftStep; i < n; i += 2 * halfSize) {
                    const off = i + halfSize;
                    const tr = currentPhaseShiftReal * real[off] - currentPhaseShiftImag * imag[off];
                    const ti = currentPhaseShiftReal * imag[off] + currentPhaseShiftImag * real[off];

                    real[off] = real[i] - tr;
                    imag[off] = imag[i] - ti;
                    real[i] += tr;
                    imag[i] += ti;
                }
                
                const tmpReal = currentPhaseShiftReal;
                currentPhaseShiftReal = tmpReal * phaseShiftStepReal - currentPhaseShiftImag * phaseShiftStepImag;
                currentPhaseShiftImag = tmpReal * phaseShiftStepImag + currentPhaseShiftImag * phaseShiftStepReal;
            }
            halfSize <<= 1;
        }

        // マグニチュード計算 (前半のみ)
        const output = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            // 正規化 (本来は 1/N だが、表示用に見やすく調整)
            const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n * 4.0;
            output[i] = mag;
        }
        return output;
    }
}

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
    this.sampleRate = 48000;
    this.sampleRate = 48000;
    this.fftSize = 2048;
    this.windowType = 'hanning'; // rectangular, hanning, blackman
    this.peakHoldMode = 'decay'; // decay, hold, off
    this.initialGain = 1.0;
    
    // AGC設定
    this.agcEnabled = false;
    this.agcTargetDb = -12; // 目標レベル
    this.agcMaxGain = 10.0; // 最大ゲイン (+20dB)
    this.agcMinGain = 0.1;  // 最小ゲイン (-20dB)
    this.agcAttack = 0.05;  // 下げる時の速度 (速い)
    this.agcRelease = 0.005; // 上げる時の速度 (遅い)

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

  setGain(value) {
    if (this.gainNode) {
      // 安全策: 有限数チェック
      if (!isFinite(value)) return;
      
      // 目標値への線形補間（クリックノイズ防止）
      this.gainNode.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.05);
    }
    // AGCが無効な時のみ、現在のゲインを基準として保持（AGC有効時は自動変動するため）
    if (!this.agcEnabled) {
        this.initialGain = value;
    }
  }

  setAgcEnabled(enabled) {
      this.agcEnabled = enabled;
      this.log(`AGC: ${enabled ? 'ON' : 'OFF'}`, 'info');
  }

  setWindowType(type) {
      this.windowType = type;
      // FFTインスタンスがあれば窓関数を再生成
      if (this.fft) {
          this.fft.setWindowType(type);
      }
      this.log(`Window: ${type}`, 'info');
  }

  // 自動ゲイン制御ロジック
  updateAutoGain(currentRms) {
      if (!this.agcEnabled || !this.gainNode) return;
      if (currentRms < 0.000001) return; // 無音時は無視

      const currentDb = 20 * Math.log10(currentRms);
      // Main Gainの影響を含めた出力レベルを推定 (InputRMS * Gain)
      // ただし、this.gainNode.gain.value は現在適用中のゲイン
      const currentGain = this.gainNode.gain.value;
      const outputDb = currentDb + 20 * Math.log10(currentGain);

      let diffDb = this.agcTargetDb - outputDb;
      
      // クリップ防止（過大入力は即座に下げる）
      if (outputDb > -1.0) {
          diffDb = -5.0; // 強制的に下げる
      }

      // 調整量
      let adjust = 0;
      if (diffDb < 0) {
          // 下げる (Attack)
          adjust = diffDb * this.agcAttack;
      } else {
          // 上げる (Release)
          adjust = diffDb * this.agcRelease;
      }

      // 新しいゲインを計算
      const newGainDb = 20 * Math.log10(currentGain) + adjust;
      let newGain = Math.pow(10, newGainDb / 20);

      // リミット
      newGain = Math.max(this.agcMinGain, Math.min(this.agcMaxGain, newGain));

      // 適用
      if (Math.abs(newGain - currentGain) > 0.01) {
          this.gainNode.gain.setTargetAtTime(newGain, this.audioContext.currentTime, 0.1);
          // UI反映 (頻度を下げるために変化が大きい時だけ呼ぶのが理想だが、ここでは常時)
          if(this.uiController) {
             this.uiController.updateGainDisplay(newGain);
          }
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
    
    // AGC更新（生のRMSを使用）
    if (Number.isFinite(rms)) {
        this.updateAutoGain(rms);
    }
    
    // ソフトゲイン適用（AGC/手動ゲインを反映）
    const currentGain = this.gainNode ? this.gainNode.gain.value : 1.0;
    const finalRms = rms * currentGain;

    const db = 20 * Math.log10(finalRms + 1e-10); // 無音回避
    
    // FFT解析 (JS実装)
    if (!this.fft) {
        this.fft = new SimpleFFT(this.fftSize);
        // 初期窓設定
        this.fft.setWindowType(this.windowType);
    }

    // ウィンドウ関数適用とデータセット
    // pcmDataの長さがfftSizeと異なる場合、最新のデータを切り出すかゼロ埋めする
    const inputData = new Float32Array(this.fftSize);
    const len = Math.min(pcmData.length, this.fftSize);
    // 最新のデータを取得（最後尾から）
    const offset = Math.max(0, pcmData.length - this.fftSize);
    
    // 窓関数適用
    const windowFunc = this.fft.windowTable;
    for (let i = 0; i < this.fftSize; i++) {
        if (i < len) {
            inputData[i] = pcmData[offset + i] * windowFunc[i];
        } else {
            inputData[i] = 0;
        }
    }

    // FFT実行 (magnitudes取得)
    const fftMags = this.fft.calculateSpectrum(inputData);

    // 振幅補正 (Amplitude Correction)
    // 窓関数を掛けるとエネルギーが減るので補正する
    // Rect=0dB, Hann=+6.02dB, Blackman=+7.5dB 程度
    // SimpleFFT側で補正係数を持っている
    const acGain = this.fft.acGain;

    // スムージング係数 (0.0=即時反映, 1.0=変化なし)

    // スムージング係数 (0.0=即時反映, 1.0=変化なし)
    // 点滅を防ぐために少し強めにかける
    const smoothing = 0.3; 
    
    // データ更新
    for (let i = 0; i < this.binCount; i++) {
        // FFTの結果はリニアなのでdB変換
        // fftMagsは 0~1 程度に正規化されている前提
        let mag = fftMags[i];
        
        // 安全対策: NaN/Infinityチェック
        if (!Number.isFinite(mag)) mag = 0;
        
        // dB変換 (log10(0)対策も含める)
        // ここで振幅補正(acGain)も適用する
        let db = 20 * Math.log10(mag * acGain + 1e-10);
        
        // ゲイン適用 (Soft Gain)
        const currentGain = this.gainNode ? this.gainNode.gain.value : 1.0;
        if (Number.isFinite(currentGain) && currentGain > 0) {
            db += 20 * Math.log10(currentGain);
        }

        // クランプ & NaNチェック
        if (!Number.isFinite(db)) db = -100;
        db = Math.max(-100, Math.min(0, db));

        // スムージング
        let currentVal = this.magnitudes[i];
        if (!Number.isFinite(currentVal)) currentVal = -100; // 初期不良対策

        this.magnitudes[i] = currentVal * smoothing + db * (1 - smoothing);
        
             // Peak Hold更新
             this.updatePeakHold(i, this.magnitudes[i]);
         }
    }


  // Peak Hold更新ロジック（共通化）
  updatePeakHold(index, currentMag) {
      if (this.peakHoldMode === 'off') return;

      let currentPeak = this.peakHold[index];
      if (!Number.isFinite(currentPeak)) currentPeak = -100;

      if (currentMag > currentPeak) {
          this.peakHold[index] = currentMag;
      } else if (this.peakHoldMode === 'decay') {
           // Auto Decay (3秒程度で減衰)
           // 60FPS: -0.5dB/frame -> 30dB/sec -> 3secで90dB減衰 (ちょうどいい)
           this.peakHold[index] = currentPeak - 0.5;
      }
      // 'hold' modeの場合は減衰させない（維持）
  }

  processAnalyserData() {
    if (this.isPaused) return;
    
    // AnalyserNodeからデータを取得
    const freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqData);
    
    const timeData = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeData);
    
    // AGC用RMS計算（TimeDomainデータから）
    // AnalyserNodeのTimeDomainDataは 0-255 (128が中心)
    let sumSq = 0;
    for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128; // -1.0 ~ 1.0
        sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / timeData.length);
    this.updateAutoGain(rms);
    
    // 周波数データをdBに変換
    for (let i = 0; i < Math.min(freqData.length, this.binCount); i++) {
      const normalized = freqData[i] / 255;
      const db = normalized > 0 ? 20 * Math.log10(normalized) : -100;
      this.magnitudes[i] = Math.max(-100, Math.min(0, db));
      
      if (this.peakHoldMode !== 'off') {
          this.updatePeakHold(i, this.magnitudes[i]);
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
    } // wasmModuleがない場合でもJS側配列はリセットする（下へ続く）
    
    if (this.peakHold) {
      this.peakHold.fill(-100);
    }
  }

  setPeakHoldMode(mode) {
      this.peakHoldMode = mode;
      this.log(`Peak Hold: ${mode}`, 'info');
      
      if (mode === 'off') {
          this.setShowPeakHold(false);
      } else {
          this.setShowPeakHold(true);
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

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registred', reg))
      .catch(err => console.error('SW registration failed', err));
  }
  
  // AudioContext Auto Resume (Mobile Safari/Chrome fix)
  const resumeAudio = () => {
      const app = window.app;
      if (app && app.audioContext && app.audioContext.state === 'suspended') {
          app.audioContext.resume().then(() => {
              console.log('AudioContext resumed via user interaction');
          });
      }
  };
  
  document.addEventListener('click', resumeAudio);
  document.addEventListener('touchstart', resumeAudio);
  document.addEventListener('keydown', resumeAudio);
});
