import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { usePlayer } from "@/player/store";
import { cn } from "@/lib/cn";
import { bassMeter, quadProgram } from "./gl";
import type { RGB } from "./palette";

// A line of light round the edge of the window, drawn with WebGL: a thin
// bright tube with a soft glow falling inward. Its colours travel round the
// edge, bright streaks chase each other, and the bass makes it swell and
// flash on the beat. When it appears, the light runs out both ways from the
// top and meets at the bottom.

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_radius;
uniform float u_phase;
uniform float u_energy;
uniform float u_kick;
uniform float u_glow;
uniform float u_level;
uniform float u_reveal;
uniform float u_rainbow;
uniform float u_stops;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;

const float TAU = 6.2831853;

float roundedBox(vec2 p, vec2 extent, float r) {
  vec2 q = abs(p) - extent + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

// the colours spread once round the edge, ending where they started
vec3 colours(float t) {
  t = fract(t);
  if (u_stops < 2.5) return mix(u_c0, u_c1, 0.5 - 0.5 * cos(TAU * t));
  t *= 3.0;
  float f = smoothstep(0.0, 1.0, fract(t));
  if (t < 1.0) return mix(u_c0, u_c1, f);
  if (t < 2.0) return mix(u_c1, u_c2, f);
  return mix(u_c2, u_c0, f);
}

void main() {
  // everything is measured in CSS pixels, so it looks the same on any screen
  vec2 size = u_res / u_scale;
  vec2 p = gl_FragCoord.xy / u_scale - 0.5 * size;
  // a small preview gets a smaller glow
  float fit = clamp(min(size.x, size.y) / 800.0, 0.12, 1.0);
  float width = mix(9.0, 44.0, u_glow) * fit * (1.0 + 0.35 * u_energy + 0.55 * u_kick);
  float reach = width * 6.0;
  float d = abs(roundedBox(p, 0.5 * size - 1.0, u_radius));
  if (d > reach) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // 0 to 1 round the edge
  float s = atan(p.y, p.x) / TAU;
  // 0 at the top middle, 1 at the bottom middle, either way round
  float fromTop = abs(fract(s - 0.25 + 0.5) - 0.5) * 2.0;
  float front = u_reveal * 1.08;
  float shown = 1.0 - smoothstep(front - 0.08, front, fromTop);
  float head = exp(-abs(fromTop - front) * 22.0) * (1.0 - u_reveal);

  float streaks = pow(0.5 + 0.5 * sin(TAU * (2.0 * s - 2.0 * u_phase)), 4.0)
    + 0.6 * pow(0.5 + 0.5 * sin(TAU * (3.0 * s + 1.3 * u_phase) + 1.7), 8.0);
  float flow = 0.55 + 0.45 * streaks + 1.4 * head;

  vec3 col = mix(colours(s - u_phase), hue(s - u_phase) * 0.85 + 0.15, u_rainbow);
  float core = exp(-d / (0.7 + 0.8 * u_glow));
  float halo = exp(-d / width) * flow;
  float haze = exp(-d / (width * 2.4)) * flow * (1.0 - smoothstep(reach * 0.5, reach, d));
  float a = (core * 0.9 + halo * 0.55 + haze * 0.14) * (0.9 + 0.15 * u_energy + 0.4 * u_kick);
  a = clamp(a * u_level * shown, 0.0, 1.0);
  // the tube itself burns white-hot in the middle
  vec3 c = mix(col, vec3(1.0), core * 0.4);
  gl_FragColor = vec4(c * a, a);
}
`;

/** sharp enough for a 1px line without drawing every pixel of a 4K screen */
const MAX_SCALE = 1.5;
const REVEAL_SECONDS = 1.3;

export interface EdgeLightProps {
  /** two or three colours */
  colors: RGB[];
  rainbow?: boolean;
  /** 0 to 100; 0 holds still */
  speed: number;
  /** 0 to 100 */
  glow: number;
  /** swell and flash with the bass */
  pulse: boolean;
  /** corner radius in CSS px, to follow the window's corners */
  radius?: number;
  /** dims and slows while the music is paused */
  followPlayback?: boolean;
  className?: string;
}

export function EdgeLight({ colors, rainbow = false, speed, glow, pulse, radius = 8, followPlayback = true, className }: EdgeLightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion() ?? false;
  const props = useRef({ colors, rainbow, speed, glow, pulse, radius, followPlayback, still });
  props.current = { colors, rainbow, speed, glow, pulse, radius, followPlayback, still };

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!canvas || !gl) return;
    const program = quadProgram(gl, FRAGMENT);
    if (!program) return;

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      res: u("u_res"),
      scale: u("u_scale"),
      radius: u("u_radius"),
      phase: u("u_phase"),
      energy: u("u_energy"),
      kick: u("u_kick"),
      glow: u("u_glow"),
      level: u("u_level"),
      reveal: u("u_reveal"),
      rainbow: u("u_rainbow"),
      stops: u("u_stops"),
      colors: [u("u_c0"), u("u_c1"), u("u_c2")],
    };

    const bass = bassMeter();
    const target = (i: number) => {
      const list = props.current.colors;
      // with two colours the third is never shown, so it just follows the first
      return list[i] ?? list[0] ?? [255, 255, 255];
    };
    // colours, glow and brightness glide to new settings instead of jumping
    const current = [0, 1, 2].map((i) => target(i).map((v) => v / 255));
    let glowNow = props.current.glow / 100;
    let rainbowNow = props.current.rainbow ? 1 : 0;
    let level = 1;
    let energy = 0;
    let average = 0;
    let kick = 0;
    let phase = 0;
    let reveal = props.current.still ? 1 : 0;
    let frame = 0;
    let last = performance.now();

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      return width / Math.max(1, canvas.clientWidth);
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const scale = resize();
      const p = props.current;
      const awake = !p.followPlayback || usePlayer.getState().status === "playing";

      for (let i = 0; i < 3; i++) {
        const want = target(i);
        for (let ch = 0; ch < 3; ch++) current[i][ch] += (want[ch] / 255 - current[i][ch]) * 0.06;
        gl.uniform3f(uniforms.colors[i], current[i][0], current[i][1], current[i][2]);
      }
      glowNow += (p.glow / 100 - glowNow) * 0.1;
      rainbowNow += ((p.rainbow ? 1 : 0) - rainbowNow) * 0.06;
      level += ((awake ? 1 : 0.5) - level) * 0.04;

      // the bass, smoothed, makes it swell; a jump above its recent average is a beat
      const raw = p.pulse && !p.still ? bass() : 0;
      energy += (raw - energy) * 0.12;
      average += (raw - average) * 0.02;
      kick = Math.max(kick * 0.88, Math.min(1, Math.max(0, raw - average - 0.05) * 5));

      // laps a second: 0 holds still, the middle goes round in about ten seconds
      const pace = p.still || p.speed <= 0 ? 0 : 0.012 + (p.speed / 100) ** 1.6 * 0.3;
      phase = (phase + dt * pace * (awake ? 1 + energy * 0.8 : 0.35)) % 1000;
      reveal = p.still ? 1 : Math.min(1, reveal + dt / REVEAL_SECONDS);

      gl.uniform2f(uniforms.res, canvas.width, canvas.height);
      gl.uniform1f(uniforms.scale, scale);
      gl.uniform1f(uniforms.radius, p.radius);
      gl.uniform1f(uniforms.phase, phase);
      gl.uniform1f(uniforms.energy, energy);
      gl.uniform1f(uniforms.kick, kick);
      gl.uniform1f(uniforms.glow, glowNow);
      gl.uniform1f(uniforms.level, level);
      gl.uniform1f(uniforms.reveal, 1 - (1 - reveal) ** 3);
      gl.uniform1f(uniforms.rainbow, rainbowNow);
      gl.uniform1f(uniforms.stops, p.colors.length >= 3 ? 3 : 2);
      canvas.dataset.energy = energy.toFixed(3);
      canvas.dataset.phase = phase.toFixed(3);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden data-testid="edge-light" className={cn("pointer-events-none size-full", className)} />;
}
