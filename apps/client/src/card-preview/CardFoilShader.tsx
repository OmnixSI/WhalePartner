import { useEffect, useRef } from "react";

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const fragmentSource = `
precision mediump float;
uniform float uTime;
uniform vec2 uTilt;
uniform sampler2D uFoilMask;
varying vec2 vUv;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

void main() {
  float mask = texture2D(uFoilMask, vUv).r;
  vec2 centered = vUv - 0.5;
  float tiltAmount = clamp(length(uTilt) * 1.8, 0.0, 1.0);
  vec2 diffractionDirection = normalize(vec2(0.72 + uTilt.x * 0.8, 0.56 - uTilt.y * 0.8));
  float viewPhase = dot(uTilt, vec2(17.0, -14.0));
  float phase = dot(centered, diffractionDirection) * 24.0 + viewPhase;
  vec3 rainbow = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.094, 4.189));

  float edge = max(abs(centered.x) * 2.0, abs(centered.y) * 2.0);
  float fresnel = pow(clamp(edge, 0.0, 1.0), 3.4) * (0.2 + tiltAmount * 0.9);
  float grain = 0.5 + 0.5 * sin((vUv.x * 0.78 + vUv.y * 0.62) * 190.0);
  float diffraction = 0.5 + 0.5 * sin(phase * 1.25 + grain * 1.4);

  float drift = sin(uTime * 0.42) * 0.08;
  float sweepOne = dot(vUv, vec2(0.86, 0.5)) - 0.5 - dot(uTilt, vec2(0.16, -0.12)) - drift;
  float sweepTwo = dot(vUv, vec2(0.72, -0.69)) - 0.53 + dot(uTilt, vec2(0.12, 0.16)) + drift * 0.55;
  float glintOne = exp(-pow(sweepOne * 38.0, 2.0));
  float glintTwo = exp(-pow(sweepTwo * 46.0, 2.0));
  float glints = (glintOne + glintTwo * 0.72) * (0.12 + tiltAmount * 0.78 + fresnel * 0.32);

  vec2 cells = floor(vUv * vec2(25.0, 48.0));
  float sparkleSeed = hash21(cells + floor(uTime * 2.0));
  vec2 sparkleCenter = vec2(hash21(cells + vec2(3.0, 17.0)), hash21(cells + vec2(11.0, 5.0))) - 0.5;
  vec2 cellPosition = fract(vUv * vec2(25.0, 48.0)) - 0.5;
  float sparkleDistance = length((cellPosition - sparkleCenter) * vec2(1.0, 1.25));
  float sparkle = step(0.992, sparkleSeed) * (1.0 - smoothstep(0.025, 0.16, sparkleDistance)) * (0.18 + tiltAmount * 0.82);
  float alpha = mask * (0.13 + diffraction * 0.25 + fresnel * 0.28 + glints * 0.32 + sparkle * 0.68);
  vec3 foil = mix(rainbow, vec3(1.0, 0.94, 0.78), clamp((glints + sparkle) * 0.42, 0.0, 0.58));
  gl_FragColor = vec4(foil, clamp(alpha, 0.0, 0.66));
}`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create card foil shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Card foil shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function makeMask(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
      const nx = x / width;
      const ny = y / height;
      const art = nx > 0.08 && nx < 0.92 && ny > 0.12 && ny < 0.88 ? 1 : 0;
      const silhouetteDistance = Math.hypot((nx - 0.5) / 0.37, (ny - 0.5) / 0.43);
      const silhouette = 1 - Math.max(0, Math.min(1, (silhouetteDistance - 0.62) / 0.53));
      const foilPattern = 0.24 + silhouette * 0.62 + silhouette * (0.5 + Math.sin((nx + ny * 0.84) * 46) * 0.5) * 0.14;
      const frame = edge < 7 ? 0.96 - edge * 0.045 : 0;
      const label = y < height * 0.12 || y > height * 0.88 ? 0.3 : 0;
      const value = Math.round(Math.max(art * foilPattern, frame, label) * 255);
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export function CardFoilShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const card = canvas?.closest<HTMLElement>(".card-preview__hero");
    if (!canvas || !card) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) {
      canvas.dataset.shaderState = "unsupported";
      return;
    }

    let program: WebGLProgram | undefined;
    let buffer: WebGLBuffer | null = null;
    let maskTexture: WebGLTexture | null = null;
    let frameId: number | undefined;
    let disposed = false;

    try {
      const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram() ?? undefined;
      if (!program) throw new Error("Unable to create card foil program");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Card foil shader link failed");
      }

      buffer = gl.createBuffer();
      maskTexture = gl.createTexture();
      if (!buffer || !maskTexture) throw new Error("Unable to create card foil resources");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const maskWidth = 128;
      const maskHeight = 256;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, maskWidth, maskHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeMask(maskWidth, maskHeight));
      const timeUniform = gl.getUniformLocation(program, "uTime");
      const tiltUniform = gl.getUniformLocation(program, "uTilt");
      gl.uniform1i(gl.getUniformLocation(program, "uFoilMask"), 0);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const resize = () => {
        if (disposed) return;
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        if (reduceMotion.matches || document.hidden) draw(0);
      };
      const draw = (time: number) => {
        if (disposed) return;
        const tiltX = Number(card.dataset.tiltX) || 0;
        const tiltY = Number(card.dataset.tiltY) || 0;
        gl.useProgram(program!);
        gl.uniform1f(timeUniform, reduceMotion.matches ? 0 : time / 1000);
        gl.uniform2f(tiltUniform, tiltX, tiltY);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!reduceMotion.matches && !document.hidden) frameId = window.requestAnimationFrame(draw);
      };
      const stop = () => {
        if (frameId !== undefined) window.cancelAnimationFrame(frameId);
        frameId = undefined;
      };
      const syncMotion = () => {
        stop();
        if (reduceMotion.matches || document.hidden) draw(0);
        else frameId = window.requestAnimationFrame(draw);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", syncMotion);
      reduceMotion.addEventListener("change", syncMotion);
      resize();
      canvas.dataset.shaderState = "ready";
      syncMotion();

      return () => {
        disposed = true;
        stop();
        observer.disconnect();
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", syncMotion);
        reduceMotion.removeEventListener("change", syncMotion);
        gl.deleteBuffer(buffer);
        gl.deleteTexture(maskTexture);
        if (program) gl.deleteProgram(program);
      };
    } catch (error) {
      canvas.dataset.shaderState = "failed";
      console.warn("Card foil shader unavailable", error);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (maskTexture) gl.deleteTexture(maskTexture);
    }
  }, []);

  return <canvas ref={canvasRef} className="card-preview__foil-shader" data-shader-state="loading" aria-hidden="true" />;
}
