import { mediaUrl, type Track } from "@shared/types";
import { BAND_Q, bandType, EQ_FREQUENCIES, type EqSettings } from "@/audio/eq";
import { dbToGain, fadeCurve } from "./transitions";
import limiterWorklet from "./limiter.worklet.ts?worker&url";

// Two <audio> "decks" feed one Web Audio graph:
//
//   deck A ─ level ─ fade ─┐       ┌─ preamp ─ 10 EQ ─┐       ┌─ dry ──────────┐
//                          ├─ in ──┤                  ├─ mix ─┤                ├─ limiter ─ analyser ─ volume ─ speakers
//   deck B ─ level ─ fade ─┘       └─ (EQ off) ───────┘       └─ reverb ─ wet ─┘
//
// One deck plays while the other gets the next song ready, so songs can
// follow each other without a gap or cross-fade into each other.
//
// With Pure sound on, songs reach the speakers untouched: no equalizer,
// levelling, reverb or speed change. Only the limiter stays, and it does
// nothing unless a sample would clip.

export interface EngineEvents {
  onTime(seconds: number): void;
  onDuration(seconds: number): void;
  onPlaying(): void;
  onPaused(): void;
  onWaiting(): void;
  onEnded(): void;
  /** the stream failed even after asking for a fresh URL */
  onFailed(track: Track): void;
}

/** a very short fade on manual skips, so the cut never clicks */
const SWITCH_FADE_S = 0.04;
/** until we know how loud a streamed song is, start it this much quieter */
const UNKNOWN_LEVEL_DB = -6;
/** how long the reverb rings on; also how long to wait before switching it off */
const REVERB_SECONDS = 3.2;
/** the limiter's ceiling: a little headroom normally, and with Pure sound only enough to stop clipping */
const CEILING_DB = -0.3;
const PURE_CEILING_DB = 0;
/** how long the EQ takes to step in or out of the way, so it never clicks */
const ROUTE_FADE_S = 0.03;

/**
 * A made-up room for the reverb: stereo noise that dies away and gets darker
 * as it does, the way sound fades in a big hall.
 */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * REVERB_SECONDS);
  const predelay = Math.floor(rate * 0.025);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smoothed = 0;
    for (let i = predelay; i < length; i++) {
      const t = (i - predelay) / (length - predelay);
      smoothed += (Math.random() * 2 - 1 - smoothed) * (0.9 - 0.75 * t);
      data[i] = smoothed * (1 - t) ** 2.4;
    }
  }
  return buffer;
}

class Deck {
  readonly audio: HTMLAudioElement;
  readonly level: GainNode;
  readonly fade: GainNode;
  track: Track | null = null;
  attempt = 0;
  seekOnLoad: number | null = null;
  stopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(ctx: AudioContext, output: AudioNode) {
    const audio = new Audio();
    audio.preload = "auto";
    // the media scheme answers with CORS headers, so Web Audio gets real samples
    audio.crossOrigin = "anonymous";
    this.audio = audio;
    this.level = ctx.createGain();
    this.fade = ctx.createGain();
    ctx.createMediaElementSource(audio).connect(this.level).connect(this.fade).connect(output);
  }

  open(track: Track, attempt: number, startAt: number): void {
    clearTimeout(this.stopTimer);
    this.track = track;
    this.attempt = attempt;
    this.seekOnLoad = startAt > 0 ? startAt : null;
    this.audio.src = mediaUrl(track, attempt);
  }

