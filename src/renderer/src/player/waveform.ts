import { create } from "zustand";
import { currentItem } from "./queue";
import { getAnalyser, usePlayer } from "./store";
import { decodeShape, emptyShape, encodeShape, ShapeRecorder, type Shape } from "./waveShape";

// The seek bar's shape: how loud each stretch of a song really is, measured
// from the analyser while it plays. Nothing is downloaded or decoded for it.
// A song heard before shows its whole shape; stretches not heard yet stay
// unknown, and the bar draws them as a soft, even preview. Shapes are kept for
// the songs played most recently, so they're there next time.

const STORAGE_KEY = "encore.waveforms.v1";
const KEEP = 300;
const SAMPLE_MS = 50;
const SAVE_MS = 15_000;

// ---- kept shapes ----

let kept: Map<string, string> | null = null;
let dirty = false;

function keptShapes(): Map<string, string> {
  if (kept) return kept;
  kept = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
    for (const [id, text] of Object.entries(saved)) if (typeof text === "string") kept.set(id, text);
  } catch {
    // a damaged copy only costs the shapes; they come back as songs play
  }
  return kept;
}

function keep(id: string, shape: Shape): void {
  const shapes = keptShapes();
  shapes.delete(id);
  shapes.set(id, encodeShape(shape));
  while (shapes.size > KEEP) shapes.delete(shapes.keys().next().value!);
  dirty = true;
}

function save(): void {
  if (!dirty || !kept) return;
  dirty = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // out of room: the shapes still work for this session
  }
}

/** the shape of the song that's playing, for the seek bars */
export const useWaveform = create<{ trackId: string | null; shape: Shape }>(() => ({ trackId: null, shape: emptyShape() }));

/** measure the song that's playing for as long as the window is open */
export function connectWaveform(): () => void {
  let recorder: ShapeRecorder | null = null;
  let trackId: string | null = null;
  let samples: Float32Array<ArrayBuffer> | null = null;

  const publish = () => recorder && useWaveform.setState({ trackId, shape: [...recorder.shape] });
  const finish = () => {
    if (!recorder || !trackId) return;
    if (recorder.flush()) publish();
    if (recorder.shape.some((v) => v !== null)) keep(trackId, recorder.shape);
  };

  const tick = () => {
    const s = usePlayer.getState();
    const id = currentItem(s.queue)?.track.id ?? null;
    if (id !== trackId) {
      finish();
      trackId = id;
      const known = id ? keptShapes().get(id) : undefined;
      recorder = id ? new ShapeRecorder(known ? decodeShape(known) : emptyShape()) : null;
      useWaveform.setState({ trackId: id, shape: recorder ? [...recorder.shape] : emptyShape() });
    }
    if (!recorder || s.status !== "playing") return;
    const analyser = getAnalyser();
    if (!analyser) return;
    if (samples?.length !== analyser.fftSize) samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    if (recorder.add(s.position, s.duration, Math.sqrt(sum / samples.length))) {
      publish();
      if (trackId) keep(trackId, recorder.shape);
    }
  };

  const sampler = setInterval(tick, SAMPLE_MS);
  const saver = setInterval(save, SAVE_MS);
  const onUnload = () => {
    finish();
    save();
  };
  window.addEventListener("beforeunload", onUnload);
  return () => {
    clearInterval(sampler);
    clearInterval(saver);
    window.removeEventListener("beforeunload", onUnload);
    onUnload();
  };
}
