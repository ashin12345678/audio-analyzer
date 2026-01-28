/**
 * UI Controller - ユーザーインタラクション管理
 * タッチ、マウス、キーボードイベント処理
 */

export class UIController {
    constructor(app) {
        this.app = app;
        this.canvas = document.getElementById('visualizer');
        this.overlay = document.getElementById('overlay');
        
        // タッチ状態
        this.touchStartDistance = 0;
        this.currentZoom = 1;
        
        // スポット解析の位置を保持
        this.spotX = null;
        this.spotY = null;
        this.spotActive = false;
        
        // イベントリスナー設定
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // スタート/ポーズボタン
        document.getElementById('startBtn').addEventListener('click', () => {
            this.app.start();
        });
        
        document.getElementById('pauseBtn').addEventListener('click', () => {
            this.app.togglePause();
        });
        
        // モード切替
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.app.setMode(e.target.dataset.mode);
            });
        });
        
        // スケール切替
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.app.setScale(e.target.dataset.scale);
            });
        });
        
        // ゲインスライダー
        const gainSlider = document.getElementById('gainSlider');
        const gainValue = document.getElementById('gainValue');
        gainSlider.addEventListener('input', (e) => {
            const gain = parseFloat(e.target.value);
            this.app.setGain(gain);
            // 倍率をdBに変換して表示
            const gainDb = 20 * Math.log10(gain);
            const sign = gainDb >= 0 ? '+' : '';
            gainValue.textContent = `${sign}${gainDb.toFixed(1)}dB`;
        });
        
        // ピークホールドトグル
        document.getElementById('peakHoldToggle').addEventListener('change', (e) => {
            this.app.setShowPeakHold(e.target.checked);
        });
        
        // ピークリセット
        document.getElementById('resetPeakBtn').addEventListener('click', () => {
            this.app.resetPeakHold();
        });
        
        // キャンバスクリック（スポット解析）
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('touchend', (e) => this.handleCanvasTouchEnd(e));
        
        // ピンチズーム
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        
        // マウスホイールズーム
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        
        // ダブルクリック/タップで一時停止
        this.canvas.addEventListener('dblclick', () => this.app.togglePause());
    }
    
    handleCanvasClick(e) {
        if (e.detail === 2) return; // ダブルクリックは無視
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.showSpotAnalysis(x, y);
    }
    
    handleCanvasTouchEnd(e) {
        if (e.touches.length === 0 && e.changedTouches.length === 1) {
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.changedTouches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            
            this.showSpotAnalysis(x, y);
        }
    }
    
    showSpotAnalysis(x, y) {
        // 位置を保存してリアルタイム更新を有効化
        this.spotX = x;
        this.spotY = y;
        this.spotActive = true;
        
        // オーバーレイを画面上部中央に固定表示
        this.overlay.style.left = '50%';
        this.overlay.style.top = '10px';
        this.overlay.style.transform = 'translateX(-50%)';
        this.overlay.classList.remove('hidden');
        
        // 初回表示を即座に更新
        this.updateSpotAnalysis();
    }
    
    // リアルタイム更新用メソッド（アニメーションループから呼び出される）
    updateSpotAnalysis() {
        if (!this.spotActive || this.spotX === null) return;
        
        const data = this.app.getDataAtPosition(this.spotX, this.spotY);
        
        if (data) {
            const freqText = data.frequency >= 1000 
                ? `${(data.frequency / 1000).toFixed(2)} kHz`
                : `${data.frequency.toFixed(1)} Hz`;
            
            this.overlay.querySelector('.frequency').textContent = freqText;
            this.overlay.querySelector('.level').textContent = `${data.db.toFixed(1)} dB`;
        }
    }
    
    // スポット解析を非表示
    hideSpotAnalysis() {
        this.spotActive = false;
        this.spotX = null;
        this.spotY = null;
        this.overlay.classList.add('hidden');
    }
    
    handleTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchStartDistance = Math.sqrt(dx * dx + dy * dy);
        }
    }
    
    handleTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (this.touchStartDistance > 0) {
                const scale = distance / this.touchStartDistance;
                this.currentZoom *= scale;
                this.app.setZoom(this.currentZoom);
                this.touchStartDistance = distance;
            }
        }
    }
    
    handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.currentZoom *= delta;
        this.app.setZoom(this.currentZoom);
    }
    
    updateStatus(sampleRate, fftSize, fps) {
        document.getElementById('sampleRate').textContent = `${sampleRate} Hz`;
        document.getElementById('fftSize').textContent = `FFT: ${fftSize}`;
        document.getElementById('fps').textContent = `${fps} FPS`;
    }
    
    showStartButton() {
        document.getElementById('startBtn').classList.remove('hidden');
        document.getElementById('pauseBtn').classList.add('hidden');
    }
    
    showPauseButton() {
        document.getElementById('startBtn').classList.add('hidden');
        document.getElementById('pauseBtn').classList.remove('hidden');
    }
    
    setPauseButtonState(isPaused) {
        const btn = document.getElementById('pauseBtn');
        if (isPaused) {
            btn.querySelector('.icon').textContent = '▶';
            btn.querySelector('.label').textContent = 'RESUME';
        } else {
            btn.querySelector('.icon').textContent = '⏸';
            btn.querySelector('.label').textContent = 'PAUSE';
        }
    }
    
    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }
    
    showLoading(message) {
        const loading = document.getElementById('loading');
        loading.querySelector('p').textContent = message;
        loading.classList.remove('hidden');
    }
}
