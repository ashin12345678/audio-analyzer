# Audio Analyzer - 高性能リアルタイム音声解析

C++/WebAssemblyベースの高性能リアルタイム音声スペクトラムアナライザー

## 機能

- FFT解析（2048サンプル、48kHz）
- 3つの表示モード（バー/波形/スペクトログラム）
- 対数/線形スケール切替
- ピークホールド機能
- リアルタイムスポット解析
- モバイル対応（横画面）

## ローカル開発

```bash
# サーバー起動
node server.js

# ブラウザでアクセス
# http://localhost:3000
```

## デプロイ

### Vercel

```bash
npx vercel
```

### Netlify

```bash
npx netlify deploy --prod
```

## 技術スタック

- C++ / WebAssembly (Emscripten)
- Web Audio API (AudioWorklet)
- Canvas API
- Vanilla JavaScript

## ライセンス

MIT
