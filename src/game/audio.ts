/* Procedural WebAudio sound effects with an MP3 soundtrack. */

/**
 * Sound hierarchy (quietest to loudest): steps < grabs/releases < landings
 * and bumps < falls/splashes < checkpoints < baskets/deliveries < finish.
 * Every effect is throttled so a pile-up of physics events never turns into
 * noise, and everything routes through one master gain (mute = gain 0).
 */

export type AmbienceKind = "none" | "breeze" | "wind" | "harbor" | "arena";

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
  private stepFoot = 0;
  private muted = false;
  private ambienceKind: AmbienceKind = "none";
  private ambienceNodes: AudioNode[] = [];
  private ambienceSources: AudioScheduledSourceNode[] = [];
  private surface: "soft" | "snow" | "wood" | "hard" = "soft";

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
    this.master.gain.value = this.muted ? 0 : 0.8;
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
    if (this.ambienceKind !== "none") this.startAmbience();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  /** Footstep timbre for the current course surface. */
  setSurface(surface: "soft" | "snow" | "wood" | "hard") {
    this.surface = surface;
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? -1e9;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; attack?: number; dest?: AudioNode; delay?: number; lp?: number } = {}) {
    if (this.disposed || !this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.2, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.lp) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = opts.lp;
      node.connect(lp);
      node = lp;
    }
    node.connect(g).connect(opts.dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, opts: { vol?: number; lp?: number; hp?: number; slideLp?: number; delay?: number; rate?: number; attack?: number; bp?: number; q?: number } = {}) {
    if (this.disposed || !this.ctx || !this.sfx || !this.noiseBuf) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = opts.rate ?? 0.8 + Math.random() * 0.4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = opts.bp ? "bandpass" : "lowpass";
    lp.frequency.setValueAtTime(opts.bp ?? opts.lp ?? 1200, t);
    if (opts.q) lp.Q.value = opts.q;
    if (opts.slideLp) lp.frequency.exponentialRampToValueAtTime(opts.slideLp, t + dur);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = opts.hp ?? 80;
    const g = this.ctx.createGain();
    if (opts.attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.2, t + opts.attack);
    } else g.gain.setValueAtTime(opts.vol ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(hp).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  /* ------------------------------ body ------------------------------ */

  step() {
    if (!this.throttle("step", 90)) return;
    // alternate feet, never the exact same sound twice
    this.stepFoot = 1 - this.stepFoot;
    const v = 0.85 + Math.random() * 0.3;
    const pitch = (this.stepFoot ? 1 : 0.88) * (0.92 + Math.random() * 0.16);
    if (this.surface === "snow") {
      this.noise(0.12, { vol: 0.1 * v, lp: 3200, hp: 900, rate: 0.6 * pitch });
      this.tone(80 * pitch, 0.07, { vol: 0.06 * v, slide: 0.6 });
    } else if (this.surface === "wood") {
      this.tone(210 * pitch, 0.06, { type: "triangle", vol: 0.07 * v, slide: 0.7 });
      this.noise(0.05, { vol: 0.07 * v, lp: 1800, hp: 300 });
    } else {
      this.noise(0.08, { vol: 0.1 * v, lp: 900, hp: 120, rate: pitch });
      this.tone(95 * pitch, 0.08, { type: "sine", vol: 0.1 * v, slide: 0.5 });
    }
  }

  /** Landing scaled by how hard it was (0.3 hop .. 1.3 drop from a height). */
  land(intensity = 1) {
    if (!this.throttle("land", 120)) return;
    const v = Math.min(1.3, intensity);
    this.noise(0.14 + v * 0.1, { vol: 0.18 * v, lp: 420 + v * 200, hp: 40 });
    this.tone(85 - v * 20, 0.18 + v * 0.1, { type: "sine", vol: 0.28 * v, slide: 0.45 });
    if (v > 0.85) this.tone(48, 0.32, { type: "sine", vol: 0.22, slide: 0.6, delay: 0.01 });
  }

  thud(intensity = 1) {
    if (!this.throttle("thud", 70)) return;
    const v = Math.min(1, intensity);
    this.noise(0.18, { vol: 0.25 * v, lp: 500, hp: 40 });
    this.tone(70, 0.22, { type: "sine", vol: 0.35 * v, slide: 0.4 });
  }

  /** Rubbery boing for props bouncing about. */
  bounce(intensity = 0.5) {
    if (!this.throttle("bounce", 80)) return;
    const v = Math.min(1, intensity);
    this.tone(140 + Math.random() * 40, 0.16, { type: "sine", vol: 0.12 * v + 0.03, slide: 1.9 });
    this.noise(0.05, { vol: 0.06 * v, lp: 900 });
  }

  /** One hand closes: tactile click. Two hands on the same thing: a firm clunk. */
  grab(strong = false) {
    if (!this.throttle("grab", 40)) return;
    this.noise(0.035, { vol: 0.09, lp: 3800, hp: 900 });
    this.tone(strong ? 240 : 330, 0.07, { type: "square", vol: 0.05, slide: 1.35, lp: 2400 });
    if (strong) {
      this.tone(110, 0.16, { type: "sine", vol: 0.18, slide: 0.7, delay: 0.01 });
      this.tone(520, 0.1, { type: "triangle", vol: 0.07, delay: 0.05 });
    }
  }

  /** Grab pressed, nothing in reach: a soft airy whiff. */
  miss() {
    if (!this.throttle("miss", 160)) return;
    this.noise(0.16, { vol: 0.05, bp: 1400, q: 0.8, slideLp: 500, attack: 0.02 });
  }

  release() {
    if (!this.throttle("release", 50)) return;
    this.tone(380, 0.07, { type: "triangle", vol: 0.05, slide: 0.65 });
  }

  whoosh() {
    if (!this.throttle("whoosh", 100)) return;
    this.noise(0.32, { vol: 0.24, lp: 400, slideLp: 3800, hp: 200, attack: 0.04 });
  }

  jump() {
    if (!this.throttle("jump", 120)) return;
    this.tone(220, 0.25, { type: "triangle", vol: 0.14, slide: 2.2 });
    this.noise(0.12, { vol: 0.1, lp: 1500 });
  }

  kick() {
    if (!this.throttle("kick", 90)) return;
    this.noise(0.12, { vol: 0.16, lp: 700, slideLp: 200 });
  }

  fall() {
    if (!this.throttle("fall", 300)) return;
    this.tone(320, 0.45, { type: "sawtooth", vol: 0.06, slide: 0.3, lp: 1400 });
    this.noise(0.3, { vol: 0.2, lp: 600 });
    this.tone(60, 0.3, { vol: 0.25, slide: 0.5, delay: 0.05 });
  }

  getup() {
    if (!this.throttle("getup", 300)) return;
    this.tone(200, 0.2, { type: "triangle", vol: 0.1, slide: 1.8 });
    this.tone(400, 0.16, { type: "triangle", vol: 0.07, slide: 1.4, delay: 0.1 });
  }

  shout() {
    const f = 300 + Math.random() * 200;
    this.tone(f, 0.18, { type: "sawtooth", vol: 0.07, slide: 1.3, lp: 2500 });
    this.tone(f * 1.5, 0.22, { type: "square", vol: 0.035, slide: 0.8, lp: 2500 });
  }

  climb() {
    if (!this.throttle("climb", 120)) return;
    this.noise(0.1, { vol: 0.09, lp: 1500, hp: 300 });
  }

  /* ------------------------------ world ------------------------------ */

  /** Into the water (or the cloud sea): plunge, spray, bubbles. */
  splash(intensity = 1) {
    if (!this.throttle("splash", 200)) return;
    const v = Math.min(1, intensity);
    this.noise(0.65 * v + 0.2, { vol: 0.34 * v, lp: 2400, slideLp: 280, hp: 100 });
    this.tone(150, 0.35, { type: "sine", vol: 0.18 * v, slide: 0.35 });
    for (let i = 0; i < 5; i++) this.tone(500 + Math.random() * 700, 0.07, { type: "sine", vol: 0.05 * v, slide: 1.8, delay: 0.12 + i * 0.07 + Math.random() * 0.04 });
  }

  /** Back at the checkpoint: a quick rising blip. */
  respawn() {
    if (!this.throttle("respawn", 400)) return;
    this.tone(330, 0.14, { type: "triangle", vol: 0.08, slide: 2, delay: 0.25 });
    this.tone(660, 0.12, { type: "triangle", vol: 0.06, delay: 0.36 });
  }

  crack() {
    this.noise(0.25, { vol: 0.35, lp: 4000, slideLp: 800, hp: 400 });
    this.tone(900, 0.1, { type: "square", vol: 0.07, slide: 0.3, lp: 3000 });
    for (let i = 0; i < 4; i++) this.tone(1800 + Math.random() * 1500, 0.05, { type: "sine", vol: 0.04, delay: 0.08 + i * 0.05 });
  }

  /** The egg gets bumped. It does not like it. */
  eek() {
    if (!this.throttle("eek", 450)) return;
    this.tone(1250, 0.09, { type: "square", vol: 0.035, slide: 1.35, lp: 3500 });
    this.tone(1650, 0.08, { type: "square", vol: 0.03, slide: 0.9, delay: 0.08, lp: 3500 });
  }

  checkpoint() {
    this.tone(784, 0.12, { type: "triangle", vol: 0.15 });
    this.tone(1175, 0.24, { type: "triangle", vol: 0.14, delay: 0.09 });
    this.tone(1568, 0.3, { type: "sine", vol: 0.06, delay: 0.09 });
  }

  /** Net swish + rising arpeggio. */
  swish() {
    this.noise(0.22, { vol: 0.22, hp: 2200, lp: 9000, attack: 0.02, rate: 1.4 });
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, { type: "triangle", vol: 0.13, delay: 0.08 + i * 0.065 }));
  }

  /** Crowd: band-passed noise swell plus scattered claps. */
  cheer(intensity = 1) {
    if (!this.throttle("cheer", 600)) return;
    const v = Math.min(1.5, intensity);
    this.noise(1.6 * v, { vol: 0.09 * v, bp: 1100, q: 0.6, attack: 0.25, rate: 0.9 });
    this.noise(1.4 * v, { vol: 0.06 * v, bp: 2300, q: 0.9, attack: 0.3, rate: 1.1 });
    for (let i = 0; i < 10 * v; i++) this.noise(0.03, { vol: 0.07, bp: 1600 + Math.random() * 800, q: 1.5, delay: 0.2 + Math.random() * 1.1 });
  }

  /** Delivery: a bell chord that only plays for "you got it there". */
  delivery() {
    [660, 990, 1320].forEach((f, i) => {
      this.tone(f, 0.9, { type: "sine", vol: 0.1, delay: i * 0.08 });
      this.tone(f * 2.01, 0.5, { type: "sine", vol: 0.03, delay: i * 0.08 });
    });
    this.tone(1760, 0.6, { type: "triangle", vol: 0.06, delay: 0.3 });
    this.noise(0.6, { vol: 0.05, hp: 5000, lp: 12000, delay: 0.25 });
  }

  score() {
    this.swish();
  }

  /** Countdown: woodblock ticks, then a bright chord on GO. */
  beep(final = false) {
    if (final) {
      [523, 659, 784, 1046].forEach((f) => this.tone(f, 0.55, { type: "square", vol: 0.06, lp: 3000 }));
      this.noise(0.4, { vol: 0.12, lp: 600, slideLp: 4000, hp: 200, attack: 0.03 });
    } else {
      this.tone(880, 0.08, { type: "triangle", vol: 0.16 });
      this.noise(0.03, { vol: 0.08, bp: 2500, q: 2 });
    }
  }

  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      this.tone(f, last ? 0.8 : 0.18, { type: "sawtooth", vol: 0.07, lp: 2600, delay: i * 0.11 });
      this.tone(f / 2, last ? 0.8 : 0.18, { type: "square", vol: 0.03, lp: 1200, delay: i * 0.11 });
    });
    // drum hits under the melody, then a cymbal wash
    for (let i = 0; i < 4; i++) this.tone(70, 0.18, { vol: 0.25, slide: 0.5, delay: i * 0.22 });
    this.noise(1.6, { vol: 0.14, lp: 9000, hp: 3000, delay: 0.75 });
  }

  /* ------------------------------ ambience ------------------------------ */

  /** Quiet looping bed for the course (wind on the summit, waves at the harbour). */
  setAmbience(kind: AmbienceKind) {
    if (kind === this.ambienceKind) return;
    this.ambienceKind = kind;
    this.stopAmbience();
    if (this.ctx) this.startAmbience();
  }

  private startAmbience() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || this.ambienceKind === "none") return;
    const spec = {
      wind: { lp: 520, vol: 0.075, lfo: 0.13, depth: 260 },
      breeze: { lp: 380, vol: 0.03, lfo: 0.09, depth: 120 },
      harbor: { lp: 300, vol: 0.05, lfo: 0.18, depth: 160 },
      arena: { lp: 900, vol: 0.022, lfo: 0.3, depth: 200 },
    }[this.ambienceKind];
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = spec.lp;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = spec.lfo;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = spec.depth;
    lfo.connect(lfoGain).connect(lp.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(spec.vol, ctx.currentTime + 2);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.ambienceNodes = [lp, lfoGain, g];
    this.ambienceSources = [src, lfo];
  }

  private stopAmbience() {
    for (const s of this.ambienceSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.ambienceNodes) n.disconnect();
    this.ambienceSources = [];
    this.ambienceNodes = [];
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

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusic();
    this.stopAmbience();
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
