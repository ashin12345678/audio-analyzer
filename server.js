/**
 * Development Server
 * SharedArrayBuffer対応のHTTPSサーバー
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.argv.includes('--https');

// MIMEタイプマッピング
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// リクエストハンドラー
function handleRequest(req, res) {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // 404
                res.writeHead(404);
                res.end('File Not Found');
            } else {
                // 500
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }
        
        // SharedArrayBuffer有効化のためのヘッダー
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        // キャッシュ無効化（開発用）
        res.setHeader('Cache-Control', 'no-store');
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

// サーバー作成
let server;

if (USE_HTTPS) {
    // 自己署名証明書が必要
    const options = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
    };
    server = https.createServer(options, handleRequest);
} else {
    server = http.createServer(handleRequest);
}

server.listen(PORT, () => {
    const protocol = USE_HTTPS ? 'https' : 'http';
    console.log(`
╔════════════════════════════════════════════════════════╗
║     Audio Analyzer Development Server                  ║
╠════════════════════════════════════════════════════════╣
║  Local:    ${protocol}://localhost:${PORT}                       ║
║                                                        ║
║  Headers:                                              ║
║    Cross-Origin-Opener-Policy: same-origin             ║
║    Cross-Origin-Embedder-Policy: require-corp          ║
║                                                        ║
║  Press Ctrl+C to stop                                  ║
╚════════════════════════════════════════════════════════╝
`);
});
