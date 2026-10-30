'use strict';

/* Real liquid glass — vanilla JS port of the WebGL renderer from
   github.com/Zqysl/liquid-glass-webgl (MIT).
   Every <canvas data-glass> element becomes a glass panes that samples a
   shared backdrop, gaussian-blurs it and refracts it along its rounded edges. */

const GLASS_VERT = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
v_uv = a_pos * 0.5 + 0.5;
gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const GLASS_BLUR_H = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_canvasSize;
uniform vec2 u_capsuleTopLeft;
uniform vec2 u_imageOffset;
uniform vec2 u_imageDrawSize;
uniform vec2 u_directionPx;
uniform int u_radius;
#define MAX_RADIUS 64
uniform float u_kernel[MAX_RADIUS];
vec3 sampleImage(vec2 uv) {
return texture2D(u_image, clamp(uv, 0.0, 1.0)).rgb;
}
void main() {
vec2 domUv = vec2(v_uv.x, 1.0 - v_uv.y);
vec2 localPx = domUv * u_canvasSize;
vec2 containerPx = u_capsuleTopLeft + localPx;
vec2 uv = (containerPx - u_imageOffset) / u_imageDrawSize;
vec2 dirUv = u_directionPx / u_imageDrawSize;
vec3 res = sampleImage(uv) * u_kernel[0];
vec2 l = uv - dirUv;
vec2 r = uv + dirUv;
for (int i = 1; i < MAX_RADIUS; i++) {
if (i < u_radius) {
float w = u_kernel[i];
res += sampleImage(l) * w;
res += sampleImage(r) * w;
}
l -= dirUv;
r += dirUv;
}
gl_FragColor = vec4(res, 1.0);
}`;

const GLASS_BLUR_V = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_canvasSize;
uniform vec2 u_directionPx;
uniform int u_radius;
#define MAX_RADIUS 64
uniform float u_kernel[MAX_RADIUS];
vec3 sampleTex(vec2 uv) {
return texture2D(u_tex, clamp(uv, 0.0, 1.0)).rgb;
}
void main() {
vec2 uv = v_uv;
vec2 dirUv = u_directionPx / u_canvasSize;
vec3 res = sampleTex(uv) * u_kernel[0];
vec2 l = uv - dirUv;
vec2 r = uv + dirUv;
for (int i = 1; i < MAX_RADIUS; i++) {
if (i < u_radius) {
float w = u_kernel[i];
res += sampleTex(l) * w;
res += sampleTex(r) * w;
}
l -= dirUv;
r += dirUv;
}
gl_FragColor = vec4(res, 1.0);
}`;

