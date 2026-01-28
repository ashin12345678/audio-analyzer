/**
 * Visualizer - Canvas描画エンジン
 * バー、波形、スペクトログラムの3モード対応
 */

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.mode = "bar"; // bar, wave, spectrogram
    this.scale = "log"; // log, linear
    this.isPaused = false;
    this.showPeakHold = true;

    // 描画設定
    this.minDB = -100;
    this.maxDB = 0;
    this.minFreq = 20;
    this.maxFreq = 20000;

    // スペクトログラム設定
    this.spectrogramData = null;
    this.spectrogramLine = 0;
    this.spectrogramZoom = 1;

    // カラー設定
    this.barGradient = null;
    this.spectrogramColors = [];

    // FPS計算
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.fps = 0;

    // 初期化
    this.setupColors();
    this.resize();

    // リサイズ監視
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);

    this.width = rect.width;
    this.height = rect.height;

    // グラデーション再作成
    this.createGradients();

    // スペクトログラムデータ再作成
    this.initSpectrogramData();
  }

  setupColors() {
    // スペクトログラム用カラーマップ（256色）
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r, g, b;

      if (t < 0.2) {
        // 暗い青
        const p = t / 0.2;
        r = 0;
        g = 0;
        b = Math.floor(50 + 100 * p);
      } else if (t < 0.4) {
        // 青からシアン
        const p = (t - 0.2) / 0.2;
        r = 0;
        g = Math.floor(200 * p);
        b = Math.floor(150 + 105 * (1 - p));
      } else if (t < 0.6) {
        // シアンから緑
        const p = (t - 0.4) / 0.2;
        r = Math.floor(50 * p);
        g = Math.floor(200 + 55 * p);
        b = Math.floor(150 * (1 - p));
      } else if (t < 0.8) {
        // 緑から黄
        const p = (t - 0.6) / 0.2;
        r = Math.floor(50 + 205 * p);
        g = 255;
        b = 0;
      } else {
        // 黄から赤、白へ
        const p = (t - 0.8) / 0.2;
        r = 255;
        g = Math.floor(255 * (1 - p * 0.7));
        b = Math.floor(200 * p);
      }

      this.spectrogramColors.push([r, g, b]);
    }
  }

  createGradients() {
    // バー用グラデーション
    this.barGradient = this.ctx.createLinearGradient(0, this.height, 0, 0);
    this.barGradient.addColorStop(0, "#003366");
    this.barGradient.addColorStop(0.3, "#0066ff");
    this.barGradient.addColorStop(0.5, "#00ddff");
    this.barGradient.addColorStop(0.7, "#00ff88");
    this.barGradient.addColorStop(0.85, "#ffff00");
    this.barGradient.addColorStop(1, "#ff0044");
  }

  initSpectrogramData() {
    // スペクトログラム用ImageData
    const height = Math.floor(this.height);
    const width = Math.floor(this.width);
    this.spectrogramData = this.ctx.createImageData(width, height);
    this.spectrogramLine = 0;

    // 黒で初期化
    for (let i = 0; i < this.spectrogramData.data.length; i += 4) {
      this.spectrogramData.data[i] = 10;
      this.spectrogramData.data[i + 1] = 10;
      this.spectrogramData.data[i + 2] = 15;
      this.spectrogramData.data[i + 3] = 255;
    }
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "spectrogram") {
      this.initSpectrogramData();
    }
  }

  setScale(scale) {
    this.scale = scale;
  }

  setPaused(paused) {
    this.isPaused = paused;
  }

  setShowPeakHold(show) {
    this.showPeakHold = show;
  }

  setZoom(zoom) {
    this.spectrogramZoom = Math.max(0.5, Math.min(4, zoom));
  }

  // dBを画面Y座標に変換
  dbToY(db) {
    const normalized = (db - this.minDB) / (this.maxDB - this.minDB);
    return this.height * (1 - Math.max(0, Math.min(1, normalized)));
  }

  // 周波数を画面X座標に変換
  freqToX(freq, binCount) {
    if (this.scale === "log") {
      const logMin = Math.log10(this.minFreq);
      const logMax = Math.log10(this.maxFreq);
      const logFreq = Math.log10(Math.max(this.minFreq, freq));
      return (this.width * (logFreq - logMin)) / (logMax - logMin);
    } else {
      return (this.width * freq) / this.maxFreq;
    }
  }

  // ビンインデックスから周波数を取得
  binToFreq(bin, binCount, sampleRate) {
    return (bin * sampleRate) / (binCount * 2);
  }

  // 描画メイン
  draw(magnitudes, peakHold, timeDomain, binCount, sampleRate) {
    if (this.isPaused) return;

    // FPS計算
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    // 描画モードに応じて実行
    switch (this.mode) {
      case "bar":
        this.drawBars(magnitudes, peakHold, binCount, sampleRate);
        break;
      case "wave":
        this.drawWaveform(timeDomain);
        break;
      case "spectrogram":
        this.drawSpectrogram(magnitudes, binCount, sampleRate);
        break;
    }

    // グリッド描画
    this.drawGrid();
  }

  drawBars(magnitudes, peakHold, binCount, sampleRate) {
    // 背景クリア
    this.ctx.fillStyle = "#0a0a0f";
    this.ctx.fillRect(0, 0, this.width, this.height);

    const pointCount = Math.min(binCount, 512);
    
    // 折れ線グラフ用のグラデーション塗りつぶし
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.height);
    
    let firstX = 0;
    let started = false;
    
    for (let i = 0; i < pointCount; i++) {
      const binIndex = Math.floor((i * binCount) / pointCount);
      const freq = this.binToFreq(binIndex, binCount, sampleRate);

      if (freq < this.minFreq || freq > this.maxFreq) continue;

      const x = this.freqToX(freq, binCount);
      const db = magnitudes[binIndex] || this.minDB;
      const y = this.dbToY(db);

      if (!started) {
        this.ctx.moveTo(x, this.height);
        this.ctx.lineTo(x, y);
        firstX = x;
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    
    // 塗りつぶしを閉じる
    this.ctx.lineTo(this.width, this.height);
    this.ctx.closePath();
    this.ctx.fillStyle = this.barGradient;
    this.ctx.globalAlpha = 0.3;
    this.ctx.fill();
    this.ctx.globalAlpha = 1.0;
    
    // メインの折れ線を描画
    this.ctx.beginPath();
    started = false;
    
    for (let i = 0; i < pointCount; i++) {
      const binIndex = Math.floor((i * binCount) / pointCount);
      const freq = this.binToFreq(binIndex, binCount, sampleRate);

      if (freq < this.minFreq || freq > this.maxFreq) continue;

      const x = this.freqToX(freq, binCount);
      const db = magnitudes[binIndex] || this.minDB;
      const y = this.dbToY(db);

      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    
    this.ctx.strokeStyle = "#00d4ff";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // ピークホールド描画
    if (this.showPeakHold && peakHold) {
      this.ctx.strokeStyle = "#ff0066";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      started = false;

      for (let i = 0; i < pointCount; i++) {
        const binIndex = Math.floor((i * binCount) / pointCount);
        const freq = this.binToFreq(binIndex, binCount, sampleRate);

        if (freq < this.minFreq || freq > this.maxFreq) continue;

        const x = this.freqToX(freq, binCount);
        const peakDb = peakHold[binIndex] || this.minDB;
        const y = this.dbToY(peakDb);

        if (!started) {
          this.ctx.moveTo(x, y);
          started = true;
        } else {
          this.ctx.lineTo(x, y);
        }
      }

      this.ctx.stroke();
    }
  }

  drawWaveform(timeDomain) {
    // 背景クリア
    this.ctx.fillStyle = "#0a0a0f";
    this.ctx.fillRect(0, 0, this.width, this.height);

    if (!timeDomain || timeDomain.length === 0) return;

    const centerY = this.height / 2;
    const amplitude = this.height * 0.4;

    // 波形描画
    this.ctx.strokeStyle = "#00d4ff";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    const step = timeDomain.length / this.width;

    for (let i = 0; i < this.width; i++) {
      const index = Math.floor(i * step);
      const value = timeDomain[index] || 0;
      const y = centerY - value * amplitude;

      if (i === 0) {
        this.ctx.moveTo(i, y);
      } else {
        this.ctx.lineTo(i, y);
      }
    }

    this.ctx.stroke();

    // 中心線
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);
    this.ctx.lineTo(this.width, centerY);
    this.ctx.stroke();
  }

  drawSpectrogram(magnitudes, binCount, sampleRate) {
    if (!this.spectrogramData) return;

    const width = Math.floor(this.width);
    const height = Math.floor(this.height);

    // 既存データを1行下にシフト
    for (let y = height - 1; y > 0; y--) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((y - 1) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        this.spectrogramData.data[dstIdx] = this.spectrogramData.data[srcIdx];
        this.spectrogramData.data[dstIdx + 1] = this.spectrogramData.data[srcIdx + 1];
        this.spectrogramData.data[dstIdx + 2] = this.spectrogramData.data[srcIdx + 2];
      }
    }

    // 新しい行を描画
    for (let x = 0; x < width; x++) {
      let freq;
      if (this.scale === "log") {
        const logMin = Math.log10(this.minFreq);
        const logMax = Math.log10(this.maxFreq);
        const logFreq = logMin + (logMax - logMin) * (x / width);
        freq = Math.pow(10, logFreq);
      } else {
        freq = this.minFreq + (this.maxFreq - this.minFreq) * (x / width);
      }

      const binIndex = Math.floor((freq * binCount * 2) / sampleRate);
      const db = magnitudes[Math.min(binIndex, binCount - 1)] || this.minDB;

      // dBを0-255にマップ
      const normalized = (db - this.minDB) / (this.maxDB - this.minDB);
      const colorIndex = Math.floor(Math.max(0, Math.min(255, normalized * 255)));
      const [r, g, b] = this.spectrogramColors[colorIndex];

      const idx = x * 4;
      this.spectrogramData.data[idx] = r;
      this.spectrogramData.data[idx + 1] = g;
      this.spectrogramData.data[idx + 2] = b;
      this.spectrogramData.data[idx + 3] = 255;
    }

    // 描画
    this.ctx.putImageData(this.spectrogramData, 0, 0);
  }

  drawGrid() {
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    this.ctx.font = "12px 'Inter', sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.lineWidth = 1;

    // 周波数グリッド
    let freqs;
    if (this.scale === 'log') {
       freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    } else {
       freqs = [];
       for(let f=0; f<=this.maxFreq; f+=Math.floor(this.maxFreq/5)) {
         if(f>0) freqs.push(f);
       }
    }

    this.ctx.beginPath();
    for (const freq of freqs) {
      if (freq < this.minFreq || freq > this.maxFreq) continue;

      const x = this.freqToX(freq, 1);

      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height - 25);
      
      // 横軸ラベル（下部に表示）
      let label;
      if (freq >= 1000) {
        label = (freq / 1000) + "k";
      } else {
        label = freq;
      }
      this.ctx.fillText(label, x, this.height - 8);
    }
    this.ctx.stroke();

    // 軸名表示
    this.ctx.textAlign = "right";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    this.ctx.fillText("Hz", this.width - 5, this.height - 8);
    this.ctx.textAlign = "left";

    // dBグリッド（バーモードのみ）
    if (this.mode === "bar") {
      const dbs = [-20, -40, -60, -80];
      
      this.ctx.beginPath();
      for (const db of dbs) {
        if (db < this.minDB) continue;
        const y = this.dbToY(db);

        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.width, y);
        
        this.ctx.fillText(`${db}`, 5, y - 3);
      }
      this.ctx.stroke();
    }
  }

  // スポット解析用：座標から周波数とdBを取得
  getDataAtPosition(x, y, magnitudes, binCount, sampleRate) {
    let freq;

    if (this.scale === "log") {
      const logMin = Math.log10(this.minFreq);
      const logMax = Math.log10(this.maxFreq);
      const logFreq = logMin + (logMax - logMin) * (x / this.width);
      freq = Math.pow(10, logFreq);
    } else {
      freq = this.minFreq + (this.maxFreq - this.minFreq) * (x / this.width);
    }

    const binIndex = Math.floor((freq * binCount * 2) / sampleRate);
    const db = magnitudes[Math.min(binIndex, binCount - 1)] || this.minDB;

    return { frequency: freq, db: db };
  }

  getFps() {
    return this.fps;
  }
}
