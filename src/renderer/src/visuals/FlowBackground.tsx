import { useEffect, useRef } from "react";
import { bassMeter, quadProgram } from "./gl";
import type { RGB } from "./palette";

// A slowly flowing field of the cover's colours, drawn with WebGL. Layers of
// warped noise mix four colours; the bass of the music makes it breathe.

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = turn * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 1.6;
  float t = u_time * 0.045;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 2.6 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p + 2.2 * r + u_energy * 0.35);

  vec3 col = mix(u_c0, u_c1, clamp(f * f * 2.4, 0.0, 1.0));
  col = mix(col, u_c2, clamp(length(q) * 0.9, 0.0, 1.0));
  col = mix(col, u_c3, clamp(r.x * r.x * 1.4, 0.0, 1.0));
  col *= 0.62 + 0.55 * f + u_energy * 0.22;

  float vignette = smoothstep(1.35, 0.2, length((uv - 0.5) * vec2(1.25, 1.0)));
  col *= mix(0.42, 1.0, vignette);
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.025;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** draws at half resolution; the soft upscale suits a blurry background */
const SCALE = 0.5;

export function FlowBackground({ colors, className }: { colors: RGB[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef<RGB[]>(colors);
  target.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!canvas || !gl) return;
    const program = quadProgram(gl, FRAGMENT);
    if (!program) return;

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_res");
    const uTime = u("u_time");
    const uEnergy = u("u_energy");
    const uColors = [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3")];

    // colours glide to the new cover instead of jumping
    const current = target.current.map((c) => c.map((v) => v / 255));
    let energy = 0;
    const bass = bassMeter();
    let frame = 0;
    const started = performance.now();

    const resize = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth * SCALE));
      const height = Math.max(1, Math.round(canvas.clientHeight * SCALE));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      resize();
      const goal = target.current;
      for (let i = 0; i < 4; i++) {
        const want = goal[i % goal.length] ?? [40, 40, 60];
        for (let ch = 0; ch < 3; ch++) current[i][ch] += (want[ch] / 255 - current[i][ch]) * 0.025;
        gl.uniform3f(uColors[i], current[i][0], current[i][1], current[i][2]);
      }
      // the low end of the spectrum, smoothed, drives the pulse
      energy += (bass() - energy) * 0.12;
      canvas.dataset.energy = energy.toFixed(3);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - started) / 1000);
      gl.uniform1f(uEnergy, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  const [a, b, c] = colors.map((col) => `rgb(${col.join(",")})`);
  return (
    <div className={className} style={{ background: `radial-gradient(circle at 20% 20%, ${a}, transparent 60%), radial-gradient(circle at 80% 70%, ${b}, transparent 55%), ${c ?? "#111"}` }}>
      <canvas ref={canvasRef} className="size-full" data-testid="flow-background" />
    </div>
  );
}