const GLASS_COMPOSE = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_blurTex;
uniform vec2 u_canvasSize;
uniform float u_edgeMapStartPx;
uniform float u_edgeMapMaxPx;
uniform float u_borderRadiusPx;
float sdRoundBox(vec2 p, vec2 halfSize, float r) {
r = clamp(r, 0.0, min(halfSize.x, halfSize.y));
vec2 q = abs(p) - (halfSize - vec2(r));
return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec2 roundBoxOutwardNormal(vec2 p, vec2 halfSize, float r) {
float e = 1.0;
float dx = sdRoundBox(p + vec2(e, 0.0), halfSize, r) - sdRoundBox(p - vec2(e, 0.0), halfSize, r);
float dy = sdRoundBox(p + vec2(0.0, e), halfSize, r) - sdRoundBox(p - vec2(0.0, e), halfSize, r);
vec2 g = vec2(dx, dy);
float lg = length(g);
if (lg < 1e-4) return vec2(0.0, 1.0);
return g / lg;
}
float roundBoxOppositeDistance(vec2 p, vec2 halfSize, float r, vec2 n) {
const int STEPS = 16;
const int REFINE = 6;
float d0 = sdRoundBox(p, halfSize, r);
if (d0 >= 0.0) return 0.0;
float t = 1.0;
float lo = 0.0;
float hi = 0.0;
bool foundHi = false;
for (int i = 0; i < STEPS; i++) {
float d = sdRoundBox(p - n * t, halfSize, r);
if (!foundHi) {
if (d > 0.0) {
hi = t;
foundHi = true;
} else {
lo = t;
t += max(1.0, abs(d));
}
}
}
if (!foundHi) {
hi = max(lo + 1.0, length(halfSize) * 4.0);
}
for (int j = 0; j < REFINE; j++) {
float mid = 0.5 * (lo + hi);
float d = sdRoundBox(p - n * mid, halfSize, r);
if (d < 0.0) lo = mid;
else hi = mid;
}
return hi;
}
void main() {
vec2 domUv = vec2(v_uv.x, 1.0 - v_uv.y);
vec2 localPx = domUv * u_canvasSize;
vec2 p = localPx - 0.5 * u_canvasSize;
vec2 halfSize = 0.5 * u_canvasSize;
float r = u_borderRadiusPx;
float sdf = sdRoundBox(p, halfSize, r);
float distIn = max(0.0, -sdf);
float startPx = max(0.001, u_edgeMapStartPx);
float u = clamp((startPx - distIn) / startPx, 0.0, 1.0);
float t = 1.0 - pow(1.0 - u, 0.3333333333);
float q = t * t;
vec2 n = roundBoxOutwardNormal(p, halfSize, r);
float maxDelta = roundBoxOppositeDistance(p, halfSize, r, n);
float cappedMaxDelta = (u_edgeMapMaxPx > 0.0) ? min(maxDelta, u_edgeMapMaxPx) : maxDelta;
vec2 mappedP = p - n * (cappedMaxDelta * q);
vec2 mappedLocalPx = mappedP + 0.5 * u_canvasSize;
vec2 mappedDomUv = mappedLocalPx / u_canvasSize;
vec2 mappedGlUv = vec2(mappedDomUv.x, 1.0 - mappedDomUv.y);
vec3 color = texture2D(u_blurTex, mappedGlUv).rgb;
gl_FragColor = vec4(color, 1.0);
}`;

function glassCompileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function glassCreateProgram(gl, vertSrc, fragSrc) {
  const vs = glassCompileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = glassCompileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

const GLASS_KERNEL_MAX_RADIUS = 64;
function buildGaussianKernel(radiusPx) {
  const r = Math.max(0, radiusPx);
  const radius = Math.min(GLASS_KERNEL_MAX_RADIUS, Math.max(1, Math.floor(r) + 1));
  const sigma = Math.max(r * 0.5, 0.001);
  const kernel = new Float32Array(GLASS_KERNEL_MAX_RADIUS);
  let sum = 0;
  for (let i = 0; i < radius; i++) {
    const x = i;
    const w = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = w;
    sum += i === 0 ? w : 2 * w;
  }
  if (sum > 0) {
    for (let i = 0; i < radius; i++) kernel[i] /= sum;
  }
  return { radius, kernel };
}

function createGlassRenderer(canvas) {
  const glMaybe = canvas.getContext('webgl', {
    alpha: false,
    premultipliedAlpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!glMaybe) throw new Error('WebGL not supported');
  const gl = glMaybe;
  const blurProgramH = glassCreateProgram(gl, GLASS_VERT, GLASS_BLUR_H);
  const blurProgramV = glassCreateProgram(gl, GLASS_VERT, GLASS_BLUR_V);
  const composeProgram = glassCreateProgram(gl, GLASS_VERT, GLASS_COMPOSE);
  const aPos = 0;
  const uImage = gl.getUniformLocation(blurProgramH, 'u_image');
  const uBlurCanvasSize = gl.getUniformLocation(blurProgramH, 'u_canvasSize');
  const uBlurCapsuleTopLeft = gl.getUniformLocation(blurProgramH, 'u_capsuleTopLeft');
  const uBlurImageOffset = gl.getUniformLocation(blurProgramH, 'u_imageOffset');
  const uBlurImageDrawSize = gl.getUniformLocation(blurProgramH, 'u_imageDrawSize');
  const uBlurDirPxH = gl.getUniformLocation(blurProgramH, 'u_directionPx');
  const uBlurRadiusH = gl.getUniformLocation(blurProgramH, 'u_radius');
  const uBlurKernelH = gl.getUniformLocation(blurProgramH, 'u_kernel[0]');
  if (!uImage || !uBlurCanvasSize || !uBlurCapsuleTopLeft || !uBlurImageOffset ||
      !uBlurImageDrawSize || !uBlurDirPxH || !uBlurRadiusH || !uBlurKernelH) {
    throw new Error('Failed to locate blur (H) uniforms');
  }
  const uTempTex = gl.getUniformLocation(blurProgramV, 'u_tex');
  const uBlurCanvasSizeV = gl.getUniformLocation(blurProgramV, 'u_canvasSize');
  const uBlurDirPxV = gl.getUniformLocation(blurProgramV, 'u_directionPx');
  const uBlurRadiusV = gl.getUniformLocation(blurProgramV, 'u_radius');
  const uBlurKernelV = gl.getUniformLocation(blurProgramV, 'u_kernel[0]');
  if (!uTempTex || !uBlurCanvasSizeV || !uBlurDirPxV || !uBlurRadiusV || !uBlurKernelV) {
    throw new Error('Failed to locate blur (V) uniforms');
  }
  const uBlurTex = gl.getUniformLocation(composeProgram, 'u_blurTex');
  const uComposeCanvasSize = gl.getUniformLocation(composeProgram, 'u_canvasSize');
  const uEdgeMapStartPx = gl.getUniformLocation(composeProgram, 'u_edgeMapStartPx');
  const uEdgeMapMaxPx = gl.getUniformLocation(composeProgram, 'u_edgeMapMaxPx');
  const uBorderRadiusPx = gl.getUniformLocation(composeProgram, 'u_borderRadiusPx');
  if (!uBlurTex || !uComposeCanvasSize || !uEdgeMapStartPx || !uEdgeMapMaxPx || !uBorderRadiusPx) {
    throw new Error('Failed to locate compose uniforms');
  }
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('Failed to create buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const imageTex = gl.createTexture();
  if (!imageTex) throw new Error('Failed to create texture');
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  glassTexParams(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  const tempTex = gl.createTexture();
  if (!tempTex) throw new Error('Failed to create temp texture');
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, tempTex);
  glassTexParams(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const tempFbo = gl.createFramebuffer();
  if (!tempFbo) throw new Error('Failed to create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, tempFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const blurTex = gl.createTexture();
  if (!blurTex) throw new Error('Failed to create blur texture');
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, blurTex);
  glassTexParams(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Failed to create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(blurProgramH);
  gl.uniform1i(uImage, 0);
  gl.useProgram(blurProgramV);
  gl.uniform1i(uTempTex, 2);
  gl.useProgram(composeProgram);
  gl.uniform1i(uBlurTex, 1);
  let lastCanvasW = 0;
  let lastCanvasH = 0;
  let sourceW = 0;
  let sourceH = 0;

  function glassTexParams(glx) {
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_S, glx.CLAMP_TO_EDGE);
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_T, glx.CLAMP_TO_EDGE);
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MIN_FILTER, glx.LINEAR);
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MAG_FILTER, glx.LINEAR);
  }

  function setImage(src) {
    sourceW = src.width || src.naturalWidth || 1;
    sourceH = src.height || src.naturalHeight || 1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  function resize(widthCssPx, heightCssPx, dpr) {
    const w = Math.max(1, Math.round(widthCssPx * dpr));
    const h = Math.max(1, Math.round(heightCssPx * dpr));
    if (w === lastCanvasW && h === lastCanvasH) return;
    lastCanvasW = w;
    lastCanvasH = h;
    canvas.width = w;
    canvas.height = h;
  }

  function render(params) {
    const blurRadiusPx = params.blurRadiusPx != null ? params.blurRadiusPx : 12;
    const edgeMapStartPx = params.edgeMapStartPx != null ? params.edgeMapStartPx : 24;
    const edgeMapMaxPx = params.edgeMapMaxPx != null ? params.edgeMapMaxPx : 0;
    const borderRadiusPx = params.borderRadiusPx != null ? params.borderRadiusPx : 0;
    const containerW = params.containerSizePx.x;
    const containerH = params.containerSizePx.y;
    let drawW = containerW;
    let drawH = containerH;
    let offsetX = 0;
    let offsetY = 0;
    if (sourceW > 0 && sourceH > 0 && containerW > 0 && containerH > 0) {
      const scale = Math.max(containerW / sourceW, containerH / sourceH);
      drawW = sourceW * scale;
      drawH = sourceH * scale;
      offsetX = (containerW - drawW) * 0.5;
      offsetY = (containerH - drawH) * 0.5;
    }
    const dpr = params.dpr;
    const kernel = buildGaussianKernel(blurRadiusPx * dpr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(blurProgramH);
    gl.uniform2f(uBlurCanvasSize, canvas.width, canvas.height);
    gl.uniform2f(uBlurCapsuleTopLeft, params.capsuleTopLeftPx.x * dpr, params.capsuleTopLeftPx.y * dpr);
    gl.uniform2f(uBlurImageOffset, offsetX * dpr, offsetY * dpr);
    gl.uniform2f(uBlurImageDrawSize, drawW * dpr, drawH * dpr);
    gl.uniform2f(uBlurDirPxH, 1, 0);
    gl.uniform1i(uBlurRadiusH, kernel.radius);
    gl.uniform1fv(uBlurKernelH, kernel.kernel);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(blurProgramV);
    gl.uniform2f(uBlurCanvasSizeV, canvas.width, canvas.height);
    gl.uniform2f(uBlurDirPxV, 0, 1);
    gl.uniform1i(uBlurRadiusV, kernel.radius);
    gl.uniform1fv(uBlurKernelV, kernel.kernel);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(composeProgram);
    gl.uniform2f(uComposeCanvasSize, canvas.width, canvas.height);
    gl.uniform1f(uEdgeMapStartPx, edgeMapStartPx * dpr);
    gl.uniform1f(uEdgeMapMaxPx, edgeMapMaxPx * dpr);
    gl.uniform1f(uBorderRadiusPx, Math.max(0, borderRadiusPx) * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function dispose() {
    gl.deleteTexture(imageTex);
    gl.deleteTexture(tempTex);
    gl.deleteTexture(blurTex);
    gl.deleteFramebuffer(tempFbo);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(vbo);
    gl.deleteProgram(blurProgramH);
    gl.deleteProgram(blurProgramV);
    gl.deleteProgram(composeProgram);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }

  return { setImage, resize, render, dispose };
}

/* ---------- scene management ---------- */

const Glass = (function () {
  let bgCanvas = null;
  let bgW = 0;
  let bgH = 0;
  let rafPending = false;
  const items = new Map();

  function buildBg(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, w, h);
    // green felt glows (same as the page gradient)
    let g = ctx.createRadialGradient(w * 0.78, -h * 0.08, 0, w * 0.78, -h * 0.08, h * 0.82);
    g.addColorStop(0, 'rgba(14,46,32,0.5)');
    g.addColorStop(1, 'rgba(14,46,32,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    g = ctx.createRadialGradient(0, h * 1.1, 0, 0, h * 1.1, h * 0.71);
    g.addColorStop(0, 'rgba(10,34,24,0.35)');
    g.addColorStop(1, 'rgba(10,34,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // upper-right light source, so the glass has something to refract
    g = ctx.createRadialGradient(w * 0.84, h * 0.12, 0, w * 0.84, h * 0.12, w * 0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.13)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    g = ctx.createRadialGradient(w * 0.06, h * 0.34, 0, w * 0.06, h * 0.34, w * 0.42);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // diagonal light streaks
    const streak = (from, to, a0, a1) => {
      const lg = ctx.createLinearGradient(0, 0, w, h);
      lg.addColorStop(Math.max(0, from - 0.08), 'rgba(255,255,255,0)');
      lg.addColorStop(from, 'rgba(255,255,255,' + a0 + ')');
      lg.addColorStop(from + ((to - from) * 0.5), 'rgba(255,255,255,' + a1 + ')');
      lg.addColorStop(to, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, w, h);
    };
    streak(0.4, 0.56, 0.07, 0.015);
    streak(0.68, 0.86, 0.055, 0.012);
    return c;
  }

  function ensureBg() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (bgCanvas && w === bgW && h === bgH) return;
    bgCanvas = buildBg(w, h);
    bgW = w;
    bgH = h;
    let el = document.getElementById('glass-bg');
    if (!el) {
      el = document.createElement('canvas');
      el.id = 'glass-bg';
      document.body.prepend(el);
    }
    el.width = w;
    el.height = h;
    el.getContext('2d').drawImage(bgCanvas, 0, 0);
    items.forEach((item) => { item.needsImage = true; });
  }

  function supportsWebGL() {
    try {
      const probe = document.createElement('canvas');
      return !!probe.getContext('webgl');
    } catch (e) {
      return false;
    }
  }

  let webglOk = supportsWebGL();

  function refresh() {
    if (!webglOk) return;
    ensureBg();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const containerW = window.innerWidth;
    const containerH = window.innerHeight;
    const canvases = document.querySelectorAll('canvas[data-glass]');
    const seen = new Set();
    canvases.forEach((canvas) => {
      seen.add(canvas);
      if (canvas.dataset.glassFail) return;
      const host = canvas.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const wCss = rect.width;
      const hCss = rect.height;
      if (wCss < 4 || hCss < 4) return;
      let item = items.get(canvas);
      if (!item) {
        let renderer;
        try {
          renderer = createGlassRenderer(canvas);
          renderer.setImage(bgCanvas);
        } catch (e) {
          canvas.dataset.glassFail = '1';
          return;
        }
        item = { renderer, needsImage: false };
        items.set(canvas, item);
      }
      if (item.needsImage) {
        item.renderer.setImage(bgCanvas);
        item.needsImage = false;
      }
      item.renderer.resize(wCss, hCss, dpr);
      item.renderer.render({
        containerSizePx: { x: containerW, y: containerH },
        capsuleTopLeftPx: { x: rect.left, y: rect.top },
        dpr,
        blurRadiusPx: 18,
        edgeMapStartPx: Math.max(18, Math.min(wCss, hCss) * 0.24),
        edgeMapMaxPx: 0,
        borderRadiusPx: 22,
      });
    });
    items.forEach((item, canvas) => {
      if (!seen.has(canvas)) {
        item.renderer.dispose();
        items.delete(canvas);
      }
    });
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      refresh();
    });
  }

  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule);
  const bodyRO = new ResizeObserver(schedule);
  document.addEventListener('DOMContentLoaded', () => bodyRO.observe(document.body));

  return { refresh: schedule };
})();

window.Glass = Glass;
