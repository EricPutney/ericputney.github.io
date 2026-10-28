/* The local potential in 3D (final round, 2026-10-28). WebGL2: a ray-marched volume of the ClearPotential potential on a 64^3 grid
   (layers of equal depth, glow, flat slices). WebGL1 fallback: six mesh sheets. Depends on assets/js/demos.js (window.EPDemos).
   Renders only while something moves or after input; the loop rests when nothing changes.
   Touch: vertical swipes always scroll the page (touch-action: pan-y); the model turns on sideways drags only. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, hexRGB = E.hexRGB, smooth = E.smooth, label = E.label, textW = E.textW, setOut = E.setOut;
  var TAU = Math.PI * 2, DEG = Math.PI / 180;
  // matplotlib viridis at 17 points (the default colour map)
  var VIRIDIS = [[0.267, 0.005, 0.329], [0.282, 0.095, 0.417], [0.279, 0.175, 0.483], [0.259, 0.252, 0.525], [0.23, 0.322, 0.546], [0.199, 0.388, 0.555], [0.173, 0.449, 0.558], [0.149, 0.508, 0.557], [0.128, 0.567, 0.551], [0.121, 0.626, 0.533], [0.158, 0.684, 0.502], [0.246, 0.739, 0.452], [0.369, 0.789, 0.383], [0.516, 0.831, 0.294], [0.678, 0.864, 0.19], [0.846, 0.887, 0.1], [0.993, 0.906, 0.144]];
  // slate: Fig. 6's single-hue ramp (OKLCH hue 252, chroma 0.036 rising to 0.050 at t = 0.45 and falling to 0.014, gamut-clipped), nine stops from deep to shallow, re-spaced for this figure's picture:
  // lightness 0.38 to 0.80 (light page) and 0.42 to 0.90 (dark page, chroma x 0.9), so both ends stay at least 1.7:1 against the stage (Fig. 6's own ends sat at 1.03:1 and 1.12:1)
  var SLATE = { light: [[52, 68, 85], [65, 82, 102], [77, 97, 119], [90, 112, 137], [105, 128, 153], [124, 143, 164], [144, 159, 176], [163, 174, 187], [183, 190, 199]],
    dark: [[64, 78, 95], [79, 95, 114], [94, 113, 133], [110, 130, 154], [128, 148, 172], [149, 167, 186], [171, 185, 201], [193, 204, 216], [216, 223, 230]] };

  function fetchJSON(url) { return fetch(url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function whenNear(fig, cb) {
    if (!('IntersectionObserver' in window)) { cb(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); cb(); } }, { rootMargin: '700px 0px' });
    io.observe(fig);
  }
  function note(fig, text) { var n = fig.querySelector('.demo__note'); if (n) n.textContent = text; }
  function enable(fig, on) { fig.querySelectorAll('.demo__controls input, .demo__controls button').forEach(function (el) { el.disabled = !on; }); }
  function toggle(btn, cb) { if (!btn) return; btn.addEventListener('click', function () { var on = btn.getAttribute('aria-checked') !== 'true'; btn.setAttribute('aria-checked', on ? 'true' : 'false'); cb(on); }); }
  function seg(fig, attr, cb) {   // a radio group of buttons carrying attr
    var btns = fig.querySelectorAll('[' + attr + ']');
    btns.forEach(function (b) { b.addEventListener('click', function () { btns.forEach(function (o) { o.setAttribute('aria-checked', o === b ? 'true' : 'false'); }); cb(b.getAttribute(attr)); }); });
  }
  function b64(s) { var bin = atob(s), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u; }
  function ramp(samples) {   // 256 RGB bytes from a list of colour samples
    var out = new Uint8Array(256 * 3), m = samples.length - 1;
    for (var i = 0; i < 256; i++) { var t = i / 255 * m, k = Math.min(m - 1, Math.floor(t)), f = t - k; for (var c = 0; c < 3; c++) out[i * 3 + c] = Math.round(255 * (samples[k][c] * (1 - f) + samples[k + 1][c] * f)); }
    return out;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtPhi(v) { return v.toFixed(2).replace('-', '−') + ' × 10⁵ (km/s)²'; }   // the exact value, for the slider's own output
  // the depth relative to the Sun, in words: [number, unit, words]; the number is rounded to 100 (km/s)^2
  function depthWords(v, phiSun, here) {
    var d = Math.round((v - phiSun) * 1e5 / 100) * 100;
    if (d === 0) return ['', '', here ? 'the same depth as the Sun' : 'at the Sun’s own depth'];
    return [Math.abs(d).toLocaleString('en-US'), '(km/s)²', (d < 0 ? 'deeper' : 'shallower') + ' than the Sun'];
  }
  function segHitsRect(ax, ay, bx, by, r) {   // does the segment a-b touch the rectangle r = {x0, y0, x1, y1}? (Liang-Barsky)
    var t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay, p = [-dx, dx, -dy, dy], q = [ax - r.x0, r.x1 - ax, ay - r.y0, r.y1 - ay];
    for (var i = 0; i < 4; i++) { if (p[i] === 0) { if (q[i] < 0) return false; } else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } } }
    return true;
  }

  /* ---------- small matrix kit (column-major) ---------- */
  function perspective(fov, aspect, near, far, sx, sy) {   // sx, sy: the picture is shifted right and up by this much (in NDC), a lens shift
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -sx, -sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function viewFromBasis(eye, r, u, f) {   // camera right, up, forward (unit) -> view matrix
    return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]), 1]);
  }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function xform(m, p) { var w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]; return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w, (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w, w]; }
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* ---------- shaders: the volume (WebGL2) ---------- */
  var VS2 = '#version 300 es\nin vec2 aP; out vec2 vUV; void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }';
  var FS2 = '#version 300 es\nprecision highp float; precision highp sampler3D;\n' +
    'uniform sampler3D uVol; uniform sampler2D uCmap; uniform vec3 uEye, uRight, uUp, uFwd; uniform vec2 uShift, uPix; uniform float uTan, uAspect, uR, uLineK;\n' +
    'uniform float uPhiMin, uPhiMax, uCLo, uCHi, uIso, uLevelStep, uStep, uMid, uPhiLo, uMidFill, uFlash, uGhost, uFog, uLift, uRimK, uCutLo, uCutHi, uSatLo, uGlowLift; uniform int uStyle, uSlice, uMarch;\n' +
    'uniform vec4 uClip; uniform float uSlicePos; uniform vec3 uBg, uInk, uRim;\n' +
    'in vec2 vUV; out vec4 o;\n' +
    'float phiAt(vec3 p){ vec2 t = texture(uVol, p / (2.0 * uR) + 0.5).rg; return mix(uPhiMin, uPhiMax, t.r * 0.99610895 + t.g * 0.00389105); }\n' +
    'vec3 gradAt(vec3 p){ float e = 0.14; return vec3(phiAt(p + vec3(e,0,0)) - phiAt(p - vec3(e,0,0)), phiAt(p + vec3(0,e,0)) - phiAt(p - vec3(0,e,0)), phiAt(p + vec3(0,0,e)) - phiAt(p - vec3(0,0,e))); }\n' +
    'vec3 cmap(float phi){ return texture(uCmap, vec2(clamp((phi - uCLo) / (uCHi - uCLo), 0.0, 1.0), 0.5)).rgb; }\n' +
    'float cov(float distPx, float widthPx){ return clamp(0.5 * widthPx + 0.5 - distPx, 0.0, 1.0); }   // anti-aliased line coverage from the distance in pixels\n' +
    'vec2 gNdc; vec3 pxS1, pxS2;   // the pixel under this fragment (NDC) and the two steps, right and up, that one pixel makes on the plane being drawn\n' +
    'vec3 rayAt(vec2 ndc){ vec2 q = ndc - uShift; return normalize(uFwd + uRight * (q.x * uTan * uAspect) + uUp * (q.y * uTan)); }\n' +
    'void planeSteps(vec3 p, vec3 n){ float h = dot(p - uEye, n); vec3 d1 = rayAt(gNdc + vec2(uPix.x, 0.0)), d2 = rayAt(gNdc + vec2(0.0, uPix.y)); float a1 = dot(d1, n), a2 = dot(d2, n);\n' +
    '  pxS1 = abs(a1) > 1e-4 ? uEye + d1 * (h / a1) - p : vec3(0.0); pxS2 = abs(a2) > 1e-4 ? uEye + d2 * (h / a2) - p : vec3(0.0); }\n' +
    'float perPx(vec3 g){ return max(length(vec2(dot(g, pxS1), dot(g, pxS2))), 1e-7); }   // change of a field with gradient g across one pixel of that plane\n' +
    'float levelPx(float phi, float gp){ float f = (phi - uPhiLo) / uLevelStep; f -= floor(f); return min(f, 1.0 - f) * uLevelStep / gp; }   // pixels to the nearest published level\n' +
    'vec3 shade(vec3 base, vec3 n, vec3 d, float dist, float rimAmt, float edge){ vec3 L = normalize(-0.42 * uRight + 0.52 * uUp - 0.74 * uFwd); if (dot(n, d) > 0.0) n = -n;\n' +
    '  float k = max(dot(n, L), 0.0); float f = max(dot(n, uUp), 0.0); vec3 c = base * (uLift + 0.50 * k + 0.14 * f);\n' +
    '  float rim = pow(1.0 - clamp(dot(n, -d), 0.0, 1.0), 2.5); c = mix(c, uRim, clamp(uRimK * rimAmt * (rim + 0.9 * edge), 0.0, 0.9));\n' +
    '  float cue = clamp((dist - max(length(uEye) - uR, 0.0)) / (2.0 * uR), 0.0, 1.0); return mix(c, uBg, uFog * cue); }\n' +
    'vec3 slabColor(vec3 p, vec3 n){ planeSteps(p, n); float phi = phiAt(p); float gp = perPx(gradAt(p) / 0.28); vec3 c = cmap(phi); c = mix(c, uInk, 0.7 * cov(levelPx(phi, gp), 1.5 * uLineK));\n' +
    '  float dz = abs(p.z - uMid) / perPx(vec3(0.0, 0.0, 1.0)); float dash = step(0.5, fract((uSlice == 3 ? p.y : p.x) * 2.5)); return mix(c, uInk, uSlice == 1 ? 0.0 : 0.75 * dash * cov(dz, 1.2 * uLineK)); }\n' +
    'void main(){\n' +
    '  gNdc = vUV * 2.0 - 1.0; vec2 uv = gNdc - uShift; vec3 d = normalize(uFwd + uRight * (uv.x * uTan * uAspect) + uUp * (uv.y * uTan));\n' +
    '  float b = dot(uEye, d); float c = dot(uEye, uEye) - uR * uR; float h = b * b - c; if (h < 0.0) { o = vec4(uBg, 1.0); return; }\n' +
    '  float sq = sqrt(h); float t0 = -b - sq, t1 = -b + sq; if (t1 <= 0.0) { o = vec4(uBg, 1.0); return; } t0 = max(t0, 0.0);\n' +
    '  bool onCut = false;\n' +
    '  if (uClip.w < 1.0e8) { float dn = dot(d, uClip.xyz); float en = dot(uEye, uClip.xyz) - uClip.w;\n' +
    '    if (abs(dn) < 1e-6) { if (en > 0.0) { o = vec4(uBg, 1.0); return; } }\n' +
    '    else { float tp = -en / dn; if (en > 0.0) { if (dn >= 0.0) { o = vec4(uBg, 1.0); return; } if (tp > t0) { t0 = tp; onCut = true; } } else if (dn > 0.0) t1 = min(t1, tp); }\n' +
    '    if (t0 >= t1) { o = vec4(uBg, 1.0); return; } }\n' +
    '  vec3 slabN = uSlice == 1 ? vec3(0,0,1) : (uSlice == 2 ? vec3(0,1,0) : vec3(1,0,0));\n' +
    '  float ts = -1.0; if (uSlice > 0) { vec3 n = slabN; float dn = dot(d, n); if (abs(dn) > 1e-6) { float t = (uSlicePos - dot(uEye, n)) / dn; if (t > t0 && t < t1) ts = t; } }\n' +
    '  float tm = -1.0; if (abs(d.z) > 1e-6) { float t = (uMid - uEye.z) / d.z; if (t > t0 && t < t1) tm = t; }\n' +
    '  vec3 col = uBg; float hit = -1.0; vec3 accum = vec3(0.0); float acc = 0.0;\n' +
    '  if (uMarch == 1 && uStyle == 0) {   // the picked layer as a lit, rimmed shell; the published layers as faint ghosts on the way to it\n' +
    '    float t = t0; float phiPrev = phiAt(uEye + d * t); float prevT = t; t += uStep; vec3 cacc = vec3(0.0); float aacc = 0.0, gacc = 0.0;\n' +
    '    for (int i = 0; i < 320; i++) { if (prevT >= t1 || aacc > 0.96) break; float tc = min(t, t1); vec3 p = uEye + d * tc; float phi = phiAt(p);\n' +
    '      bool chosen = (phi - uIso) * (phiPrev - uIso) <= 0.0; float kp = floor((phiPrev - uPhiLo) / uLevelStep), kn = floor((phi - uPhiLo) / uLevelStep); bool ghost = uGhost > 0.0 && kp != kn && gacc < 0.4;\n' +
    '      if (chosen || ghost) { float L = chosen ? uIso : uPhiLo + max(kp, kn) * uLevelStep; float a = prevT, bb = tc; for (int k = 0; k < 4; k++) { float m = 0.5 * (a + bb); if ((phiAt(uEye + d * m) - L) * (phiPrev - L) <= 0.0) bb = m; else a = m; } float th = 0.5 * (a + bb); vec3 ph = uEye + d * th;\n' +
    '        vec3 nn = normalize(gradAt(ph)); float edge = chosen ? 1.0 - smoothstep(0.0, 0.10, uR - length(ph)) : 0.0; vec3 cc = shade(cmap(L), nn, d, th, chosen ? 1.0 : 0.0, edge); float al;\n' +
    '        if (chosen) { cc = mix(cc, vec3(1.0), 0.32 * uFlash); al = 1.0; } else { al = uGhost; gacc += al; }\n' +
    '        cacc += (1.0 - aacc) * al * cc; aacc += (1.0 - aacc) * al; if (chosen) { hit = th; break; } }\n' +
    '      phiPrev = phi; prevT = tc; t += uStep; }\n' +
    '    col = cacc + (1.0 - aacc) * uBg; if (hit < 0.0 && aacc > 0.5) hit = prevT;\n' +
    '  } else if (uMarch == 1 && uStyle == 1) { float t = t0 + 0.5 * uStep;   // glow: a thin emissive sheet around the picked layer\n' +
    '    for (int i = 0; i < 320; i++) { if (t > t1 || acc > 0.97) break; vec3 p = uEye + d * t; float phi = phiAt(p); float w = exp(-pow((phi - uIso) / 0.011, 2.0)); float a = w * 0.30 * (uStep / 0.05);\n' +
    '      vec3 n = normalize(gradAt(p)); float lit = 0.5 + 0.5 * abs(dot(n, normalize(-0.42 * uRight + 0.52 * uUp - 0.74 * uFwd))); float cue = clamp((t - max(length(uEye) - uR, 0.0)) / (2.0 * uR), 0.0, 1.0);\n' +
    '      accum += (1.0 - acc) * a * mix(mix(cmap(phi), uRim, uGlowLift) * (0.7 + 0.6 * lit), uBg, 0.35 * cue); acc += (1.0 - acc) * a; t += uStep; }\n' +
    '    col = accum + (1.0 - acc) * uBg; if (acc > 0.5) hit = t; }\n' +
    '  if (tm > 0.0 && (hit < 0.0 || tm < hit) && uSlice == 0) { vec3 pm = uEye + d * tm; float rho = length(pm.xy); float ring = 1.0 - smoothstep(0.0, 0.07, abs(rho - uR));\n' +
    '    float fogm = clamp(tm / (2.0 * uR), 0.0, 1.0); col = mix(col, uInk, (uMidFill + 0.8 * ring) * (1.0 - 0.5 * fogm)); }\n' +
    '  if (ts > 0.0 && (hit < 0.0 || ts < hit)) col = mix(col, slabColor(uEye + d * ts, slabN), 0.94);\n' +
    '  if (onCut) { vec3 pc = uEye + d * t0; planeSteps(pc, uClip.xyz); float phi = phiAt(pc); float gp = perPx(gradAt(pc) / 0.28);\n' +
    '    float deep = 1.0 - clamp((phi - uIso) / gp + 0.5, 0.0, 1.0);   // 1 on the deeper side of the picked layer, with a one-pixel edge\n' +
    '    vec3 fc = cmap(phi); vec3 fm = mix(vec3(dot(fc, vec3(0.299, 0.587, 0.114))), fc, mix(uSatLo, 1.0, deep));   // the shallower side is muted, so the deeper side stands out\n' +
    '    col = mix(col, mix(uBg, fm, 0.92), mix(uCutLo, uCutHi, deep));\n' +
    '    col = mix(col, uInk, 0.62 * cov(levelPx(phi, gp), 1.4 * uLineK));\n' +
    '    float dz = abs(pc.z - uMid) / perPx(vec3(0.0, 0.0, 1.0)); col = mix(col, uInk, 0.7 * step(0.5, fract(pc.x * 2.5)) * cov(dz, 1.2 * uLineK));   // the Galactic plane, dashed\n' +
    '    float dp = abs(phi - uIso) / gp; col = mix(col, uRim, 0.95 * cov(dp, 5.2 * uLineK)); col = mix(col, mix(cmap(uIso), uRim, 0.12), cov(dp, 2.6 * uLineK)); }   // the picked layer: a contrasting outline round a core in its own colour\n' +
    '  o = vec4(col, 1.0); }';
  var VSQ = '#version 300 es\nin vec2 aP; out vec2 vUV; void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }';
  var FSQ = '#version 300 es\nprecision mediump float; uniform sampler2D uTex; uniform vec2 uUV, uMax; in vec2 vUV; out vec4 o; void main(){ o = texture(uTex, min(vUV * uUV, uMax)); }';   // the volume pass may fill only a corner of its texture (the quick pass while things move)
  // the slice map: drawn at device-pixel resolution in the corner of the canvas; hardware trilinear values, isolines with a pixel-width falloff
  var FSI = '#version 300 es\nprecision highp float; precision highp sampler3D;\n' +
    'uniform sampler3D uVol; uniform sampler2D uCmap; uniform float uPhiMin, uPhiMax, uCLo, uCHi, uR, uPhiLo, uLevelStep, uSlicePos, uLineW; uniform int uPlane; uniform vec3 uBg, uInk;\n' +
    'in vec2 vUV; out vec4 o;\n' +
    'float phiAt(vec3 p){ vec2 t = texture(uVol, p / (2.0 * uR) + 0.5).rg; return mix(uPhiMin, uPhiMax, t.r * 0.99610895 + t.g * 0.00389105); }\n' +
    'void main(){ float a = (vUV.x * 2.0 - 1.0) * uR, b = (vUV.y * 2.0 - 1.0) * uR;\n' +
    '  vec3 p = uPlane == 1 ? vec3(a, b, uSlicePos) : (uPlane == 2 ? vec3(a, uSlicePos, b) : vec3(uSlicePos, a, b));\n' +
    '  float phi = phiAt(p); float gl = max(length(vec2(dFdx(phi), dFdy(phi))), 1e-7);   // potential change per device pixel\n' +
    '  float rho = length(vec2(a, b)), rd = sqrt(max(uR * uR - uSlicePos * uSlicePos, 0.0)); float cover = clamp((rd - rho) / max(fwidth(rho), 1e-6) + 0.5, 0.0, 1.0);\n' +
    '  vec3 col = texture(uCmap, vec2(clamp((phi - uCLo) / (uCHi - uCLo), 0.0, 1.0), 0.5)).rgb;\n' +
    '  float f = (phi - uPhiLo) / uLevelStep; f -= floor(f); float d = min(f, 1.0 - f) * uLevelStep / gl;   // distance to the nearest published level in device pixels\n' +
    '  col = mix(col, uInk, 0.72 * clamp(0.5 * uLineW + 0.5 - d, 0.0, 1.0));\n' +
    '  o = vec4(mix(uBg, col, cover), 1.0); }';

  /* ---------- shaders: the mesh fallback (WebGL1) ---------- */
  var VS1 = 'attribute vec3 aPos; attribute vec3 aNrm; uniform mat4 uMVP; uniform mat4 uMV; uniform float uScale; varying vec3 vN; varying vec3 vP; varying float vD;' +
    'void main(){ vec3 p = aPos * uScale; vec4 mv = uMV * vec4(p, 1.0); vP = p; vD = -mv.z; vN = normalize(mat3(uMV[0].xyz, uMV[1].xyz, uMV[2].xyz) * aNrm); gl_Position = uMVP * vec4(p, 1.0); }';
  var FS1 = 'precision mediump float; uniform vec3 uColor; uniform vec3 uBg; uniform float uAlpha; uniform vec4 uClip; uniform vec3 uLight; uniform vec2 uDepth; uniform float uFlat; varying vec3 vN; varying vec3 vP; varying float vD;' +
    'void main(){ if (dot(vP, uClip.xyz) > uClip.w) discard; if (uFlat > 0.5) { gl_FragColor = vec4(uColor, uAlpha); return; }' +
    ' vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; float d = max(dot(n, uLight), 0.0); float f = max(dot(n, vec3(-0.35, -0.25, 0.9)), 0.0); float shade = 0.40 + 0.50 * d + 0.14 * f;' +
    ' float cue = clamp((vD - uDepth.x) / (uDepth.y - uDepth.x), 0.0, 1.0); gl_FragColor = vec4(mix(uColor * shade, uBg, 0.30 * cue), uAlpha); }';

  function compile(gl, vs, fs) {
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function demoPotential3D() {
    var fig = document.getElementById('demo-potential3d'); if (!fig) return;
    var stage = fig.querySelector('.demo__stage'), glc = fig.querySelector('canvas');
    var ov = document.createElement('canvas'); ov.className = 'p3d-overlay'; ov.setAttribute('aria-hidden', 'true'); stage.appendChild(ov);
    var S = E.makeCanvas(ov), g = S.ctx;
    var ctx = { fig: fig, stage: stage, glc: glc, ov: ov, S: S, g: g, coarse: matchMedia('(pointer: coarse)').matches };
    var gl2 = null; try { gl2 = glc.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false }); } catch (e) { gl2 = null; }
    if (gl2) { try { volumeRenderer(ctx, gl2); return; } catch (e) { note(fig, 'The volume view could not start (' + e.message + '); showing the surfaces instead.'); } }
    var gl1 = null; try { gl1 = glc.getContext('webgl', { antialias: true, alpha: false, depth: true }) || glc.getContext('experimental-webgl'); } catch (e) { gl1 = null; }
    if (gl1) { meshRenderer(ctx, gl1); return; }
    note(fig, 'This figure needs WebGL, which this browser has turned off.'); enable(fig, false);
    var run0 = E.loop(ov, function () {}, function () { g.fillStyle = C.surface; g.fillRect(0, 0, S.W, S.H); label(g, 'WebGL is off in this browser', 12, 20, { size: 12, color: C.text2 }); return false; });
    S.onresize = run0.redraw;
  }

  /* =====================================================================
     The volume renderer (WebGL2): ray marching over the 64^3 grid
     ===================================================================== */
  function volumeRenderer(ctx, gl) {
    var fig = ctx.fig, stage = ctx.stage, glc = ctx.glc, ov = ctx.ov, S = ctx.S, g = ctx.g, coarse = ctx.coarse;
    var q = function (s) { return fig.querySelector(s); };
    var rangeEl = q('[data-ctl="level"]'), rangeName = q('[data-slider-name]'), outLevel = q('[data-out="level"]'), outNum = q('[data-out="num"]'), outUnit = q('[data-out="unit"]'), outRel = q('[data-out="rel"]');
    var cutBtn = q('[data-ctl="cut"]'), planeSeg = q('[data-group="plane"]'), styleSeg = q('[data-group="style"]'), capO = q('[data-cap="orbit"]'), capS = q('[data-cap="slice"]');
    var home = document.createElement('button'); home.type = 'button'; home.className = 'button button--small p3d-home'; home.textContent = 'Reset view'; home.hidden = true; stage.appendChild(home);

    var progV = compile(gl, VS2, FS2), progQ = compile(gl, VSQ, FSQ), progI = compile(gl, VSQ, FSI);
    var U = {}; ['uVol', 'uCmap', 'uEye', 'uRight', 'uUp', 'uFwd', 'uShift', 'uPix', 'uTan', 'uAspect', 'uR', 'uLineK', 'uPhiMin', 'uPhiMax', 'uCLo', 'uCHi', 'uIso', 'uLevelStep', 'uStep', 'uMid', 'uPhiLo', 'uMidFill', 'uFlash', 'uGhost', 'uFog', 'uLift', 'uRimK', 'uCutLo', 'uCutHi', 'uSatLo', 'uGlowLift', 'uStyle', 'uSlice', 'uMarch', 'uClip', 'uSlicePos', 'uBg', 'uInk', 'uRim'].forEach(function (n) { U[n] = gl.getUniformLocation(progV, n); });
    var UI = {}; ['uVol', 'uCmap', 'uPhiMin', 'uPhiMax', 'uCLo', 'uCHi', 'uR', 'uPhiLo', 'uLevelStep', 'uSlicePos', 'uLineW', 'uPlane', 'uBg', 'uInk'].forEach(function (n) { UI[n] = gl.getUniformLocation(progI, n); });
    var UQ = { tex: gl.getUniformLocation(progQ, 'uTex'), uv: gl.getUniformLocation(progQ, 'uUV'), max: gl.getUniformLocation(progQ, 'uMax') };
    var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPV = gl.getAttribLocation(progV, 'aP'), aPQ = gl.getAttribLocation(progQ, 'aP'), aPI = gl.getAttribLocation(progI, 'aP');
    var volTex = gl.createTexture(), cmapTex = { viridis: null, slate: null }, cmapRGB = {}, fbo = { fb: null, tex: null, w: 0, h: 0 };

    function makeCmap(name, bytes) { if (cmapTex[name]) gl.deleteTexture(cmapTex[name]); var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); cmapTex[name] = t; cmapRGB[name] = bytes; }
    function buildCmaps() {
      makeCmap('viridis', ramp(VIRIDIS));
      makeCmap('slate', ramp(SLATE[C.dark ? 'dark' : 'light'].map(function (c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; })));
    }
    buildCmaps();

    /* ---------- state ---------- */
    var D = null, vol = null, N = 64, R = 3.8, PHI_MIN = -1.9, PHI_MAX = -1.32, LVL = [], LVL_STEP = 0.04, PHI_SUN = -1.566, MID_Z = -0.0208, PHI_LO = -1.85, CLO = -1.86, CHI = -1.36, UI_LO = -1.86, UI_HI = -1.36, EXT = null;
    var PAD = 0.001;   // the slider stops this far inside the grid's extremes (0.2 % of its span), so its end layers still show a cap of about 0.3 kpc radius
    var view = 'orbit', style = 'shells', cmapName = 'viridis', plane = 2, cut = true;
    var iso = -1.57, slicePos = 0, flash = 0;
    var REST_CUT = [-118 * DEG, 20 * DEG], REST_FULL = [-128 * DEG, 22 * DEG], SWING = 38 * DEG, PMIN = -12 * DEG, PMAX = 62 * DEG;   // resting views (yaw, pitch), the arrival swing, the pitch limits
    var yaw = RM ? REST_CUT[0] : REST_CUT[0] - SWING, pitch = REST_CUT[1], vyaw = 0, vpitch = 0, camDist = 15.5, camSX = 0, camSY = 0;
    var lay = 0, layGoal = 0;   // 0: the ball fills the stage; 1: the slice layout (the ball sits lower left, the map takes the top right)
    var intro = null, sweep = null, tween = null, touched = false, hint = 1, drag = null, scrub = null, introDone = false;
    var bg = [1, 1, 1], ink = [0.5, 0.5, 0.5], rimC = [0, 0, 0], eye = [0, 0, 0], basis = null, MVP = null, insetBox = null, insetHover = null, layerPt = null, layerKey = NaN;

    function readTheme() { var c = hexRGB(C.surface); bg = [c[0] / 255, c[1] / 255, c[2] / 255]; var k = hexRGB(C.text2); ink = [k[0] / 255, k[1] / 255, k[2] / 255]; var r = hexRGB(C.text); rimC = [r[0] / 255, r[1] / 255, r[2] / 255]; buildCmaps(); glDirty = true; }
    readTheme();
    function fitGL() { var cw = Math.round(S.W * S.dpr), ch = Math.round(S.H * S.dpr); if (glc.width !== cw || glc.height !== ch) { glc.width = cw; glc.height = ch; } }
    // the volume pass draws into a texture the size of the canvas; while things move it fills only a part of it (half the device resolution on dense screens, 0.7 on touch screens),
    // and once everything has been still for a moment it is drawn once more at full device resolution. The slice view is cheap and always full.
    var crisp = RM, crispT = 0, rw = 8, rh = 8;
    function lowScale() { return S.dpr > 1.5 ? 0.5 : (coarse ? 0.7 : 1); }
    function curScale() { return (view === 'slice' || crisp) ? 1 : lowScale(); }
    function ensureFBO() {
      var w = Math.max(8, glc.width), h = Math.max(8, glc.height);
      if (fbo.fb && fbo.w === w && fbo.h === h) return;
      if (!fbo.fb) { fbo.fb = gl.createFramebuffer(); fbo.tex = gl.createTexture(); }
      gl.bindTexture(gl.TEXTURE_2D, fbo.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      fbo.w = w; fbo.h = h;
    }
    function build(data) {
      D = data; R = D.radius_kpc || 3.8; PHI_MIN = D.phi_min; PHI_MAX = D.phi_max; PHI_SUN = D.phi_sun; LVL = D.levels_paper || []; LVL_STEP = LVL.length > 1 ? Math.abs(LVL[1] - LVL[0]) : 0.04;
      PHI_LO = LVL.length ? Math.min.apply(null, LVL) : -1.85; MID_Z = -(D.sun_galactocentric_kpc ? D.sun_galactocentric_kpc[2] : 0.0208);
      vol = decodeGrid(D); N = D.n;
      var rg = new Uint8Array(N * N * N * 2); for (var vi = 0, vn = N * N * N; vi < vn; vi++) { rg[2 * vi] = vol[vi] >> 8; rg[2 * vi + 1] = vol[vi] & 255; }   // 16-bit values as two 8-bit channels; hardware trilinear filtering keeps them additive
      gl.bindTexture(gl.TEXTURE_3D, volTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, N, N, N, 0, gl.RG, gl.UNSIGNED_BYTE, rg);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      // the slider's range is the grid's own: the extremes of the field inside the ball (the two end layers are small caps at the sphere's edge)
      EXT = ballExtremes(); CLO = EXT[0]; CHI = EXT[1]; UI_LO = CLO + PAD; UI_HI = CHI - PAD;
      iso = PHI_SUN;   // the default layer is exactly the Sun's own
      syncSlider(); readouts();
    }
    function phiAt(x, y, z) {   // trilinear sample of the grid, kpc from the Sun
      if (!vol) return NaN;
      var fx = (x + R) / (2 * R) * N - 0.5, fy = (y + R) / (2 * R) * N - 0.5, fz = (z + R) / (2 * R) * N - 0.5;
      var i0 = Math.max(0, Math.min(N - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(N - 2, Math.floor(fy))), k0 = Math.max(0, Math.min(N - 2, Math.floor(fz)));
      var a = Math.max(0, Math.min(1, fx - i0)), b = Math.max(0, Math.min(1, fy - j0)), c = Math.max(0, Math.min(1, fz - k0)), v = 0;
      for (var di = 0; di < 2; di++) for (var dj = 0; dj < 2; dj++) for (var dk = 0; dk < 2; dk++) v += (di ? a : 1 - a) * (dj ? b : 1 - b) * (dk ? c : 1 - c) * vol[((k0 + dk) * N + (j0 + dj)) * N + (i0 + di)];
      return PHI_MIN + v / 65535 * (PHI_MAX - PHI_MIN);
    }
    function decodeGrid(d) {   // -> Uint16Array of 16-bit values, x fastest. "dd": second differences along x (see build_grid.py); otherwise the older 8-bit bytes
      var n = d.n, out = new Uint16Array(n * n * n), i, k, q2;
      if (d.encoding !== 'dd') { var by = b64(d.data); for (i = 0; i < out.length; i++) out[i] = by[i] * 257; return out; }
      var lines = b64(d.lines), head = new Uint16Array(b64(d.head).buffer), res = new Int8Array(b64(d.res).buffer), top = (1 << d.bits) - 1, sc = 65535 / top, r = 0, L, i0, m, base, a, b, p1, p2;
      function put(ix, v) { out[base + ix] = (v < 0 ? 0 : v > top ? top : v) * sc + 0.5; }   // typed arrays truncate: +0.5 rounds
      for (L = 0; L < n * n; L++) {
        base = L * n; i0 = lines[2 * L]; m = lines[2 * L + 1];
        if (!m) { for (i = 0; i < n; i++) out[base + i] = 32768; continue; }
        a = head[2 * L]; b = m > 1 ? head[2 * L + 1] : a; put(i0, a); if (m > 1) put(i0 + 1, b);
        p2 = a; p1 = b;
        for (k = 2; k < m; k++) { q2 = 2 * p1 - p2 + res[r++]; put(i0 + k, q2); p2 = p1; p1 = q2; }
        if (m < 2) { p2 = a; p1 = a; }
        for (k = m; i0 + k < n; k++) { q2 = 2 * p1 - p2; put(i0 + k, q2); p2 = p1; p1 = q2; }   // linear continuation past the valid part
        for (k = 1; k <= i0; k++) put(i0 - k, a - k * (b - a));                                // and before it
      }
      return out;
    }
    function ballExtremes() {   // lowest and highest potential inside the ball: the voxel centres inside, and the sphere itself (where a potential with no empty-space maximum peaks)
      var lo = Infinity, hi = -Infinity, h = 2 * R / N, i, j, k, v, sp = (PHI_MAX - PHI_MIN) / 65535;
      for (k = 0; k < N; k++) for (j = 0; j < N; j++) for (i = 0; i < N; i++) { var x = -R + (i + 0.5) * h, y = -R + (j + 0.5) * h, z = -R + (k + 0.5) * h; if (x * x + y * y + z * z <= R * R) { v = PHI_MIN + vol[(k * N + j) * N + i] * sp; if (v < lo) lo = v; if (v > hi) hi = v; } }
      for (var a = 0; a <= 90; a++) for (var b = 0; b < 180; b++) { var th = a * 2 * DEG, ph = b * 2 * DEG, sn = Math.sin(th); v = phiAt(R * sn * Math.cos(ph), R * sn * Math.sin(ph), R * Math.cos(th)); if (v < lo) lo = v; if (v > hi) hi = v; }
      return [lo, hi];
    }

    /* ---------- words ---------- */
    function layerWords(v) {   // the picked layer, relative to the Sun
      if (v - CLO < 0.0025) return ['', '', 'the deepest layer in the sphere'];
      if (CHI - v < 0.0025) return ['', '', 'the shallowest layer in the sphere'];
      return depthWords(v, PHI_SUN, false);
    }
    function syncSlider() {
      if (view === 'orbit') { rangeName.textContent = 'Depth'; rangeEl.value = Math.round((iso - UI_LO) / (UI_HI - UI_LO) * 1000); setOut(outLevel, fmtPhi(iso)); }
      else { rangeName.textContent = 'Slice at'; rangeEl.value = Math.round((slicePos + R) / (2 * R) * 1000); setOut(outLevel, (slicePos >= 0 ? '+' : '−') + Math.abs(slicePos).toFixed(1) + ' kpc'); }
    }
    function showWords(w) { setOut(outNum, w[0]); setOut(outUnit, w[1]); setOut(outRel, w[2]); }
    function readouts() {
      if (!D) return;
      if (view === 'orbit') showWords(layerWords(iso));
      else if (!insetHover) showWords(['', '', coarse ? 'tap the map to read the depth there' : 'point at the map to read the depth there']);
    }

    /* ---------- layout and camera ---------- */
    function stripH() { return S.W < 420 ? 38 : 42; }   // the bottom strip holds the colour key and the scale bar, clear of the picture
    function layout() {   // sphere radius and centre (px): the orbit layout fills the stage above the strip; the slice layout moves it lower left, under the flat map
      var W = S.W, H = S.H, m = Math.min(W, H), st = stripH();
      var ro = (m - st - 14) / 2, cx0 = W / 2, cy0 = 7 + ro, rs = m * (W < 420 ? 0.25 : 0.29), cx1 = rs + 12, cy1 = H - st - 8 - rs, u = smooth(lay);
      return { r: ro + (rs - ro) * u, cx: cx0 + (cx1 - cx0) * u, cy: cy0 + (cy1 - cy0) * u };
    }
    function camera() {
      var L = layout(), f = L.r / (S.H / 2), cp = Math.cos(pitch), fwd;
      camDist = R / Math.sin(Math.atan(f * Math.tan(15 * DEG))); camSX = L.cx / S.W * 2 - 1; camSY = 1 - L.cy / S.H * 2;
      eye = [camDist * cp * Math.cos(yaw), camDist * cp * Math.sin(yaw), camDist * Math.sin(pitch)]; fwd = norm([-eye[0], -eye[1], -eye[2]]);
      var right = norm(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
      basis = { f: fwd, r: right, u: up };
      MVP = mul(perspective(30 * DEG, S.W / S.H, camDist - R - 1, camDist + R + 1, camSX, camSY), viewFromBasis(eye, right, up, fwd));
    }
    function project(p) { var v = xform(MVP, p); return [(v[0] + 1) / 2 * S.W, (1 - v[1]) / 2 * S.H, v[3]]; }
    function rest() { return view === 'slice' ? (plane === 3 ? [-30 * DEG, 20 * DEG] : plane === 1 ? [-125 * DEG, 48 * DEG] : [-125 * DEG, 20 * DEG]) : (cut ? REST_CUT : REST_FULL); }
    function tweenTo(y1, p1, dur) { if (RM) { yaw = y1; pitch = p1; vyaw = vpitch = 0; tween = null; return; } tween = { y0: yaw, p0: pitch, y1: yaw + wrapAngle(y1 - yaw), p1: p1, t: 0, dur: dur }; vyaw = vpitch = 0; intro = null; }
    function goRest(dur) { var r = rest(); tweenTo(r[0], r[1], dur || 0.8); }

    /* ---------- render ---------- */
    function clipVec() { return (cut && view === 'orbit') ? [0, -1, 0, 0] : [0, 0, 0, 1e9]; }
    function renderScene() {
      fitGL(); ensureFBO(); var dark = C.dark, sc = curScale(); rw = Math.max(8, Math.round(fbo.w * sc)); rh = Math.max(8, Math.round(fbo.h * sc));
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb); gl.viewport(0, 0, rw, rh); gl.disable(gl.BLEND);
      gl.useProgram(progV); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(aPV); gl.vertexAttribPointer(aPV, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, volTex); gl.uniform1i(U.uVol, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cmapTex[cmapName]); gl.uniform1i(U.uCmap, 1);
      gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]); gl.uniform3f(U.uRight, basis.r[0], basis.r[1], basis.r[2]); gl.uniform3f(U.uUp, basis.u[0], basis.u[1], basis.u[2]); gl.uniform3f(U.uFwd, basis.f[0], basis.f[1], basis.f[2]); gl.uniform2f(U.uShift, camSX, camSY);
      gl.uniform1f(U.uTan, Math.tan(30 * DEG / 2)); gl.uniform1f(U.uAspect, S.W / S.H); gl.uniform1f(U.uR, R); gl.uniform2f(U.uPix, 2 / rw, 2 / rh); gl.uniform1f(U.uLineK, rh / S.H);
      gl.uniform1f(U.uPhiMin, PHI_MIN); gl.uniform1f(U.uPhiMax, PHI_MAX); gl.uniform1f(U.uCLo, CLO); gl.uniform1f(U.uCHi, CHI); gl.uniform1f(U.uIso, iso); gl.uniform1f(U.uLevelStep, LVL_STEP); gl.uniform1f(U.uStep, 0.05); gl.uniform1f(U.uMid, MID_Z); gl.uniform1f(U.uPhiLo, PHI_LO);
      gl.uniform1i(U.uStyle, style === 'shells' ? 0 : 1); gl.uniform1i(U.uSlice, view === 'slice' ? plane : 0); gl.uniform1i(U.uMarch, view === 'orbit' ? 1 : 0); gl.uniform1f(U.uSlicePos, slicePos); gl.uniform1f(U.uMidFill, 0.05);
      gl.uniform1f(U.uFlash, flash); gl.uniform1f(U.uGhost, dark ? 0.12 : 0.08); gl.uniform1f(U.uFog, 0.18); gl.uniform1f(U.uLift, dark ? 0.62 : 0.44); gl.uniform1f(U.uRimK, dark ? 0.8 : 0.62); gl.uniform1f(U.uGlowLift, dark ? 0.4 : 0.0);
      gl.uniform1f(U.uCutLo, dark ? 0.3 : 0.17); gl.uniform1f(U.uCutHi, dark ? 0.62 : 0.6); gl.uniform1f(U.uSatLo, dark ? 0.35 : 0.85);
      var cl = clipVec(); gl.uniform4f(U.uClip, cl[0], cl[1], cl[2], cl[3]); gl.uniform3f(U.uBg, bg[0], bg[1], bg[2]); gl.uniform3f(U.uInk, ink[0], ink[1], ink[2]); gl.uniform3f(U.uRim, rimC[0], rimC[1], rimC[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // blit to the screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height);
      gl.useProgram(progQ); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(aPQ); gl.vertexAttribPointer(aPQ, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbo.tex); gl.uniform1i(UQ.tex, 0); gl.uniform2f(UQ.uv, rw / fbo.w, rh / fbo.h); gl.uniform2f(UQ.max, (rw - 0.5) / fbo.w, (rh - 0.5) / fbo.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (view === 'slice') renderInset();
    }

    /* ---------- the slice map ---------- */
    function insetPoint(u, v) {   // map fractions (0..1, v up) -> model point on the slice plane
      var a = -R + u * 2 * R, b = -R + v * 2 * R;
      return plane === 1 ? [a, b, slicePos] : plane === 2 ? [a, slicePos, b] : [slicePos, a, b];
    }
    function insetGeom() {   // the slice map: a square at the top right, snapped to whole device pixels so its edge is crisp
      var W = S.W, dpr = S.dpr, side = Math.round(Math.min(W, S.H) * (W < 420 ? 0.44 : 0.4)), px = Math.round(side * dpr), x0 = Math.round((W - 10) * dpr) - px, y0 = Math.round(10 * dpr);
      return { x: x0 / dpr, y: y0 / dpr, side: px / dpr, px: px, x0: x0, y0: y0 };
    }
    function renderInset() {   // its own pass into the corner of the canvas, at device-pixel resolution (the volume pass can be coarser)
      var G = insetGeom();
      gl.viewport(G.x0, glc.height - G.y0 - G.px, G.px, G.px); gl.disable(gl.BLEND);
      gl.useProgram(progI); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(aPI); gl.vertexAttribPointer(aPI, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, volTex); gl.uniform1i(UI.uVol, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cmapTex[cmapName]); gl.uniform1i(UI.uCmap, 1);
      gl.uniform1f(UI.uPhiMin, PHI_MIN); gl.uniform1f(UI.uPhiMax, PHI_MAX); gl.uniform1f(UI.uCLo, CLO); gl.uniform1f(UI.uCHi, CHI); gl.uniform1f(UI.uR, R);
      gl.uniform1f(UI.uPhiLo, PHI_LO); gl.uniform1f(UI.uLevelStep, LVL_STEP); gl.uniform1f(UI.uSlicePos, slicePos); gl.uniform1f(UI.uLineW, 1.5 * S.dpr); gl.uniform1i(UI.uPlane, plane);
      gl.uniform3f(UI.uBg, bg[0], bg[1], bg[2]); gl.uniform3f(UI.uInk, ink[0], ink[1], ink[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.viewport(0, 0, glc.width, glc.height);
    }
    // the map's two axes in words, the same words as the 3D arrows: [bottom label (long, short), side], [top label (long, short)]
    var AXES = { 1: [['← to the Galactic centre', '← Galactic centre', 'left'], ['↑ direction of spin', '↑ spin']], 2: [['← to the Galactic centre', '← Galactic centre', 'left'], ['↑ up', '↑ up']], 3: [['direction of spin →', 'spin →', 'right'], ['↑ up', '↑ up']] };
    function drawInset() {
      if (view !== 'slice' || !D) { insetBox = null; return; }
      var G = insetGeom(), x0 = G.x, y0 = G.y, side = G.side, fit = side - 12, A = AXES[plane], o = { size: 12, color: C.text2, back: true, backColor: C.surface };
      insetBox = { x: x0, y: y0, side: side };
      g.strokeStyle = C.borderStrong; g.lineWidth = 1; g.strokeRect(x0 - 0.5, y0 - 0.5, side + 1, side + 1);
      var hz = textW(g, A[0][0], { size: 12 }) <= side ? A[0][0] : A[0][1];   // the horizontal axis is named under the map, so no words sit on the colours
      if (A[0][2] === 'left') label(g, hz, x0, y0 + side + 17, { size: 12, color: C.text2 }); else label(g, hz, x0 + side, y0 + side + 17, { size: 12, color: C.text2, align: 'right' });
      label(g, textW(g, A[1][0], { size: 12 }) <= fit ? A[1][0] : A[1][1], x0 + 6, y0 + 16, o);
      if (Math.abs(slicePos) < 0.08) { var sx = x0 + side / 2, sy = y0 + side / 2; g.fillStyle = C.surface; g.beginPath(); g.arc(sx, sy, 4.5, 0, TAU); g.fill(); g.fillStyle = C.text; g.beginPath(); g.arc(sx, sy, 3, 0, TAU); g.fill(); label(g, 'Sun', sx + 7, sy + 4, { size: 12, color: C.text, back: true, backColor: C.surface }); }
      if (insetHover) ring(x0 + insetHover[0] * side, y0 + (1 - insetHover[1]) * side);
    }
    function ring(x, y) { g.lineWidth = 3.4; g.strokeStyle = rgba(C.surface, 0.85); g.beginPath(); g.arc(x, y, 5, 0, TAU); g.stroke(); g.lineWidth = 1.5; g.strokeStyle = C.text; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.stroke(); }

    /* ---------- overlay: labels, arrows, key, scale ---------- */
    var taken = [], segs = [];
    function fits(b) {
      if (b.x0 < 2 || b.y0 < 2 || b.x1 > S.W - 2 || b.y1 > S.H - 2) return false;
      for (var k = 0; k < taken.length; k++) { var t = taken[k]; if (b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0) return false; }
      for (var s = 0; s < segs.length; s++) if (segHitsRect(segs[s][0], segs[s][1], segs[s][2], segs[s][3], b)) return false;   // never sit on an arrow
      return true;
    }
    function boxOf(text, x, y, o) { var tw = textW(g, text, o) + 8, x0 = o.align === 'right' ? x - tw + 4 : o.align === 'center' ? x - tw / 2 : x - 4; return { x0: x0, x1: x0 + tw, y0: y - 13, y1: y + 5 }; }
    function reserve(b) { taken.push(b); }
    function place(texts, x, y, color, cands) {   // the longest text that fits at the first free position; false when nothing fits
      if (typeof texts === 'string') texts = [texts];
      for (var v = 0; v < texts.length; v++) for (var k = 0; k < cands.length; k++) {
        var o = { size: 12, color: color, align: cands[k][2], back: true, backColor: C.surface }, bx = boxOf(texts[v], x + cands[k][0], y + cands[k][1], o);
        if (fits(bx)) { reserve(bx); label(g, texts[v], x + cands[k][0], y + cands[k][1], o); return true; }
      }
      return false;
    }
    function arrow(from, to, color, width) {
      var a = project(from), b = project(to); if (a[2] <= 0.01 || b[2] <= 0.01) return null;
      var m = 14, tmax = 1;
      if (b[0] < m) tmax = Math.min(tmax, (m - a[0]) / (b[0] - a[0])); if (b[0] > S.W - m) tmax = Math.min(tmax, (S.W - m - a[0]) / (b[0] - a[0]));
      if (b[1] < m) tmax = Math.min(tmax, (m - a[1]) / (b[1] - a[1])); if (b[1] > S.H - m) tmax = Math.min(tmax, (S.H - m - a[1]) / (b[1] - a[1]));
      if (tmax < 1) b = [a[0] + (b[0] - a[0]) * Math.max(0, tmax), a[1] + (b[1] - a[1]) * Math.max(0, tmax), b[2]];
      var vx = b[0] - a[0], vy = b[1] - a[1], l = Math.hypot(vx, vy); if (l < 6) return null;
      var ux = vx / l, uy = vy / l, h = 7 + width * 1.5, lx = b[0] - h * ux, ly = b[1] - h * uy;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = rgba(C.surface, 0.8); g.lineWidth = width + 3.5; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(lx, ly); g.stroke();   // a light halo so the arrow reads on dark and on pale layers
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(lx + h * 0.5 * uy, ly - h * 0.5 * ux); g.lineTo(lx - h * 0.5 * uy, ly + h * 0.5 * ux); g.closePath(); g.stroke();
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(lx, ly); g.stroke();
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(lx + h * 0.5 * uy, ly - h * 0.5 * ux); g.lineTo(lx - h * 0.5 * uy, ly + h * 0.5 * ux); g.closePath(); g.fill();
      segs.push([a[0], a[1], b[0], b[1]]);
      return [b[0], b[1], ux, uy, l];
    }
    function layerAnchor() {   // the picked layer's trace on the plane through the Sun and the Galactic centre (y = 0): a point on it for its label
      if (layerKey === iso) return layerPt; layerKey = iso; layerPt = null;
      var zs = [2.4, 2.2, 2.0, 1.8, 2.6, 2.8, 1.6, 3.0, 1.4, 1.2, 3.2, 1.0, 0.8, 0.6];
      for (var i = 0; i < zs.length; i++) {
        var z = zs[i], xr = Math.sqrt(Math.max(0, R * R - z * z)) - 0.1, lo = -xr, hi = xr, vlo = phiAt(lo, 0, z), vhi = phiAt(hi, 0, z);
        if ((vlo - iso) * (vhi - iso) > 0) continue;
        for (var k = 0; k < 26; k++) { var m = (lo + hi) / 2, vm = phiAt(m, 0, z); if ((vm - iso) * (vlo - iso) <= 0) hi = m; else { lo = m; vlo = vm; } }
        layerPt = [(lo + hi) / 2, 0, z]; break;
      }
      return layerPt;
    }
    var LEFT = [[-4, -10, 'left'], [-4, 20, 'left'], [0, -10, 'center'], [10, 4, 'left'], [-10, 4, 'right'], [0, 20, 'center']], RIGHT = [[4, -10, 'right'], [4, 20, 'right'], [0, -10, 'center'], [-10, 4, 'right'], [10, 4, 'left'], [0, 20, 'center']];
    var UPC = [[0, -9, 'center'], [10, 4, 'left'], [-10, 4, 'right'], [0, 19, 'center']];
    function drawKey(W, H) {   // the colour ramp, bottom left; marks the picked layer (or the value under the pointer on the slice)
      var narrow = W < 420, rw = narrow ? 100 : 120, rx = 12, ry = H - 29, rgb = cmapRGB[cmapName];
      for (var i = 0; i < rw; i++) { var ci = Math.round(i / (rw - 1) * 255) * 3; g.fillStyle = 'rgb(' + rgb[ci] + ',' + rgb[ci + 1] + ',' + rgb[ci + 2] + ')'; g.fillRect(rx + i, ry, 1, 8); }
      g.strokeStyle = rgba(C.text2, 0.6); g.lineWidth = 1; g.strokeRect(rx - 0.5, ry - 0.5, rw + 1, 9);
      var v = view === 'orbit' ? iso : (insetHover ? insetHover[2] : null);
      if (v != null) { var mx = rx + clamp((v - CLO) / (CHI - CLO), 0, 1) * rw; g.fillStyle = rgba(C.surface, 0.85); g.beginPath(); g.moveTo(mx, ry + 0.5); g.lineTo(mx - 6, ry - 10); g.lineTo(mx + 6, ry - 10); g.closePath(); g.fill(); g.fillStyle = C.text; g.beginPath(); g.moveTo(mx, ry - 0.5); g.lineTo(mx - 4.5, ry - 8.5); g.lineTo(mx + 4.5, ry - 8.5); g.closePath(); g.fill(); }
      label(g, 'deeper', rx, H - 7, { size: 12, color: C.text2 }); label(g, 'shallower', rx + rw, H - 7, { size: 12, color: C.text2, align: 'right' });
    }
    function drawScale(W, H) {   // one kpc across the view at the Sun's depth, bottom right
      var o0 = project([0, 0, 0]), o1 = project([basis.r[0], basis.r[1], basis.r[2]]), bar = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
      if (bar < 8 || bar > W * 0.6) return;
      var bx1 = W - 12, bx0 = bx1 - bar, by = H - 24;
      g.strokeStyle = C.text2; g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx0, by + 0.5); g.lineTo(bx1, by + 0.5); g.moveTo(bx0 + 0.5, by - 4); g.lineTo(bx0 + 0.5, by + 5); g.moveTo(bx1 - 0.5, by - 4); g.lineTo(bx1 - 0.5, by + 5); g.stroke();
      var t = '1 kpc ≈ 3,300 light-years'; if (textW(g, t, { size: 12 }) > W - 12 - (W < 420 ? 118 : 140) - 12) t = '1 kpc ≈ 3,300 ly';
      label(g, t, bx1, H - 7, { size: 12, color: C.text2, align: 'right' });
    }
    function overlay() {
      var W = S.W, H = S.H; g.clearRect(0, 0, W, H); taken.length = 0; segs.length = 0;
      if (!D) { label(g, 'loading the map…', 12, H - 14, { size: 12, color: C.text2 }); return; }
      reserve({ x0: 0, x1: W, y0: H - stripH(), y1: H });
      drawInset(); if (insetBox) reserve({ x0: insetBox.x - 4, x1: insetBox.x + insetBox.side + 4, y0: insetBox.y - 4, y1: insetBox.y + insetBox.side + 26 });
      var s = project([0, 0, 0]), rpx = Math.tan(Math.asin(Math.min(0.999, R / camDist))) * (H / 2) / Math.tan(15 * DEG), edgeShown = false;
      if ((view === 'orbit' && cut && eye[1] < 0) || view === 'slice') {   // the edge of the mapped ball (the removed half, when the cut faces us)
        g.strokeStyle = rgba(C.text2, view === 'slice' ? 0.45 : 0.7); g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.arc(s[0], s[1], rpx, 0, TAU); g.stroke(); g.setLineDash([]); edgeShown = view === 'orbit';
      }
      drawKey(W, H); drawScale(W, H);
      // landmarks: the Sun, a long arrow to the Galactic centre, one-kpc arrows for up (and for the spin when the slice shows it)
      var sunVisible = s[2] > 0.01 && s[0] > -20 && s[0] < W + 20 && s[1] > -20 && s[1] < H + 20;
      var gc = arrow([0, 0, 0], [-3.3, 0, 0], C.text, 1.8), upA = arrow([0, 0, 0], [0, 0, 1], C.text2, 1.3), spA = (view === 'slice' && plane !== 2) ? arrow([0, 0, 0], [0, 1, 0], C.text2, 1.3) : null;
      if (sunVisible) { g.fillStyle = rgba(C.surface, 0.85); g.beginPath(); g.arc(s[0], s[1], 5.5, 0, TAU); g.fill(); g.fillStyle = C.text; g.beginPath(); g.arc(s[0], s[1], 3.6, 0, TAU); g.fill(); reserve({ x0: s[0] - 6, x1: s[0] + 6, y0: s[1] - 6, y1: s[1] + 6 }); place('Sun', s[0], s[1], C.text, [[8, 14, 'left'], [-8, 14, 'right'], [8, -7, 'left'], [-8, -7, 'right'], [0, 23, 'center']]); }
      if (gc) place(['to the Galactic centre', 'Galactic centre'], gc[0], gc[1], C.text, gc[2] < 0 ? LEFT : RIGHT);
      if (upA && upA[4] > 14) place('up', upA[0], upA[1], C.text2, upA[3] < 0 ? UPC : [[0, 19, 'center'], [10, 4, 'left'], [-10, 4, 'right']]);
      if (spA && spA[4] > 14) place('direction of spin', spA[0], spA[1], C.text2, spA[2] < 0 ? LEFT : RIGHT);
      {   // the Galactic plane: the dashed trace on the cut face, the ring when the whole ball shows, the trace on the slab
        var pm = null, cands = [[-6, -8, 'right'], [-6, 16, 'right'], [6, -8, 'left'], [6, 16, 'left']];
        if (view === 'orbit') { var en = Math.hypot(eye[0], eye[1]) || 1; pm = cut ? [R * 0.98, 0, MID_Z] : [eye[0] / en * R, eye[1] / en * R, MID_Z]; if (!cut) cands = [[-8, 15, 'right'], [8, 15, 'left'], [0, -8, 'center'], [0, 19, 'center']]; }
        else if (plane === 2) pm = [Math.sqrt(Math.max(0, R * R - slicePos * slicePos)) * 0.97, slicePos, MID_Z];
        else if (plane === 3) pm = [slicePos, Math.sqrt(Math.max(0, R * R - slicePos * slicePos)) * 0.97, MID_Z];
        if (pm) { var mp = project(pm); if (mp[2] > 0.01) place('Galactic plane', mp[0], mp[1], C.text2, cands); }
      }
      if (view === 'orbit') {   // the picked layer, named where it crosses the plane through the Sun and the centre
        var lp = layerAnchor(); if (lp) { var pp = project(lp); place('your layer', pp[0], pp[1], C.text, [[10, -6, 'left'], [-10, -6, 'right'], [10, 15, 'left'], [-10, 15, 'right']]); }
      }
      if (edgeShown) { var th = [135, 45, 225, 315]; for (var i = 0; i < th.length; i++) { var a = th[i] * DEG, ex = s[0] + rpx * Math.cos(a), ey = s[1] - rpx * Math.sin(a), left = Math.cos(a) < 0; if (place('edge of the map', ex, ey, C.text2, left ? [[-3, Math.sin(a) > 0 ? -6 : 17, 'right']] : [[3, Math.sin(a) > 0 ? -6 : 17, 'left']])) break; } }
      if (view === 'slice' && insetHover) { var hp = project(insetPoint(insetHover[0], insetHover[1])); if (hp[2] > 0.01) ring(hp[0], hp[1]); }   // the same spot, marked on the slab
      if (hint > 0 && !RM && !insetBox) { var ht = coarse ? 'swipe sideways to turn' : 'drag to turn'; var hb = boxOf(ht, W - 10, 20, { size: 12, align: 'right' }); reserve(hb); label(g, ht, W - 10, 20, { size: 12, align: 'right', color: rgba(C.text2, Math.min(1, hint)), back: true, backColor: C.surface }); }
    }

    /* ---------- loop ---------- */
    var moving = false, glDirty = true, camKey = '';
    function syncAll() { syncSlider(); readouts(); glDirty = true; }
    function step(dt) {
      moving = false;
      if (intro) { intro.t += dt / 3.0; yaw = intro.y0 + (intro.y1 - intro.y0) * smooth(intro.t); moving = true; if (intro.t >= 1) { intro = null; yaw = rest()[0]; } }
      if (sweep) {   // one slow sweep of the picked layer from the Sun's depth down and back, so the slider's job shows before anyone touches it
        moving = true;
        if (sweep.mode === 'back') { sweep.t += dt / 0.5; iso = sweep.from + (PHI_SUN - sweep.from) * smooth(sweep.t); if (sweep.t >= 1) { iso = PHI_SUN; sweep = null; } syncAll(); }
        else if (sweep.delay > 0) sweep.delay -= dt;
        else { sweep.t += dt / 2.6; var u = Math.min(1, sweep.t); iso = PHI_SUN - 0.36 * (PHI_SUN - CLO) * (0.5 - 0.5 * Math.cos(TAU * u)); if (u >= 1) { iso = PHI_SUN; sweep = null; } syncAll(); }
      }
      if (lay !== layGoal) { var dl = dt / 0.9; lay = lay < layGoal ? Math.min(layGoal, lay + dl) : Math.max(layGoal, lay - dl); moving = true; }
      if (tween) { tween.t += dt / tween.dur; var w = smooth(tween.t); yaw = tween.y0 + (tween.y1 - tween.y0) * w; pitch = tween.p0 + (tween.p1 - tween.p0) * w; moving = true; if (tween.t >= 1) tween = null; }
      if (!(drag && drag.live) && !tween && (Math.abs(vyaw) > 1e-4 || Math.abs(vpitch) > 1e-4)) { yaw += vyaw; pitch = clamp(pitch + vpitch, PMIN, PMAX); vyaw *= 0.91; vpitch *= 0.91; moving = true; }
      if (flash > 0) { flash = Math.max(0, flash - dt / 0.55); moving = true; glDirty = true; }
      if (touched && hint > 0) { hint -= dt / 0.8; moving = true; }
    }
    function animating() { return !!(drag || intro || sweep || tween || lay !== layGoal || flash > 0 || (touched && hint > 0 && !RM) || Math.abs(vyaw) > 1e-4 || Math.abs(vpitch) > 1e-4); }
    function updateHome() {
      var r = rest(), away = !intro && !tween && (Math.abs(wrapAngle(yaw - r[0])) > 9 * DEG || Math.abs(pitch - r[1]) > 7 * DEG);
      if (home.hidden === away) home.hidden = !away;
    }
    function draw() {
      if (!S.W) return;
      var active = animating();   // while anything moves the quick pass is used; once still, one full-resolution pass follows
      if (active) { if (crisp && !RM) { crisp = false; glDirty = true; } if (crispT) { clearTimeout(crispT); crispT = 0; } }
      camera();
      var key = eye[0].toFixed(4) + ',' + eye[1].toFixed(4) + ',' + eye[2].toFixed(4) + ',' + basis.f[0].toFixed(4) + ',' + basis.f[1].toFixed(4) + ',' + basis.f[2].toFixed(4) + ',' + camSX.toFixed(4) + ',' + camSY.toFixed(4) + ',' + S.W + 'x' + S.H;
      if (key !== camKey) { camKey = key; glDirty = true; }
      if (D) { if (glDirty) { renderScene(); glDirty = false; } } else { fitGL(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      overlay(); updateHome();
      if (!active && !crisp && !crispT && view === 'orbit' && lowScale() < 1) crispT = setTimeout(function () { crispT = 0; crisp = true; glDirty = true; run.wake(); run.redraw(); }, 140);
      return active ? undefined : false;
    }
    var run = E.loop(ov, step, draw);
    S.onresize = function () { fitGL(); glDirty = true; run.wake(); run.redraw(); };
    E.onTheme.push(function () { readTheme(); run.wake(); run.redraw(); });
    function startIntro() {
      var r = rest(); yaw = r[0] - SWING; pitch = r[1]; intro = { t: 0, y0: yaw, y1: r[0] }; sweep = { mode: 'play', delay: 0.8, t: 0 }; run.wake();
    }
    // anything the visitor does ends the arrival show: the turn finishes (or is taken over), the sweep eases back to the Sun's depth unless the slider took over
    function stopAuto(finishTurn, easeSweep) {
      if (intro) { intro = null; if (finishTurn) goRest(0.5); }
      if (sweep) {
        if (!easeSweep) sweep = null;
        else if (sweep.mode !== 'back') sweep = Math.abs(iso - PHI_SUN) > 1e-6 ? { mode: 'back', from: iso, t: 0 } : null;
      }
    }
    run.onVisible(function () { if (D && !RM && !touched && !intro && !introDone && view === 'orbit') { introDone = true; startIntro(); } });

    enable(fig, false); note(fig, 'Loading the 3D map (230 KB)…');
    whenNear(fig, function () {
      fetchJSON(fig.getAttribute('data-src')).then(function (d) { build(d); enable(fig, true); note(fig, ''); if (!RM && !touched && run.visible()) { introDone = true; startIntro(); } run.wake(); run.redraw(); })
        .catch(function (e) { note(fig, 'The 3D map could not be loaded (' + (e && e.message ? e.message : e) + ').'); });
    });
    E.more(fig, function () { if (run) { run.wake(); run.redraw(); } });   // the cosmetic choices (look, colours) and the unit note live behind Details

    /* ---------- controls ---------- */
    function sliderInput() {
      var v = +rangeEl.value / 1000; glDirty = true;
      if (view === 'orbit') { iso = UI_LO + v * (UI_HI - UI_LO); if (Math.abs(iso - PHI_SUN) < 0.004) iso = PHI_SUN; flash = RM ? 0 : 1; }
      else { slicePos = Math.round((-R + v * 2 * R) * 20) / 20; refreshHover(); }
      touched = true; stopAuto(view === 'orbit', false); syncSlider(); readouts(); if (RM) run.redraw(); else run.wake();
    }
    rangeEl.addEventListener('input', sliderInput);
    function setCaption() { if (capO) capO.hidden = view === 'slice'; if (capS) capS.hidden = view !== 'slice'; }
    function setView(v) {
      if (v !== 'slice') v = 'orbit';   // two views: any other name falls back to the layers
      view = v; touched = true; stopAuto(false, true); tween = null; vyaw = vpitch = 0; insetHover = null; scrub = null; glDirty = true;
      layGoal = v === 'slice' ? 1 : 0; if (RM) lay = layGoal;
      if (planeSeg) planeSeg.hidden = v !== 'slice'; if (cutBtn) cutBtn.hidden = v !== 'orbit'; if (styleSeg) styleSeg.hidden = v === 'slice';   // the slice has no layer to draw solid or glowing
      setCaption(); syncSlider(); readouts(); goRest(0.9); run.wake(); run.redraw();
    }
    seg(fig, 'data-view', setView);
    seg(fig, 'data-style', function (s) { style = s; touched = true; stopAuto(true, true); glDirty = true; run.wake(); run.redraw(); });
    seg(fig, 'data-plane', function (p) { plane = p === 'xy' ? 1 : p === 'xz' ? 2 : 3; touched = true; stopAuto(true, true); glDirty = true; refreshHover(); goRest(0.9); run.wake(); run.redraw(); });
    seg(fig, 'data-cmap', function (c) { cmapName = c; touched = true; stopAuto(true, true); glDirty = true; run.wake(); run.redraw(); });
    toggle(cutBtn, function (on) { cut = on; touched = true; stopAuto(false, true); glDirty = true; goRest(0.9); run.wake(); run.redraw(); });
    home.addEventListener('click', function () { touched = true; stopAuto(false, true); goRest(0.7); run.wake(); run.redraw(); });
    if (planeSeg) planeSeg.hidden = true; if (coarse && capS && capS.getAttribute('data-touch')) capS.textContent = capS.getAttribute('data-touch');   // "tap" instead of "point at" on a touch screen
    setCaption();

    /* ---------- pointer: turn on sideways drags; a vertical swipe on a touch screen scrolls the page (touch-action: pan-y) ---------- */
    function local(e) { var r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function inInset(p) { return insetBox && p[0] >= insetBox.x && p[0] <= insetBox.x + insetBox.side && p[1] >= insetBox.y && p[1] <= insetBox.y + insetBox.side; }
    function insetRead(p) {   // the depth under the pointer on the slice map
      var u = (p[0] - insetBox.x) / insetBox.side, v = 1 - (p[1] - insetBox.y) / insetBox.side; setHover(u, v);
    }
    function setHover(u, v) {
      var a = -R + u * 2 * R, b = -R + v * 2 * R;
      if (a * a + b * b > R * R - slicePos * slicePos) { insetHover = null; readouts(); return; }
      var pt = insetPoint(u, v), phi = phiAt(pt[0], pt[1], pt[2]), w = depthWords(phi, PHI_SUN, true); insetHover = [u, v, phi]; showWords(w);
    }
    function refreshHover() { if (insetHover) setHover(insetHover[0], insetHover[1]); else readouts(); }   // the reading follows the plane and the slice position, never goes stale
    function beginDrag() { vyaw = vpitch = 0; tween = null; touched = true; stopAuto(false, true); stage.classList.add('is-dragging'); run.wake(); }
    function turn(dx, dy, ts) {
      var k = 0.0058 * (420 / Math.max(280, S.W)), a = -dx * k, b = dy * k * 0.7, dtm = Math.max(5, ts - drag.t);   // sideways turns fully, up and down at 70 %
      yaw += a; pitch = clamp(pitch + b, PMIN, PMAX); drag.t = ts; drag.last = ts;
      drag.vx = drag.vx * 0.5 + a / dtm * 16.7 * 0.5; drag.vy = drag.vy * 0.5 + b / dtm * 16.7 * 0.5;   // the release speed, in radians per frame, from the last few moves
      run.wake();
    }
    glc.addEventListener('pointerdown', function (e) {
      if (!D || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var p = local(e);
      if (inInset(p)) { scrub = e.pointerId; touched = true; stopAuto(false, true); insetRead(p); try { glc.setPointerCapture(e.pointerId); } catch (x) {} run.wake(); run.redraw(); if (e.pointerType === 'mouse') e.preventDefault(); return; }
      var touch = e.pointerType === 'touch';
      drag = { id: e.pointerId, x: p[0], y: p[1], sx: p[0], sy: p[1], t: e.timeStamp, last: 0, vx: 0, vy: 0, live: !touch };
      if (drag.live) beginDrag();
      try { glc.setPointerCapture(e.pointerId); } catch (x) {}
      if (!touch) e.preventDefault();
    });
    glc.addEventListener('pointermove', function (e) {
      if (!D) return; var p = local(e);
      if (scrub === e.pointerId) { if (inInset(p)) { insetRead(p); run.wake(); } return; }
      if (drag && drag.id === e.pointerId) {
        if (!drag.live) {   // a touch: wait for a clear sideways start; a vertical one is the browser's, to scroll the page
          var tx = p[0] - drag.sx, ty = p[1] - drag.sy; if (Math.abs(tx) < 6 && Math.abs(ty) < 6) return;
          if (Math.abs(ty) > Math.abs(tx)) { drag = null; return; }
          drag.live = true; drag.t = e.timeStamp; beginDrag();
        }
        turn(p[0] - drag.x, p[1] - drag.y, e.timeStamp); drag.x = p[0]; drag.y = p[1];
      } else if (e.pointerType !== 'touch') { if (inInset(p)) { insetRead(p); run.wake(); } else if (insetHover) { insetHover = null; readouts(); run.wake(); } }
    });
    function endDrag(e) {
      if (scrub === e.pointerId) { scrub = null; return; }
      if (!drag || drag.id !== e.pointerId) return;
      var d = drag; drag = null; stage.classList.remove('is-dragging');
      if (d.live && !RM && e.type === 'pointerup' && e.timeStamp - d.last < 90) { vyaw = clamp(d.vx, -0.035, 0.035); vpitch = clamp(d.vy, -0.02, 0.02); } else vyaw = vpitch = 0;   // coast only after a drag that was still moving, never far
      run.wake();
    }
    glc.addEventListener('pointerup', endDrag); glc.addEventListener('pointercancel', endDrag);
    glc.addEventListener('pointerleave', function (e) { if (drag || scrub != null || e.pointerType === 'touch') return; if (insetHover) { insetHover = null; readouts(); run.wake(); } });
    glc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); note(fig, 'The 3D view was paused by the browser; reload the page to restore it.'); });

    if (fig.hasAttribute('data-dev')) window.__p3d = {   // test hooks, only on the dev page
      get: function () { return { yaw: yaw / DEG, pitch: pitch / DEG, iso: iso, view: view, plane: plane, cut: cut, style: style, cmap: cmapName, lay: lay, intro: !!intro, sweep: !!sweep, away: !home.hidden, hint: hint, coarse: coarse, vyaw: vyaw, drag: !!drag, animating: animating() }; },
      set: function (o) { if (o.yaw != null) yaw = o.yaw * DEG; if (o.pitch != null) pitch = o.pitch * DEG; if (o.iso != null) { iso = o.iso; syncAll(); } if (o.stop) { intro = null; sweep = null; tween = null; vyaw = vpitch = 0; touched = true; } glDirty = true; run.wake(); run.redraw(); },
      fling: function (dxPx) { var k = 0.0058 * (420 / Math.max(280, S.W)); yaw -= dxPx * k; run.wake(); }
    };
  }

  /* =====================================================================
     The mesh fallback (WebGL1): six sheets of equal depth, driven by the Depth slider and the Cut open switch
     ===================================================================== */
  function meshRenderer(ctx, gl) {
    var fig = ctx.fig, stage = ctx.stage, glc = ctx.glc, ov = ctx.ov, S = ctx.S, g = ctx.g, coarse = ctx.coarse;
    var rangeEl = fig.querySelector('[data-ctl="level"]'), rangeName = fig.querySelector('[data-slider-name]'), outLevel = fig.querySelector('[data-out="level"]'), outNum = fig.querySelector('[data-out="num"]'), outUnit = fig.querySelector('[data-out="unit"]'), outRel = fig.querySelector('[data-out="rel"]');
    var cutBtn = fig.querySelector('[data-ctl="cut"]');
    fig.querySelectorAll('[data-group], [data-ctl="more"], [data-details]').forEach(function (el) { el.hidden = true; });   // views, planes, looks and colours need the volume renderer
    note(fig, 'Showing six layers (this browser has no WebGL2 for the full map).');
    var prog = compile(gl, VS1, FS1); gl.useProgram(prog);
    var A = { pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm') }, U = {};
    ['uMVP', 'uMV', 'uScale', 'uColor', 'uBg', 'uAlpha', 'uClip', 'uLight', 'uDepth', 'uFlat'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.enableVertexAttribArray(A.pos); gl.enableVertexAttribArray(A.nrm); gl.uniform1f(U.uScale, 0.001); gl.uniform3f(U.uLight, -0.42, 0.52, 0.74); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    var DISC_N = 180, discBuf = gl.createBuffer();
    (function () { var a = new Int16Array(DISC_N * 3); for (var i = 0; i < DISC_N; i++) { var t = TAU * i / DISC_N; a[i * 3] = Math.round(3800 * Math.cos(t)); a[i * 3 + 1] = Math.round(3800 * Math.sin(t)); a[i * 3 + 2] = -21; } gl.bindBuffer(gl.ARRAY_BUFFER, discBuf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); })();
    var VIR13 = ramp(VIRIDIS);
    var D = null, shells = [], NS = 0, RAD = 3.8, PHI_SUN = null, LVL_LO = -1.85, LVL_HI = -1.37, iso = -1.57;
    var yaw0 = -90 * DEG, pitch0 = 6 * DEG, YAW3 = -128 * DEG, PITCH3 = 22 * DEG, yaw = yaw0, pitch = pitch0, vyaw = 0, vpitch = 0, DIST = 15.5, PMIN = -12 * DEG, PMAX = 62 * DEG;
    var sel = -1, cut = true, w = [], intro = null, tween = null, touched = false, hint = 1, drag = null, introDone = false;
    var bg = [1, 1, 1], ink = [0.5, 0.5, 0.5], MVP = null, MV = null, eye = [0, 0, 0];
    function fitGL() { var cw = Math.round(S.W * S.dpr), ch = Math.round(S.H * S.dpr); if (glc.width !== cw || glc.height !== ch) { glc.width = cw; glc.height = ch; } }
    function readTheme() { var c = hexRGB(C.surface); bg = [c[0] / 255, c[1] / 255, c[2] / 255]; var k = hexRGB(C.text3); ink = [k[0] / 255, k[1] / 255, k[2] / 255]; }
    readTheme();
    function build(data) {
      D = data; NS = D.shells.length; PHI_SUN = typeof D.phi_sun === 'number' ? D.phi_sun : null; w = [];
      D.shells.forEach(function (sh, i) {
        var pu = b64(sh.pos), iu = b64(sh.idx), pos = new Int16Array(pu.buffer, 0, sh.nv * 3), idx = new Uint16Array(iu.buffer, 0, sh.nt * 3), nrm = new Float32Array(sh.nv * 3), cen = [0, 0, 0], t, seg2 = [];
        for (t = 0; t < sh.nt; t++) {
          var a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3, ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz; nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz; nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
          var P = [a, b, c], pts = [];
          for (var q = 0; q < 3; q++) { var p0 = P[q], p1 = P[(q + 1) % 3], y0 = pos[p0 + 1], y1 = pos[p1 + 1]; if ((y0 < 0) !== (y1 < 0)) { var f = y0 / (y0 - y1); pts.push((pos[p0] + f * (pos[p1] - pos[p0])) * 0.001, (pos[p0 + 2] + f * (pos[p1 + 2] - pos[p0 + 2])) * 0.001); } }
          if (pts.length === 4) seg2.push(pts[0], pts[1], pts[2], pts[3]);
        }
        for (var v = 0; v < sh.nv; v++) { var l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1; nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l; cen[0] += pos[v * 3]; cen[1] += pos[v * 3 + 1]; cen[2] += pos[v * 3 + 2]; }
        var bp = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        var bn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bn); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
        var bi = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        var li = D.levels_all.indexOf(sh.level), ci = Math.round((1 - Math.max(0, Math.min(12, li < 0 ? i * 2 : li)) / 12) * 255) * 3, col = [VIR13[ci] / 255, VIR13[ci + 1] / 255, VIR13[ci + 2] / 255];   // levels_all runs shallow to deep: deeper is purple, as in the full map
        shells.push({ level: sh.level, nt: sh.nt, bp: bp, bn: bn, bi: bi, col: col, cen: [cen[0] / sh.nv * 0.001, cen[1] / sh.nv * 0.001, cen[2] / sh.nv * 0.001], seg: new Float32Array(seg2) }); w.push(1);
      });
      RAD = D.radius_kpc || 3.8; LVL_LO = Math.min.apply(null, shells.map(function (s) { return s.level; })); LVL_HI = Math.max.apply(null, shells.map(function (s) { return s.level; }));
      iso = PHI_SUN != null ? PHI_SUN : -1.57; rangeName.textContent = 'Depth'; syncSlider(); readout();
    }
    function nearest() { var best = -1, bd = 1e9; for (var i = 0; i < NS; i++) { var d = Math.abs(shells[i].level - iso); if (d < bd) { bd = d; best = i; } } return best; }
    function syncSlider() { rangeEl.value = Math.round((iso - LVL_LO) / (LVL_HI - LVL_LO) * 1000); setOut(outLevel, fmtPhi(iso)); }
    function targetW(i) { return sel < 0 || sel === i ? 1 : 0.22; }
    function readout() { if (!D) return; if (sel < 0) { setOut(outNum, ''); setOut(outUnit, ''); setOut(outRel, 'slide to pick a layer'); return; } var r = depthWords(shells[sel].level, PHI_SUN != null ? PHI_SUN : shells[sel].level, false); setOut(outNum, r[0]); setOut(outUnit, r[1]); setOut(outRel, r[2]); }
    function camera() { var cp = Math.cos(pitch); eye = [DIST * cp * Math.cos(yaw), DIST * cp * Math.sin(yaw), DIST * Math.sin(pitch)]; var f = norm([-eye[0], -eye[1], -eye[2]]), r = norm(cross(f, [0, 0, 1])), u = cross(r, f); MV = viewFromBasis(eye, r, u, f); MVP = mul(perspective(30 * DEG, S.W / S.H, DIST - RAD - 1, DIST + RAD + 1, 0, 0), MV); }
    function project(p) { var q = xform(MVP, p); return [(q[0] + 1) / 2 * S.W, (1 - q[1]) / 2 * S.H, q[3]]; }
    function tweenTo(y1, p1, dur) { if (RM) { yaw = y1; pitch = p1; vyaw = vpitch = 0; return; } tween = { y0: yaw, p0: pitch, y1: yaw + wrapAngle(y1 - yaw), p1: p1, t: 0, dur: dur }; vyaw = vpitch = 0; intro = null; }
    function setCommon() { gl.uniformMatrix4fv(U.uMVP, false, MVP); gl.uniformMatrix4fv(U.uMV, false, MV); gl.uniform3f(U.uBg, bg[0], bg[1], bg[2]); gl.uniform2f(U.uDepth, DIST - RAD, DIST + RAD); if (cut) gl.uniform4f(U.uClip, 0, -1, 0, 0.0); else gl.uniform4f(U.uClip, 0, 0, 0, 1e9); }
    function drawShell(sh, alpha) { gl.bindBuffer(gl.ARRAY_BUFFER, sh.bp); gl.vertexAttribPointer(A.pos, 3, gl.SHORT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, sh.bn); gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sh.bi); gl.uniform1f(U.uFlat, 0); gl.uniform3f(U.uColor, sh.col[0], sh.col[1], sh.col[2]); gl.uniform1f(U.uAlpha, alpha); gl.drawElements(gl.TRIANGLES, sh.nt * 3, gl.UNSIGNED_SHORT, 0); }
    function drawDisc() { gl.bindBuffer(gl.ARRAY_BUFFER, discBuf); gl.vertexAttribPointer(A.pos, 3, gl.SHORT, false, 0, 0); gl.vertexAttribPointer(A.nrm, 3, gl.SHORT, false, 0, 0); gl.uniform1f(U.uFlat, 1); gl.uniform3f(U.uColor, ink[0], ink[1], ink[2]); gl.uniform1f(U.uAlpha, 0.9); gl.drawArrays(gl.LINE_LOOP, 0, DISC_N); }
    function order() { var l = Math.hypot(eye[0], eye[1], eye[2]), ex = eye[0] / l, ey = eye[1] / l, ez = eye[2] / l, idx = []; for (var i = 0; i < NS; i++) idx.push(i); idx.sort(function (a, b) { var da = shells[a].cen[0] * ex + shells[a].cen[1] * ey + shells[a].cen[2] * ez, db = shells[b].cen[0] * ex + shells[b].cen[1] * ey + shells[b].cen[2] * ez; return da - db; }); return idx; }
    function renderScene() {
      fitGL(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      setCommon(); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true); drawDisc();
      var ord = order(), i, k, any = false;
      for (k = 0; k < ord.length; k++) { i = ord[k]; if (w[i] >= 0.995) drawShell(shells[i], 1); else if (w[i] > 0.01) any = true; }
      if (any) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.CULL_FACE); gl.depthMask(false); for (k = 0; k < ord.length; k++) { i = ord[k]; if (w[i] >= 0.995 || w[i] <= 0.01) continue; gl.cullFace(gl.FRONT); drawShell(shells[i], w[i]); gl.cullFace(gl.BACK); drawShell(shells[i], w[i]); } gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); }
    }
    function overlay() {
      var W = S.W, H = S.H; g.clearRect(0, 0, W, H);
      if (!D) { label(g, 'loading the layers…', 12, H - 14, { size: 12, color: C.text2 }); return; }
      if (cut && eye[1] < 0) { g.lineWidth = 1.4; g.lineCap = 'round'; g.strokeStyle = rgba(C.text, 0.75); for (var i = 0; i < NS; i++) { var sg = shells[i].seg; g.globalAlpha = Math.max(0.35, w[i]); g.beginPath(); for (var k = 0; k < sg.length; k += 4) { var a = project([sg[k], 0, sg[k + 1]]), b = project([sg[k + 2], 0, sg[k + 3]]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke(); } g.globalAlpha = 1; }
      var s = project([0, 0, 0]); g.fillStyle = C.text; g.beginPath(); g.arc(s[0], s[1], 3.6, 0, TAU); g.fill(); label(g, 'Sun', s[0] + 8, s[1] + 14, { size: 12, color: C.text, back: true, backColor: C.surface });
      var gc = project([-4.3, 0, 0]); if (gc[2] > 0) { g.strokeStyle = C.text; g.lineWidth = 1.8; g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(gc[0], gc[1]); g.stroke(); var gt = 'to the Galactic centre', gw = textW(g, gt, { size: 12 }) / 2; label(g, gt, Math.max(10 + gw, Math.min(W - 10 - gw, gc[0])), gc[1] - 8, { size: 12, align: 'center', color: C.text, back: true, backColor: C.surface }); }
      label(g, 'layers of equal depth; purple is deepest', 10, H - 10, { size: 12, color: C.text2, back: true, backColor: C.surface });
      if (hint > 0 && !RM) label(g, coarse ? 'swipe sideways to turn' : 'drag to turn', W - 10, 20, { size: 12, align: 'right', color: rgba(C.text2, Math.min(1, hint)), back: true, backColor: C.surface });
    }
    var moving = false;
    function step(dt) {
      moving = false;
      if (intro) { intro.t += dt / 3.0; yaw = yaw0 - 38 * DEG + 38 * DEG * smooth(intro.t); moving = true; if (intro.t >= 1) { intro = null; yaw = yaw0; } }
      if (tween) { tween.t += dt / tween.dur; var u = smooth(tween.t); yaw = tween.y0 + (tween.y1 - tween.y0) * u; pitch = tween.p0 + (tween.p1 - tween.p0) * u; moving = true; if (tween.t >= 1) tween = null; }
      if (!(drag && drag.live) && !tween && (Math.abs(vyaw) > 1e-4 || Math.abs(vpitch) > 1e-4)) { yaw += vyaw; pitch = clamp(pitch + vpitch, PMIN, PMAX); vyaw *= 0.91; vpitch *= 0.91; moving = true; }
      for (var i = 0; i < NS; i++) { var tgt = targetW(i); if (Math.abs(w[i] - tgt) > 0.001) { w[i] += (tgt - w[i]) * Math.min(1, dt / 0.12); if (Math.abs(w[i] - tgt) < 0.01) w[i] = tgt; moving = true; } }
      if (touched && hint > 0) { hint -= dt / 0.8; moving = true; }
    }
    function animating() { if (drag || intro || tween || (touched && hint > 0 && !RM) || Math.abs(vyaw) > 1e-4 || Math.abs(vpitch) > 1e-4) return true; for (var i = 0; i < NS; i++) if (Math.abs(w[i] - targetW(i)) > 0.001) return true; return false; }
    function draw() { if (!S.W) return; camera(); if (D) renderScene(); else { fitGL(); gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } overlay(); return animating() ? undefined : false; }
    var run = E.loop(ov, step, draw);
    S.onresize = function () { fitGL(); run.wake(); run.redraw(); }; E.onTheme.push(function () { readTheme(); run.wake(); run.redraw(); });
    run.onVisible(function () { if (D && !RM && !touched && !intro && !introDone) { introDone = true; intro = { t: 0 }; run.wake(); } });
    enable(fig, false);
    whenNear(fig, function () {
      fetchJSON(fig.getAttribute('data-src-mesh') || fig.getAttribute('data-src')).then(function (d) { build(d); enable(fig, true); if (!RM && !touched && run.visible()) { introDone = true; intro = { t: 0 }; } run.wake(); run.redraw(); })
        .catch(function (e) { note(fig, 'The layers could not be loaded (' + (e && e.message ? e.message : e) + ').'); });
    });
    rangeEl.addEventListener('input', function () { iso = LVL_LO + (+rangeEl.value / 1000) * (LVL_HI - LVL_LO); setOut(outLevel, fmtPhi(iso)); sel = nearest(); touched = true; intro = null; readout(); if (RM) { for (var i = 0; i < NS; i++) w[i] = targetW(i); run.redraw(); } else run.wake(); });
    toggle(cutBtn, function (on) { cut = on; touched = true; intro = null; var ty = on ? yaw0 : YAW3, tp = on ? pitch0 : PITCH3; if (RM) { yaw = ty; pitch = tp; } else tweenTo(ty, tp, 0.9); run.wake(); run.redraw(); });
    function local(e) { var r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    glc.addEventListener('pointerdown', function (e) {
      if (!D || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var p = local(e), touch = e.pointerType === 'touch';
      drag = { id: e.pointerId, x: p[0], y: p[1], sx: p[0], sy: p[1], t: e.timeStamp, last: 0, vx: 0, vy: 0, live: !touch };
      if (drag.live) { vyaw = vpitch = 0; tween = null; intro = null; touched = true; stage.classList.add('is-dragging'); run.wake(); }
      try { glc.setPointerCapture(e.pointerId); } catch (x) {} if (!touch) e.preventDefault();
    });
    glc.addEventListener('pointermove', function (e) {
      if (!D || !drag || drag.id !== e.pointerId) return; var p = local(e);
      if (!drag.live) { var tx = p[0] - drag.sx, ty = p[1] - drag.sy; if (Math.abs(tx) < 6 && Math.abs(ty) < 6) return; if (Math.abs(ty) > Math.abs(tx)) { drag = null; return; } drag.live = true; drag.t = e.timeStamp; vyaw = vpitch = 0; tween = null; intro = null; touched = true; stage.classList.add('is-dragging'); }
      var k = 0.0058 * (420 / Math.max(280, S.W)), a = -(p[0] - drag.x) * k, b = (p[1] - drag.y) * k * 0.7, dtm = Math.max(5, e.timeStamp - drag.t);
      yaw += a; pitch = clamp(pitch + b, PMIN, PMAX); drag.vx = drag.vx * 0.5 + a / dtm * 8.35; drag.vy = drag.vy * 0.5 + b / dtm * 8.35; drag.t = e.timeStamp; drag.last = e.timeStamp; drag.x = p[0]; drag.y = p[1]; run.wake();
    });
    function endDrag(e) { if (!drag || drag.id !== e.pointerId) return; var d = drag; drag = null; stage.classList.remove('is-dragging'); if (d.live && !RM && e.type === 'pointerup' && e.timeStamp - d.last < 90) { vyaw = clamp(d.vx, -0.035, 0.035); vpitch = clamp(d.vy, -0.02, 0.02); } else vyaw = vpitch = 0; run.wake(); }
    glc.addEventListener('pointerup', endDrag); glc.addEventListener('pointercancel', endDrag);
    glc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); note(fig, 'The 3D view was paused by the browser; reload the page to restore it.'); });
    if (fig.hasAttribute('data-dev')) window.__p3dfb = { get: function () { return { yaw: yaw / DEG, pitch: pitch / DEG, drag: !!drag, live: !!(drag && drag.live), touched: touched, intro: !!intro, vyaw: vyaw }; } };   // test hook, dev page only
  }

  function init() { demoPotential3D(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
