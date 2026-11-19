import type { SoundCmd, SwfData } from './types';

const SAMPLE_RATE = 44100; // SOUNDINFO in/out points are in 44.1kHz samples

export class Sound {
  ctx: AudioContext;
  private buffers = new Map<number, AudioBuffer>();
  private playing = new Map<number, Set<AudioBufferSourceNode>>();
  private master: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async load(data: SwfData, base: string) {
    await Promise.all(Object.entries(data.chars).map(async ([id, c]) => {
      if (c.type !== 'sound') return;
      try {
        const buf = await (await fetch(base + c.src)).arrayBuffer();
        this.buffers.set(Number(id), await this.ctx.decodeAudioData(buf));
      } catch (e) {
        console.warn('sound load failed', c.src, e);
      }
    }));
  }

  set muted(v: boolean) { this.master.gain.value = v ? 0 : 1; }
  get muted() { return this.master.gain.value === 0; }

  play(cmd: SoundCmd) {
    const set = this.playing.get(cmd.id) ?? new Set();
    this.playing.set(cmd.id, set);
    if (cmd.stop) {
      for (const s of set) s.stop();
      set.clear();
      return;
    }
    if (cmd.noMulti && set.size) return;
    const buf = this.buffers.get(cmd.id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    const start = (cmd.inP ?? 0) / SAMPLE_RATE;
    const end = cmd.outP ? Math.min(cmd.outP / SAMPLE_RATE, buf.duration) : buf.duration;
    const seg = Math.max(0, end - start);
    const loops = cmd.loops ?? 1;
    if (loops > 1) {
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      src.start(0, start);
      src.stop(this.ctx.currentTime + seg * loops);
    } else {
      src.start(0, start, seg);
    }
    set.add(src);
    src.onended = () => set.delete(src);
  }

  stopAll() {
    for (const set of this.playing.values()) { for (const s of set) s.stop(); set.clear(); }
  }
}