  clear(): void {
    clearTimeout(this.stopTimer);
    this.track = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}

export class AudioEngine {
  private readonly ctx: AudioContext;
  private readonly decks: [Deck, Deck];
  private active = 0;
  private readonly preamp: GainNode;
  private readonly bands: BiquadFilterNode[];
  private readonly master: GainNode;
  readonly analyser: AnalyserNode;
  private crossfade: { from: Deck; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly levels = new Map<string, number>();
  private levelling = true;
  /** the equalized and the untouched way from the decks to the mix; one is open at a time */
  private readonly eqPath: GainNode;
  private readonly plainPath: GainNode;
  private readonly mix: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private reverb: { node: ConvolverNode; connected: boolean; offTimer?: ReturnType<typeof setTimeout> } | null = null;
  private readonly limiterIn: GainNode;
  /** the built-in compressor, used until the look-ahead limiter has loaded, or if it can't */
  private readonly fallbackLimiter: DynamicsCompressorNode;
  private limiter: AudioWorkletNode | null = null;
  private pure = false;
  private eq: EqSettings | null = null;
  private rate = 1;
  private keepPitch = false;
  /** in a Jam as a guest: the host's speed, and how much faster or slower to play to keep up with it */
  private jam: { rate: number; keepPitch: boolean; nudge: number } | null = null;
  private reverbAmount = 0;

  constructor(private readonly events: EngineEvents) {
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;
    const input = ctx.createGain();
    this.preamp = ctx.createGain();
    this.bands = EQ_FREQUENCIES.map((frequency, i) => {
      const band = ctx.createBiquadFilter();
      band.type = bandType(i);
      band.frequency.value = frequency;
      band.Q.value = BAND_Q;
      band.gain.value = 0;
      return band;
    });
    this.eqPath = ctx.createGain();
    this.eqPath.gain.value = 0;
    this.plainPath = ctx.createGain();
    this.mix = ctx.createGain();
    // catches peaks from EQ boosts and levelling before they clip
    this.limiterIn = ctx.createGain();
    this.fallbackLimiter = ctx.createDynamicsCompressor();
    this.fallbackLimiter.threshold.value = -1;
    this.fallbackLimiter.knee.value = 0;
    this.fallbackLimiter.ratio.value = 20;
    this.fallbackLimiter.attack.value = 0.003;
    this.fallbackLimiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    let node: AudioNode = input.connect(this.preamp);
    for (const band of this.bands) node = node.connect(band);
    node.connect(this.eqPath).connect(this.mix);
    input.connect(this.plainPath).connect(this.mix);
    this.mix.connect(this.dry).connect(this.limiterIn);
    this.wet.connect(this.limiterIn);
    this.limiterIn.connect(this.fallbackLimiter).connect(this.analyser);
    this.analyser.connect(this.master).connect(ctx.destination);
    void this.loadLimiter();

    this.decks = [new Deck(ctx, input), new Deck(ctx, input)];
    this.decks.forEach((deck) => this.listen(deck));
  }

  /** swap the built-in compressor for the look-ahead limiter once its script has loaded on the audio thread */
  private async loadLimiter(): Promise<void> {
    try {
      await this.ctx.audioWorklet.addModule(limiterWorklet);
      const limiter = new AudioWorkletNode(this.ctx, "peak-limiter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        // a mono song comes out of both speakers
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { ceilingDb: this.pure ? PURE_CEILING_DB : CEILING_DB },
      });
      limiter.connect(this.analyser);
      this.limiterIn.connect(limiter);
      this.limiterIn.disconnect(this.fallbackLimiter);
      this.fallbackLimiter.disconnect();
      this.limiter = limiter;
      document.documentElement.dataset.limiter = "look-ahead";
    } catch (error) {
      console.warn("The look-ahead limiter didn't load, so the built-in one stays.", error);
      document.documentElement.dataset.limiter = "built-in";
    }
  }

  private get activeDeck(): Deck {
    return this.decks[this.active];
  }

  private get idleDeck(): Deck {
    return this.decks[1 - this.active];
  }

  private listen(deck: Deck): void {
    const { audio } = deck;
    const isActive = () => deck === this.activeDeck;
    audio.addEventListener("timeupdate", () => isActive() && this.events.onTime(audio.currentTime));
    audio.addEventListener("durationchange", () => isActive() && Number.isFinite(audio.duration) && this.events.onDuration(audio.duration));
    audio.addEventListener("loadedmetadata", () => {
      if (deck.seekOnLoad !== null) {
        audio.currentTime = deck.seekOnLoad;
        deck.seekOnLoad = null;
      }
    });
    audio.addEventListener("playing", () => isActive() && this.events.onPlaying());
    audio.addEventListener("pause", () => isActive() && !audio.ended && !this.crossfade && this.events.onPaused());
    audio.addEventListener("waiting", () => isActive() && this.events.onWaiting());
    audio.addEventListener("ended", () => isActive() && this.events.onEnded());
    audio.addEventListener("error", () => {
      const track = deck.track;
      if (!track || !audio.getAttribute("src")) return;
      if (!isActive()) {
        // a song we were getting ready failed; try again when it's actually needed
        deck.clear();
        return;
      }
      if (deck.attempt === 0) {
        // the cached URL may have expired; ask the main process for a new one
        deck.open(track, 1, audio.currentTime);
        this.playDeck(deck);
        return;
      }
      this.events.onFailed(track);
    });
  }

  get currentTrack(): Track | null {
    return this.activeDeck.track;
  }

  get isPaused(): boolean {
    return this.activeDeck.audio.paused;
  }

  /** where the current song is, in seconds, to the millisecond */
  get currentTime(): number {
    const deck = this.activeDeck;
    return deck.audio.readyState === 0 ? (deck.seekOnLoad ?? 0) : deck.audio.currentTime;
  }

  private resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private playDeck(deck: Deck): void {
    this.resume();
    // play() rejects when a new src interrupts it; real failures fire "error"
    void deck.audio.play().catch(() => undefined);
  }

  private setFade(deck: Deck, value: number): void {
    const now = this.ctx.currentTime;
    deck.fade.gain.cancelScheduledValues(now);
    deck.fade.gain.setValueAtTime(value, now);
  }

