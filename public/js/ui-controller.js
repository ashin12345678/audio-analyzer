/**
 * UI Controller - ユーザーインタラクション管理
 * タッチ、マウス、キーボードイベント処理
 */

export class UIController {
    constructor(app) {
        this.app = app;
        this.canvas = document.getElementById('visualizer');
        this.infoPanel = document.getElementById('infoPanel');
        this.infoFreq = document.getElementById('infoFreq');
        this.infoDb = document.getElementById('infoDb');
        
        // AGC状態
        this.agcEnabled = false;

        // タッチ状態
        this.touchStartDistance = 0;
        this.currentZoom = 1;
        
        // スポット解析の位置
        this.spotX = null;
        this.spotY = null;
        this.spotActive = false;
        this.isDragging = false;
        
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
        
        // 全画面ボタン
        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            this.toggleFullscreen();
        });
        
        // 折りたたみトグル
        document.getElementById('toggleControlsBtn').addEventListener('click', () => {
            this.toggleControls();
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
        
        // --- Gain Control (New Input + Buttons) ---
        const gainInput = document.getElementById('gainInput');
        const gainUpBtn = document.getElementById('gainUpBtn');
        const gainDownBtn = document.getElementById('gainDownBtn');
        const agcBtn = document.getElementById('agcBtn');

        // Input Change
        gainInput.addEventListener('change', (e) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0.0;
            // 数値からゲイン倍率へ変換: 10^(dB/20)
            const gain = Math.pow(10, val / 20);
            this.app.setGain(gain);
        });

        // Up Button
        gainUpBtn.addEventListener('click', () => {
            let currentDb = parseFloat(gainInput.value) || 0;
            const newDb = currentDb + 1.0;
            gainInput.value = newDb.toFixed(1);
            const gain = Math.pow(10, newDb / 20);
            this.app.setGain(gain);
        });

        // Down Button
        gainDownBtn.addEventListener('click', () => {
            let currentDb = parseFloat(gainInput.value) || 0;
            const newDb = currentDb - 1.0;
            gainInput.value = newDb.toFixed(1);
            const gain = Math.pow(10, newDb / 20);
            this.app.setGain(gain);
        });

        // AGC Toggle
        agcBtn.addEventListener('click', () => {
            this.agcEnabled = !this.agcEnabled;
            agcBtn.dataset.active = this.agcEnabled;
            agcBtn.textContent = `AGC: ${this.agcEnabled ? 'ON' : 'OFF'}`;
            this.app.setAgcEnabled(this.agcEnabled);
        });
        
        // ピークホールドトグル
        document.getElementById('peakHoldToggle').addEventListener('change', (e) => {
            this.app.setShowPeakHold(e.target.checked);
        });
        
        // ピークリセット
        document.getElementById('resetPeakBtn').addEventListener('click', () => {
            this.app.resetPeakHold();
        });
        
        // --- Canvas Interaction (Touch & Drag) ---
        // マウス
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.handleInputMove(e.clientX, e.clientY);
        });
        
        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.handleInputMove(e.clientX, e.clientY);
            }
        });
        
        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.hideSpotAnalysis();
        });

        // タッチ (スライド追従)
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                const t = e.touches[0];
                this.handleInputMove(t.clientX, t.clientY);
            } else {
                this.handleTouchStart(e); // ピンチズームなど
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (this.isDragging && e.touches.length === 1) {
                e.preventDefault(); // スクロール防止
                const t = e.touches[0];
                this.handleInputMove(t.clientX, t.clientY);
            } else {
                this.handleTouchMove(e);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                this.isDragging = false;
                this.hideSpotAnalysis();
            }
        });
        
        // マウスホイールズーム
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        
        // ダブルクリック/タップで一時停止
        this.canvas.addEventListener('dblclick', () => this.app.togglePause());
        
        // 全画面変更イベント
        document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());
        document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenButton());
    }

    // 共通入力ハンドラ (Mouse/Touch)
    handleInputMove(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // 範囲内チェック
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
            this.showSpotAnalysis(x, y);
        } else {
            this.hideSpotAnalysis();
        }
    }
    
    toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            // 全画面にする
            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            }
        } else {
            // 全画面を解除
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }
    
    updateFullscreenButton() {
        const btn = document.getElementById('fullscreenBtn');
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        if (isFullscreen) {
            btn.querySelector('.icon').textContent = '⛶';
            btn.querySelector('.label').textContent = 'EXIT';
        } else {
            btn.querySelector('.icon').textContent = '⛶';
            btn.querySelector('.label').textContent = 'FULL';
        }
    }
    
    toggleControls() {
        const controls = document.getElementById('controls');
        controls.classList.toggle('collapsed');
    }
    
    showSpotAnalysis(x, y) {
        // 位置を保存してリアルタイム更新を有効化
        this.spotX = x;
        this.spotY = y;
        this.spotActive = true;
        
        this.infoPanel.classList.remove('hidden');
        
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
                : `${data.frequency.toFixed(0)} Hz`; // 整数Hzで見やすく
            
            this.infoFreq.textContent = freqText;
            this.infoDb.textContent = `${data.db.toFixed(1)} dB`;
        }
    }
    
    // スポット解析を非表示
    hideSpotAnalysis() {
        this.spotActive = false;
        this.spotX = null;
        this.spotY = null;
        this.infoPanel.classList.add('hidden');
    }

    // Gain表示の更新（外部から呼ばれる場合やAGCによる自動更新反映用）
    updateGainDisplay(gain) {
        const input = document.getElementById('gainInput');
        // Gain倍率 -> dB
        const db = 20 * Math.log10(gain);
        // 入力中じゃなければ更新
        if (document.activeElement !== input) {
            input.value = db.toFixed(1);
        }
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
