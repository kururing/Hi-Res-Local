export const PCM_RING_WORKLET_NAME = 'nnpm-pcm-ring';

export const PCM_RING_WORKLET_SOURCE = `
class PcmRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.channels = 2;
    this.port.onmessage = (event) => {
      if (event.data.type === 'pcm') {
        this.channels = event.data.channels || 2;
        this.queue.push(event.data.frames);
      }
      if (event.data.type === 'flush') {
        this.queue = [];
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const framesNeeded = output[0].length;
    for (let i = 0; i < framesNeeded; i += 1) {
      if (this.queue.length === 0) {
        for (let c = 0; c < output.length; c += 1) output[c][i] = 0;
        continue;
      }
      const current = this.queue[0];
      for (let c = 0; c < output.length; c += 1) {
        output[c][i] = current[this.offset * this.channels + c] || 0;
      }
      this.offset += 1;
      if (this.offset * this.channels >= current.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('${PCM_RING_WORKLET_NAME}', PcmRingProcessor);
`;
