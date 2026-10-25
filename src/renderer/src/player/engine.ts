import { mediaUrl, type Track } from "@shared/types";
import { BAND_Q, bandType, EQ_FREQUENCIES, type EqSettings } from "@/audio/eq";
import { dbToGain, fadeCurve } from "./transitions";

// Two <audio> "decks" feed one Web Audio graph:
//
//   deck A ─ level ─ fade ─┐
//                          ├─ preamp ─ 10 EQ bands ─ limiter ─ analyser ─ volume ─ speakers
//   deck B ─ level ─ fade ─┘
//
// One deck plays while the other gets the next song ready, so songs can
// follow each other without a gap or cross-fade into each other.

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

  constructor(private readonly events: EngineEvents) {
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;
    this.preamp = ctx.createGain();
    this.bands = EQ_FREQUENCIES.map((frequency, i) => {
      const band = ctx.createBiquadFilter();
      band.type = bandType(i);
      band.frequency.value = frequency;
      band.Q.value = BAND_Q;
      band.gain.value = 0;
      return band;
    });
    // catches peaks from EQ boosts and levelling before they clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master = ctx.createGain();

    let node: AudioNode = this.preamp;
    for (const band of this.bands) node = node.connect(band);
    node.connect(limiter).connect(this.analyser).connect(this.master).connect(ctx.destination);

    this.decks = [new Deck(ctx, this.preamp), new Deck(ctx, this.preamp)];
    this.decks.forEach((deck) => this.listen(deck));
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
    const db = !this.levelling ? 0 : (known ?? (deck.track.source === "youtube" ? UNKNOWN_LEVEL_DB : 0));
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

  setEq(eq: EqSettings): void {
    const now = this.ctx.currentTime;
    this.preamp.gain.setTargetAtTime(eq.enabled ? dbToGain(eq.preamp) : 1, now, 0.03);
    this.bands.forEach((band, i) => band.gain.setTargetAtTime(eq.enabled ? (eq.bands[i] ?? 0) : 0, now, 0.03));
  }

  unload(): void {
    this.settleCrossfade();
    this.decks.forEach((deck) => deck.clear());
  }
}
