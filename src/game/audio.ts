/* Procedural WebAudio sound effects with an MP3 soundtrack. */

export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  music: GainNode | null = null;
  noiseBuf: AudioBuffer | null = null;
  musicOn = false;
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private lastPlay = new Map<string, number>();
  private disposed = false;
  private delayed = new Set<ReturnType<typeof setTimeout>>();

  ensure() {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.28;
    this.music.connect(this.master);
    this.musicElement = new Audio("/singularity.mp3");
    this.musicElement.loop = true;
    this.musicElement.preload = "auto";
    this.musicSource = this.ctx.createMediaElementSource(this.musicElement);
    this.musicSource.connect(this.music);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? -1e9;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; attack?: number; dest?: AudioNode } = {}) {
    if (this.disposed || !this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.2, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, opts: { vol?: number; lp?: number; hp?: number; slideLp?: number } = {}) {
    if (this.disposed || !this.ctx || !this.sfx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(opts.lp ?? 1200, t);
    if (opts.slideLp) lp.frequency.exponentialRampToValueAtTime(opts.slideLp, t + dur);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = opts.hp ?? 80;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(hp).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  step() {
    if (!this.throttle("step", 90)) return;
    this.noise(0.09, { vol: 0.12, lp: 900, hp: 120 });
    this.tone(90 + Math.random() * 30, 0.08, { type: "sine", vol: 0.12, slide: 0.5 });
  }
  thud(intensity = 1) {
    if (!this.throttle("thud", 70)) return;
    const v = Math.min(1, intensity);
    this.noise(0.18, { vol: 0.25 * v, lp: 500, hp: 40 });
    this.tone(70, 0.22, { type: "sine", vol: 0.35 * v, slide: 0.4 });
  }
  grab() {
    this.tone(320, 0.08, { type: "square", vol: 0.06, slide: 1.4 });
    this.noise(0.05, { vol: 0.06, lp: 2500 });
  }
  release() {
    this.tone(360, 0.08, { type: "square", vol: 0.05, slide: 0.7 });
  }
  whoosh() {
    this.noise(0.3, { vol: 0.25, lp: 400, slideLp: 3500, hp: 200 });
  }
  jump() {
    this.tone(220, 0.25, { type: "triangle", vol: 0.15, slide: 2.2 });
    this.noise(0.12, { vol: 0.1, lp: 1500 });
  }
  kick() {
    this.noise(0.12, { vol: 0.18, lp: 700, slideLp: 200 });
  }
  fall() {
    this.tone(300, 0.5, { type: "sawtooth", vol: 0.08, slide: 0.25 });
    this.noise(0.3, { vol: 0.2, lp: 600 });
  }
  getup() {
    this.tone(200, 0.25, { type: "triangle", vol: 0.1, slide: 1.8 });
  }
  shout() {
    const f = 300 + Math.random() * 200;
    this.tone(f, 0.18, { type: "sawtooth", vol: 0.08, slide: 1.3 });
    this.tone(f * 1.5, 0.22, { type: "square", vol: 0.04, slide: 0.8 });
  }
  splash() {
    this.noise(0.6, { vol: 0.35, lp: 1800, slideLp: 300, hp: 100 });
    this.tone(180, 0.4, { type: "sine", vol: 0.15, slide: 0.3 });
  }
  crack() {
    this.noise(0.25, { vol: 0.35, lp: 4000, slideLp: 800, hp: 400 });
    this.tone(900, 0.1, { type: "square", vol: 0.08, slide: 0.3 });
  }
  checkpoint() {
    this.tone(660, 0.12, { type: "triangle", vol: 0.15 });
    this.later(() => this.tone(880, 0.2, { type: "triangle", vol: 0.15 }), 90);
  }
  score() {
    [523, 659, 784, 1046].forEach((f, i) => this.later(() => this.tone(f, 0.18, { type: "triangle", vol: 0.14 }), i * 70));
  }
  beep(final = false) {
    this.tone(final ? 880 : 440, final ? 0.5 : 0.15, { type: "square", vol: 0.12 });
  }
  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((f, i) => this.later(() => this.tone(f, i === notes.length - 1 ? 0.7 : 0.18, { type: "square", vol: 0.1 }), i * 110));
    this.later(() => this.noise(1.6, { vol: 0.15, lp: 3000, hp: 800 }), 300);
  }
  climb() {
    this.noise(0.1, { vol: 0.1, lp: 1500, hp: 300 });
  }

  // ---- soundtrack ----
  startMusic() {
    if (this.disposed || !this.ctx || !this.musicElement || this.musicOn) return;
    this.musicOn = true;
    void this.musicElement.play().catch(() => {
      this.musicOn = false;
    });
  }
  stopMusic() {
    this.musicOn = false;
    this.musicElement?.pause();
  }

  private later(callback: () => void, delayMs: number) {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.delayed.delete(timer);
      if (!this.disposed) callback();
    }, delayMs);
    this.delayed.add(timer);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusic();
    for (const timer of this.delayed) clearTimeout(timer);
    this.delayed.clear();
    this.musicElement?.pause();
    this.musicSource?.disconnect();
    this.sfx?.disconnect();
    this.music?.disconnect();
    this.master?.disconnect();
    const context = this.ctx;
    this.ctx = null;
    this.sfx = null;
    this.music = null;
    this.musicElement = null;
    this.musicSource = null;
    this.master = null;
    this.noiseBuf = null;
    this.lastPlay.clear();
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}