  private fadeOutAndStop(deck: Deck, seconds: number): void {
    const now = this.ctx.currentTime;
    deck.fade.gain.cancelScheduledValues(now);
    deck.fade.gain.setValueAtTime(deck.fade.gain.value, now);
    deck.fade.gain.linearRampToValueAtTime(0, now + seconds);
    clearTimeout(deck.stopTimer);
    deck.stopTimer = setTimeout(() => deck.audio.pause(), seconds * 1000 + 20);
  }

  private applyLevel(deck: Deck, initial = false): void {
    if (!deck.track) return;
    const known = this.levels.get(deck.track.id);
    const db = !this.levelling || this.pure ? 0 : (known ?? (deck.track.source === "youtube" ? UNKNOWN_LEVEL_DB : 0));
    const now = this.ctx.currentTime;
    deck.level.gain.cancelScheduledValues(now);
    if (initial) deck.level.gain.setValueAtTime(dbToGain(db), now);
    else deck.level.gain.setTargetAtTime(dbToGain(db), now, 0.15);
  }

  /** finish any crossfade at once: the new song at full volume, the old one stopped */
  private settleCrossfade(): void {
    if (!this.crossfade) return;
    const { from, timer } = this.crossfade;
    clearTimeout(timer);
    this.crossfade = null;
    this.setFade(from, 0);
    from.audio.pause();
    this.setFade(this.activeDeck, 1);
  }

  /** switch to a song right away, using the prepared deck when it holds that song */
  load(track: Track, options: { autoplay: boolean; startAt?: number }): void {
    this.settleCrossfade();
    const startAt = options.startAt ?? 0;
    const current = this.activeDeck;
    const idle = this.idleDeck;
    let target: Deck;
    if (idle.track?.id === track.id && idle.attempt === 0) {
      target = idle;
      if (startAt > 0) {
        if (target.audio.readyState > 0) target.audio.currentTime = startAt;
        else target.seekOnLoad = startAt;
      } else if (target.audio.currentTime > 0) target.audio.currentTime = 0;
    } else if (!current.track) {
      target = current;
      target.open(track, 0, startAt);
    } else {
      target = idle;
      target.open(track, 0, startAt);
    }

    if (target !== current && current.track) this.fadeOutAndStop(current, SWITCH_FADE_S);
    this.active = this.decks.indexOf(target);
    this.setFade(target, 1);
    this.applyLevel(target, true);
    if (Number.isFinite(target.audio.duration)) this.events.onDuration(target.audio.duration);
    if (options.autoplay) this.playDeck(target);
  }

  /** get the next song buffered on the idle deck; null forgets it */
  preload(track: Track | null): void {
    if (this.crossfade) return;
    const idle = this.idleDeck;
    if (!track) {
      if (idle.track) idle.clear();
      return;
    }
    if (idle.track?.id === track.id) return;
    this.setFade(idle, 0);
    idle.open(track, 0, 0);
  }

  /** fade the current song out while the next one fades in */
  crossfadeTo(track: Track, seconds: number): void {
    this.settleCrossfade();
    const from = this.activeDeck;
    const to = this.idleDeck;
    if (to.track?.id !== track.id) to.open(track, 0, 0);
    else if (to.audio.currentTime > 0) to.audio.currentTime = 0;
    this.active = this.decks.indexOf(to);
    this.applyLevel(to, true);

    const now = this.ctx.currentTime;
    from.fade.gain.cancelScheduledValues(now);
    from.fade.gain.setValueCurveAtTime(fadeCurve("out"), now, seconds);
    to.fade.gain.cancelScheduledValues(now);
    to.fade.gain.setValueCurveAtTime(fadeCurve("in"), now, seconds);
    this.playDeck(to);
    this.crossfade = { from, timer: setTimeout(() => this.settleCrossfade(), seconds * 1000 + 50) };
    if (Number.isFinite(to.audio.duration)) this.events.onDuration(to.audio.duration);
  }

  play(): void {
    this.playDeck(this.activeDeck);
  }

  pause(): void {
    this.settleCrossfade();
    this.activeDeck.audio.pause();
  }

  seek(seconds: number): void {
    this.settleCrossfade();
    const deck = this.activeDeck;
    if (deck.audio.readyState === 0) deck.seekOnLoad = seconds;
    else deck.audio.currentTime = seconds;
  }

  setVolume(volume: number, muted: boolean): void {
    // squared so the slider feels even to the ear
    const gain = muted ? 0 : Math.min(1, Math.max(0, volume)) ** 2;
    this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.015);
  }

  setLevelling(on: boolean): void {
    this.levelling = on;
    this.decks.forEach((deck) => this.applyLevel(deck));
  }

