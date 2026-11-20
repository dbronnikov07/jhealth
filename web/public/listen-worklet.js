// Microphone capture on the audio thread. The page's main thread is busy tracking the body 15 times a second; the
// old capture ran there and dropped pieces of speech whenever a video frame took too long, so Whisper got words
// with holes in them. This runs on the audio thread and hands every sample to the page, in order, none lost.
class MotivaCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1280);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf);
        this.buf = new Float32Array(1280);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("motiva-capture", MotivaCapture);
