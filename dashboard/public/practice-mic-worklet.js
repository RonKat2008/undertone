/**
 * Spoken practice: microphone capture on the audio thread. Collects about 20 ms of mono float
 * samples at the context's own rate and posts each block to the page, which resamples it to
 * 16 kHz linear16 (lib/practice/audio.ts) and sends it to the backend. It outputs silence.
 */
class PracticeMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global in the AudioWorkletGlobalScope.
    this.size = Math.max(128, Math.round(sampleRate * 0.02));
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let read = 0;
    while (read < channel.length) {
      const take = Math.min(channel.length - read, this.size - this.filled);
      this.buffer.set(channel.subarray(read, read + take), this.filled);
      this.filled += take;
      read += take;
      if (this.filled === this.size) {
        const block = this.buffer;
        this.port.postMessage(block, [block.buffer]);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('practice-mic', PracticeMicProcessor);