  /** how many dB to move a song by to match the others */
  setTrackLevel(trackId: string, db: number): void {
    this.levels.set(trackId, db);
    if (this.levels.size > 500) this.levels.delete(this.levels.keys().next().value!);
    this.decks.forEach((deck) => deck.track?.id === trackId && this.applyLevel(deck));
  }

  hasTrackLevel(trackId: string): boolean {
    return this.levels.has(trackId);
  }

  /** playback speed; with keepPitch the key stays put, without it the song goes up or down like a record */
  setSpeed(rate: number, keepPitch: boolean): void {
    this.rate = Math.min(4, Math.max(0.25, rate || 1));
    this.keepPitch = keepPitch;
    this.applySpeed();
  }

  /** a Jam guest plays at the host's speed, `nudge` times faster to catch up with it; null goes back to its own */
  follow(host: { rate: number; keepPitch: boolean; nudge: number } | null): void {
    const same = host && this.jam && host.rate === this.jam.rate && host.keepPitch === this.jam.keepPitch && host.nudge === this.jam.nudge;
    if (same || (!host && !this.jam)) return;
    this.jam = host && { ...host };
    this.applySpeed();
  }

  private applySpeed(): void {
    const rate = this.speed * (this.jam?.nudge ?? 1);
    // catching up keeps the key, so it isn't heard
    const keepPitch = this.jam ? this.jam.keepPitch || this.jam.rate === 1 : this.keepPitch;
    for (const { audio } of this.decks) {
      audio.preservesPitch = keepPitch;
      // a new song resets the speed to the default one, so both are set
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    }
  }

  /** the speed songs actually play at */
  get speed(): number {
    if (this.jam) return this.jam.rate;
    return this.pure ? 1 : this.rate;
  }

  /** whether a sped-up song keeps its key */
  get keepsPitch(): boolean {
    return this.keepPitch;
  }

  /** 0 is dry, 1 is drenched; the reverb only runs while it's turned up */
  setReverb(amount: number): void {
    this.reverbAmount = Math.min(1, Math.max(0, amount));
    this.applyReverb();
  }

  private applyReverb(): void {
    const mix = this.pure ? 0 : this.reverbAmount;
    const now = this.ctx.currentTime;
    if (mix > 0) {
      if (!this.reverb) {
        const node = this.ctx.createConvolver();
        node.buffer = roomImpulse(this.ctx);
        node.connect(this.wet);
        this.reverb = { node, connected: false };
      }
      clearTimeout(this.reverb.offTimer);
      if (!this.reverb.connected) {
        this.mix.connect(this.reverb.node);
        this.reverb.connected = true;
      }
    } else if (this.reverb?.connected) {
      // let the tail ring out, then stop spending time on it
      const reverb = this.reverb;
      clearTimeout(reverb.offTimer);
      reverb.offTimer = setTimeout(() => {
        this.mix.disconnect(reverb.node);
        reverb.connected = false;
      }, REVERB_SECONDS * 1000);
    }
    // the dry signal dips a little as the room fills in, so turning it up doesn't just make it louder
    this.wet.gain.setTargetAtTime(mix * 1.1, now, 0.05);
    this.dry.gain.setTargetAtTime(1 - mix * 0.45, now, 0.05);
  }

  setEq(eq: EqSettings): void {
    this.eq = eq;
    this.applyEq();
  }

  /** songs go through the EQ only while it's on; otherwise it's out of the way entirely */
  private applyEq(): void {
    const eq = this.eq;
    const on = !!eq?.enabled && !this.pure;
    const now = this.ctx.currentTime;
    if (eq?.enabled) {
      this.preamp.gain.setTargetAtTime(dbToGain(eq.preamp), now, 0.03);
      this.bands.forEach((band, i) => band.gain.setTargetAtTime(eq.bands[i] ?? 0, now, 0.03));
    }
    // linear ramps end exactly on 0 and 1, so the closed way adds nothing at all
    for (const [path, open] of [
      [this.eqPath, on],
      [this.plainPath, !on],
    ] as const) {
      path.gain.cancelScheduledValues(now);
      path.gain.setValueAtTime(path.gain.value, now);
      path.gain.linearRampToValueAtTime(open ? 1 : 0, now + ROUTE_FADE_S);
    }
  }

  /** play songs exactly as they come, skipping the EQ, levelling, reverb and speed; those settings wait for later */
  setPure(on: boolean): void {
    if (on === this.pure) return;
    this.pure = on;
    this.applyEq();
    this.decks.forEach((deck) => this.applyLevel(deck));
    this.applySpeed();
    this.applyReverb();
    this.limiter?.port.postMessage({ ceilingDb: on ? PURE_CEILING_DB : CEILING_DB });
    this.fallbackLimiter.threshold.value = on ? -0.1 : -1;
  }

  unload(): void {
    this.settleCrossfade();
    this.decks.forEach((deck) => deck.clear());
  }
}
