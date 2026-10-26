import { getAnalyser } from "@/player/store";

// Shared bits for the WebGL visuals: a quad that covers the canvas, and how
// loud the low end of the music is.

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  // a lost context reports a failed compile too; that one isn't worth a warning
  if (!gl.isContextLost()) console.warn("A visual's shader didn't compile:", gl.getShaderInfoLog(shader));
  return null;
}

/** links `fragment` to a quad over the whole canvas; draw it with 6 vertices */
export function quadProgram(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  return program;
}

/** a reader for the bass of what's playing right now, from 0 to 1 */
export function bassMeter(): () => number {
  let spectrum: Uint8Array<ArrayBuffer> | null = null;
  return () => {
    const analyser = getAnalyser();
    if (!analyser) return 0;
    if (spectrum?.length !== analyser.frequencyBinCount) spectrum = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(spectrum);
    let level = 0;
    for (let i = 1; i < 12; i++) level += spectrum[i];
    return level / (11 * 255);
  };
}
