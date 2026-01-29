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
    this.maxDB = 6; // +6dBまで表示可能
    this.minFreq = 20;
    this.maxFreq = 20000;

    // レイアウト
    // レイアウト
    this.paddingBottom = 100; // UIと被らないように余白を広げる

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
    
    // 背景をクリア（モード切り替え時の残像防止）
    this.ctx.fillStyle = "#0a0a0f";
    this.ctx.fillRect(0, 0, this.width, this.height);
    
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
    const plotHeight = this.height - this.paddingBottom;
    return plotHeight * (1 - Math.max(0, Math.min(1, normalized)));
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

    // ナイキスト周波数（これ以上の周波数にはデータがない）
    const nyquist = sampleRate / 2;
    const effectiveMaxFreq = Math.min(this.maxFreq, nyquist);
    
    // ポイント数を増やして高周波域の精度向上
    const pointCount = Math.min(binCount, 1024);
    const bottomY = this.height - this.paddingBottom;

    // 折れ線グラフ用のグラデーション塗りつぶし
    this.ctx.beginPath();
    this.ctx.moveTo(0, bottomY);

    let firstX = 0;
    let started = false;

    for (let i = 0; i < pointCount; i++) {
      const binIndex = Math.floor((i * binCount) / pointCount);
      const freq = this.binToFreq(binIndex, binCount, sampleRate);

      // ナイキスト周波数を超えるデータは存在しない
      if (freq < this.minFreq || freq > effectiveMaxFreq) continue;

      const x = this.freqToX(freq, binCount);
      const val = magnitudes[binIndex];
      const db = val !== undefined ? val : this.minDB;
      const y = this.dbToY(db);

      if (!started) {
        this.ctx.moveTo(x, bottomY);
        this.ctx.lineTo(x, y);
        firstX = x;
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }

    // 塗りつぶしを閉じる
    this.ctx.lineTo(this.width, bottomY);
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

      if (freq < this.minFreq || freq > effectiveMaxFreq) continue;

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

        if (freq < this.minFreq || freq > effectiveMaxFreq) continue;

        const x = this.freqToX(freq, binCount);
        const peakDb =
          peakHold[binIndex] !== undefined ? peakHold[binIndex] : this.minDB;
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

    const plotHeight = this.height - this.paddingBottom;
    const centerY = plotHeight / 2;
    const amplitude = plotHeight * 0.4;

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
    const height = Math.floor(this.height - this.paddingBottom);

    // 高速化: copyWithinを使ってメモリ内でシフト
    // 下から上へ、あるいは上から下へ。
    // ここでは新しいデータが y=0 (上) に書き込まれ、古いデータは下へ流れる (y+1) とする。

    // 全体を1行分下へコピー (0行目〜height-2行目 を 1行目〜height-1行目 へ)
    // copyWithin(target, start, end)
    // target: コピー先開始インデックス (1行目 = width * 4)
    // start: コピー元開始インデックス (0)
    // end: コピー元終了インデックス (全サイズ - 1行分)

    const rowSize = width * 4;
    const totalSize = this.spectrogramData.data.length;

    // Uint8ClampedArray.copyWithin は高速
    this.spectrogramData.data.copyWithin(rowSize, 0, totalSize - rowSize);

    // 新しい行を描画 (y=0)
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
      const val = magnitudes[Math.min(binIndex, binCount - 1)];
      const db = val !== undefined ? val : this.minDB;

      // dBを0-255にマップ
      const normalized = (db - this.minDB) / (this.maxDB - this.minDB);
      const colorIndex = Math.floor(
        Math.max(0, Math.min(255, normalized * 255)),
      );
      const [r, g, b] = this.spectrogramColors[colorIndex];

      const idx = x * 4;
      this.spectrogramData.data[idx] = r;
      this.spectrogramData.data[idx + 1] = g;
      this.spectrogramData.data[idx + 2] = b;
      this.spectrogramData.data[idx + 3] = 255;
    }

    // パディング領域のデータが流れ込まないように、データ末尾（パディング境界）をリセットする必要はあるが、
    // putImageDataの後にfillRectで上書きする方が効率的。
    // ImageDataの下部には古いスペクトログラムが残るが、表示上書きされるので問題ない。
    // パディング領域のクリアはImageData操作ではなくCanvas APIで行うためループ削除

    // 描画
    this.ctx.putImageData(this.spectrogramData, 0, 0);

    // パディング領域（下部UIエリア）を背景色で塗りつぶして隠す
    this.ctx.fillStyle = "#0a0a0f";
    this.ctx.fillRect(0, height, this.width, this.paddingBottom);
  }

  drawGrid() {
    const bottomY = this.height - this.paddingBottom;

    // 周波数グリッド
    let freqs;
    if (this.scale === "log") {
      freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    } else {
      freqs = [];
      for (let f = 0; f <= this.maxFreq; f += 2000) {
        if (f > 0) freqs.push(f);
      }
    }

    // グリッド線を先に描画
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    
    for (const freq of freqs) {
      if (freq < this.minFreq || freq > this.maxFreq) continue;
      const x = this.freqToX(freq, 1);
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, bottomY);
    }
    this.ctx.stroke();

    // 周波数ラベルを別途描画
    this.ctx.textAlign = "center";
    let lastX = -100;
    
    for (const freq of freqs) {
      if (freq < this.minFreq || freq > this.maxFreq) continue;
      const x = this.freqToX(freq, 1);
      
      // 主要周波数は優先表示
      const isMajor = freq === 100 || freq === 1000 || freq === 10000;

      if (x - lastX > 30 || isMajor) {
        let label;
        if (freq >= 1000) {
          label = freq / 1000 + "k";
        } else {
          label = String(freq);
        }

        if (isMajor) {
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          this.ctx.font = "bold 13px 'Inter', sans-serif";
        } else {
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          this.ctx.font = "12px 'Inter', sans-serif";
        }

        this.ctx.fillText(label, x, bottomY + 20);
        lastX = x;
      }
    }

    // 軸名表示（横軸中央に「Frequency (Hz)」を表示）
    this.ctx.textAlign = "center";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    this.ctx.font = "bold 14px 'Inter', sans-serif";
    this.ctx.fillText("Frequency (Hz)", this.width / 2, bottomY + 45);

    // dBグリッド（バーモードのみ）
    if (this.mode === "bar") {
      const dbs = [0, -20, -40, -60, -80];

      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      this.ctx.beginPath();
      for (const db of dbs) {
        if (db < this.minDB || db > this.maxDB) continue;
        const y = this.dbToY(db);
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.width, y);
      }
      this.ctx.stroke();
      
      // 0dBライン（クリップ警告）を強調
      const zeroY = this.dbToY(0);
      this.ctx.strokeStyle = "rgba(255, 100, 100, 0.5)";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(0, zeroY);
      this.ctx.lineTo(this.width, zeroY);
      this.ctx.stroke();
      this.ctx.lineWidth = 1;
      
      // dBラベル
      this.ctx.textAlign = "left";
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      this.ctx.font = "12px 'Inter', sans-serif";
      for (const db of dbs) {
        if (db < this.minDB || db > this.maxDB) continue;
        const y = this.dbToY(db);
        // 0dBは赤色で表示
        if (db === 0) {
          this.ctx.fillStyle = "rgba(255, 100, 100, 0.9)";
          this.ctx.fillText("0 dB (CLIP)", 10, y - 5);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        } else {
          this.ctx.fillText(`${db} dB`, 10, y - 5);
        }
      }
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
    const val = magnitudes[Math.min(binIndex, binCount - 1)];
    const db = val !== undefined ? val : this.minDB;

    return { frequency: freq, db: db };
  }

  getFps() {
    return this.fps;
  }
}
