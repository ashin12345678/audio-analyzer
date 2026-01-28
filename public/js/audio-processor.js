/**
 * Audio Processor - AudioWorklet Processor
 * 音声データをメインスレッドに転送
 */

class AudioAnalyzerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        
        // メッセージ受信
        this.port.onmessage = (event) => {
            if (event.data.type === 'reset') {
                this.bufferIndex = 0;
            }
        };
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const channelData = input[0]; // モノラル入力
            
            // バッファに蓄積
            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bufferIndex] = channelData[i];
                this.bufferIndex++;
                
                // バッファが満杯になったらメインスレッドに送信
                if (this.bufferIndex >= this.bufferSize) {
                    this.port.postMessage({
                        type: 'audioData',
                        buffer: this.buffer.slice()
                    });
                    this.bufferIndex = 0;
                }
            }
        }
        
        return true; // 処理を継続
    }
}

registerProcessor('audio-analyzer-processor', AudioAnalyzerProcessor);
