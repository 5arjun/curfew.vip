"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { arc, getArcCurve, getAxisTicks, getColumnGenres, getLandmarks, SAMPLES } from "./arc-curve";

// The Landing hero ribbon (Story 6.1, D-1): one night's energy arc as a
// physical object. Scroll turns a flat horizon into the set's own shape and
// then into a thing with depth — flat line, then chart, then object.
//
// Two meshes, deliberately:
//   band — a constant-thickness ribbon tracing the curve. At uAmp 0 it is dead
//          straight, which is the hero's opening horizon. A single filled-area
//          mesh could not do that: collapse its height and it has zero area and
//          rasterizes nothing at all.
//   fill — the area beneath, carrying the app's own DetailArc identity. Its
//          opacity rides uAmp so it does not exist until the shape does.
//
// Colours are read from :root at runtime and passed in as uniforms — the same
// contract --metal-* and --color-abyss-silk already use, and the reason the
// --landing-* tokens are real hex rather than var() aliases.

const WIDTH = 6.4;
const HEIGHT = 1.15;

// The camera never moves, so one world unit is a fixed share of the viewport's
// HEIGHT on every device — which is what makes BAND, the bead's radius and the
// group's resting y portable as they stand. The visible WIDTH is the aspect's
// business, and that is the whole of the phone problem below.
const CAMERA = { fov: 34, z: 5.4 };
const VIEW_HEIGHT = 2 * CAMERA.z * Math.tan((CAMERA.fov * Math.PI) / 360);

// ── Fitting a landscape object into a portrait viewport (2026-08-14) ─────────
// Arjun, on the phone build: "the ribbon doesn't animate nicely on mobile, it
// looks 2d and plain". It was not the ribbon — it was the SVG fallback, which
// every phone got. This is what lets the real one run there.
//
// Only the ribbon's own footprint is wrong on a phone: 6.4 units is four
// viewports across at 390px, and 1.15 tall over 6.4 wide is a 5.6:1 sliver once
// you have squeezed it in. So the meshes get their own scale group INSIDE the
// one that rotates. Scale under rotation is just a shorter, narrower object
// being turned; scale ABOVE rotation would shear it as it turns. The bead stays
// outside that group with the fit applied to its position instead — a
// non-uniform scale would hatch it into an egg, and it is the one thing on
// screen whose shape is not the data's.
//
// x is measured, not chosen: phone aspects run from about 0.42 (a 15 Pro Max in
// portrait) to 0.56 (a short Android), which is a third of a viewport's
// difference in visible width. Any constant wide enough to fill the shortest
// runs off both edges of the tallest.
const COMPACT_HEIGHT = 0.78;
/**
 * Share of the visible width the night is allowed; the rest is margin. 0.90
 * rather than something closer to 1 because the yaw swings the last track
 * TOWARD the camera, where it is magnified — and the bead is riding it, halo
 * and all, a full 0.088 units of sphere that is not scaled by the fit. At 0.94
 * the halo clipped the right edge on a tall phone at the end of the turn.
 */
const COMPACT_FILL = 0.90;

type Fit = {
  x: number;
  y: number;
  thick: number;
  restY: number;
  liftY: number;
  turnX: number;
  turnY: number;
  /**
   * Leftward slide as the night turns (Arjun, 2026-08-15: "I don't like how
   * the ribbon is so far from the left side of the screen"). The gap was the
   * yaw's own perspective: the turn swings the first track AWAY from the
   * camera, and the recession pulled the night's start a sixth of the screen
   * in from the left while the last track overflowed the right. This walks
   * the group back toward the gutter by exactly that recession, keyed to
   * `turn` because the recession is the turn's doing — at rest the horizon
   * stays centred and this contributes nothing.
   */
  shiftX: number;
};

const DESKTOP_FIT: Fit = {
  x: 1,
  y: 1,
  thick: 1,
  restY: -0.95,
  liftY: 0.50,
  turnX: 0.20,
  turnY: -0.44,
  // Tuned at 1440×900 (aspect 1.6): the first track lands ~4% from the left
  // edge at full turn, where it sat ~15% before — clear of the gutter but
  // not kissing the edge (-0.38 put the bead at ~1% and its POI label under
  // the headline). Wider aspects keep a little more margin, which reads
  // fine — the failure mode was the gap at 16:10.
  shiftX: -0.28,
};

const COMPACT_FIT: Omit<Fit, "x" | "shiftX"> = {
  y: COMPACT_HEIGHT / HEIGHT,
  // The band's cross-section rides the same y scale as the curve, which would
  // take it from ~12px to ~8 — thin enough that the lit top edge lands on a
  // half pixel and crawls as the ribbon turns. Put most of it back.
  thick: 1.45,
  // Lower than the desktop rest, because on a phone the upper half of the
  // screen belongs to type: the headline, then the captions. The baseline sits
  // ~15vh off the bottom at rest and ~29vh once the night has opened, which
  // puts the crest around 52vh — clear of a caption that ends near 28vh.
  restY: -1.15,
  liftY: 0.45,
  // Half the desktop's pitch. Yaw is where the depth comes from and it keeps
  // all of it; pitch is what swings everything BELOW the baseline out of the
  // object — and the axis is DOM text that cannot rotate with the plane it is
  // pinned to, so at the desktop's 0.20 the three clock labels stagger
  // diagonally down the screen and read as a fault rather than as perspective.
  turnX: 0.11,
  turnY: -0.44,
};

// The genre strip sits just under the baseline, at constant height — it is a
// legend for the night, not part of the curve, so it must not inflate with it.
const STRIP_TOP = -0.05;
const STRIP_BOTTOM = -0.095;
// Axis ticks hang below the strip. Fitted with the shape rather than left in
// absolute units: it looks like a fixed pixel gap under the baseline, but it is
// a point on a plane that pitches, so leaving it unscaled detaches it from the
// object the moment the ribbon starts to turn.
const AXIS_Y = -0.20;
const BAND = 0.055;
const BAND_ROWS = 4;
const FILL_ROWS = 12;

export type ArcColors = {
  deep: string;
  accent: string;
  crest: string;
  floor: string;
  genre: Record<string, string>;
};

export type Projected = { x: number; y: number; visible: boolean };

type GridAttrs = {
  positions: Float32Array;
  uvs: Float32Array;
  slopes: Float32Array;
  ticks: Float32Array;
  thicks: Float32Array;
  index: Uint32Array;
};

/**
 * Per-column tick strength marking where each of the 44 plays actually starts.
 * Evenly spaced ticks would have been easier and would have been a small lie —
 * the gaps between tracks are the point, and one of them is a 12-minute drift.
 */
function buildTicks(): Float32Array {
  const ticks = new Float32Array(SAMPLES);
  for (const point of arc.points) {
    const column = Math.round(point.t * (SAMPLES - 1));
    if (column >= 0 && column < SAMPLES) ticks[column] = 1;
  }
  return ticks;
}

function buildGrid(rows: number, mode: "band" | "fill"): GridAttrs {
  const { heights, slopes } = getArcCurve();
  const columnTicks = buildTicks();
  const count = SAMPLES * rows;

  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const slopeAttr = new Float32Array(count);
  const tickAttr = new Float32Array(count);
  const thickAttr = new Float32Array(count);

  for (let c = 0; c < SAMPLES; c += 1) {
    const u = c / (SAMPLES - 1);
    const h = heights[c] * HEIGHT;
    for (let r = 0; r < rows; r += 1) {
      const v = r / (rows - 1);
      const i = c * rows + r;

      // The curve height and the band's own thickness are kept in SEPARATE
      // channels on purpose. uAmp scales position.y to flatten the ribbon, and
      // if thickness rode along in there it would flatten too — the hero's
      // opening horizon would have zero area and rasterize nothing.
      positions[i * 3] = (u - 0.5) * WIDTH;
      positions[i * 3 + 1] = mode === "band" ? h : v * h;
      thickAttr[i] = mode === "band" ? (v - 0.5) * BAND : 0;
      positions[i * 3 + 2] = 0;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      slopeAttr[i] = slopes[c];
      tickAttr[i] = columnTicks[c];
    }
  }

  const index = new Uint32Array((SAMPLES - 1) * (rows - 1) * 6);
  let o = 0;
  for (let c = 0; c < SAMPLES - 1; c += 1) {
    for (let r = 0; r < rows - 1; r += 1) {
      const a = c * rows + r;
      const b = (c + 1) * rows + r;
      index[o] = a;
      index[o + 1] = b;
      index[o + 2] = a + 1;
      index[o + 3] = b;
      index[o + 4] = b + 1;
      index[o + 5] = a + 1;
      o += 6;
    }
  }

  return { positions, uvs, slopes: slopeAttr, ticks: tickAttr, thicks: thickAttr, index };
}

/**
 * The genre strip: the app's own per-play colour band, quoted directly under
 * the arc. One column per resampled sample so the boundaries land exactly where
 * the genre actually changes.
 */
function buildStrip(genreColors: Record<string, string>): THREE.BufferGeometry {
  const columns = getColumnGenres();
  const count = SAMPLES * 2;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scratch = new THREE.Color();

  const hsl = { h: 0, s: 0, l: 0 };
  for (let c = 0; c < SAMPLES; c += 1) {
    const u = c / (SAMPLES - 1);
    const hex = genreColors[columns[c]] || genreColors["--chart-cat-other"];
    scratch.set(hex);
    // The chart palette at chart saturation. In the app these colours sit in
    // 20px swatches beside labels; here the strip is a 4px band on the abyss,
    // where full chroma reads as primary-coloured tape stuck under the night.
    // Same hue per genre — the identity survives — at half the saturation, so
    // the strip sits in the ribbon's own register instead of on top of it.
    scratch.getHSL(hsl);
    scratch.setHSL(hsl.h, hsl.s * 0.48, hsl.l * 0.92);
    for (let r = 0; r < 2; r += 1) {
      const i = c * 2 + r;
      positions[i * 3] = (u - 0.5) * WIDTH;
      positions[i * 3 + 1] = r === 0 ? STRIP_BOTTOM : STRIP_TOP;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
  }

  const index = new Uint32Array((SAMPLES - 1) * 6);
  let o = 0;
  for (let c = 0; c < SAMPLES - 1; c += 1) {
    const a = c * 2;
    const b = (c + 1) * 2;
    index[o] = a;
    index[o + 1] = b;
    index[o + 2] = a + 1;
    index[o + 3] = b;
    index[o + 4] = b + 1;
    index[o + 5] = a + 1;
    o += 6;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

const STRIP_VERTEX = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;

void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STRIP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vColor;
uniform float uReveal;
uniform float uAmp;

void main() {
  gl_FragColor = vec4(vColor, uReveal * uAmp * 0.42);
}
`;

function useGeometry(rows: number, mode: "band" | "fill"): THREE.BufferGeometry {
  return useMemo(() => {
    const { positions, uvs, slopes, ticks, thicks, index } = buildGrid(rows, mode);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("aSlope", new THREE.BufferAttribute(slopes, 1));
    geometry.setAttribute("aTick", new THREE.BufferAttribute(ticks, 1));
    geometry.setAttribute("aThick", new THREE.BufferAttribute(thicks, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
  }, [rows, mode]);
}

const VERTEX = /* glsl */ `
attribute float aSlope;
attribute float aTick;
attribute float aThick;
varying vec2 vUv;
varying float vSlope;
varying float vTick;
uniform float uAmp;
uniform float uWave;
uniform float uTime;
uniform float uThick;

void main() {
  vUv = uv;
  vSlope = aSlope;
  vTick = aTick;

  vec3 p = position;
  // Thickness grows with the shape: a quiet hairline at rest, a ribbon with
  // real body once the night has inflated.
  p.y = p.y * uAmp + aThick * uThick;

  // A slow fabric drift so the object has depth to find when it rotates.
  // Scaled by uAmp too: at rest the hero must be a perfectly flat horizon.
  p.z += sin(p.x * 0.85 + uTime * 0.32) * uWave * uAmp;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const BAND_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vSlope;
varying float vTick;
uniform vec3 uDeep;
uniform vec3 uAccent;
uniform vec3 uCrest;
uniform vec3 uFloor;
uniform float uFloorStart;
uniform float uFloorEnd;
uniform float uReveal;
uniform float uAmp;

void main() {
  float v = vUv.y;

  // Cross-section: shadowed underside lifting to a lit top edge, so the strip
  // reads as a surface catching light rather than a drawn stroke.
  vec3 col = mix(uDeep, uAccent, pow(clamp(v, 0.0, 1.0), 1.25));

  // The stretch the detector called the dancefloor — positions 11 to 38.
  float win = smoothstep(uFloorStart - 0.012, uFloorStart + 0.012, vUv.x)
            * (1.0 - smoothstep(uFloorEnd - 0.012, uFloorEnd + 0.012, vUv.x));
  // Emphasis on the detected floor arrives with the shape, not before it.
  col = mix(col, uFloor, win * 0.5 * uAmp);

  // Slope shading: a climb catches light, a fall falls away.
  float lit = clamp(0.5 + vSlope * 0.30, 0.0, 1.5);
  col *= mix(0.70, 1.20, lit);

  float edge = smoothstep(0.74, 1.0, v);
  col += uCrest * edge * (0.16 + 0.34 * uAmp + 0.30 * win * uAmp);

  // At rest this is a horizon, not a light bar: the whole band sits back until
  // the shape exists to justify it.
  col *= 0.42 + 0.58 * uAmp;

  // One tick per real play start.
  col += uAccent * vTick * 0.55 * uAmp;

  // ── The resting horizon (Arjun, 2026-08-14: "make that look more natural
  //    until the scroll") ──────────────────────────────────────────────────
  // Flat is the point — the hero opens on a horizon and scroll inflates it —
  // but flat plus edge-to-edge plus uniform alpha reads as a rule ruled across
  // the page, and against the mesh behind it that seam is the first thing the
  // eye finds. Two falloffs, both keyed to uAmp so they cost nothing once the
  // shape exists:
  //
  //   ends — dissolve the last sixth at each side, so the line arrives from
  //          somewhere and leaves for somewhere. It relaxes as the arc
  //          inflates because by then the first and last track are
  //          information, and fading them away would be a small lie.
  //   body — feather the cross-section. At rest the band is ~3px tall, which
  //          rasterizes as a hard bar with an aliased top edge; softening it
  //          turns the same geometry into a line of light. At full amplitude
  //          the ribbon wants its real edges back, so this goes to 1 too.
  float ends = smoothstep(0.0, 0.17, vUv.x) * (1.0 - smoothstep(0.83, 1.0, vUv.x));
  float body = smoothstep(0.0, 0.34, v) * (1.0 - smoothstep(0.66, 1.0, v));
  float alpha = uReveal
    * mix(ends, 1.0, uAmp * 0.72)
    * mix(body, 1.0, smoothstep(0.0, 0.45, uAmp));

  gl_FragColor = vec4(col, alpha);
}
`;

const FILL_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vSlope;
varying float vTick;
uniform vec3 uDeep;
uniform vec3 uAccent;
uniform vec3 uFloor;
uniform float uFloorStart;
uniform float uFloorEnd;
uniform float uReveal;
uniform float uAmp;

void main() {
  float v = vUv.y;
  float win = smoothstep(uFloorStart - 0.012, uFloorStart + 0.012, vUv.x)
            * (1.0 - smoothstep(uFloorEnd - 0.012, uFloorEnd + 0.012, vUv.x));

  vec3 col = mix(uDeep, mix(uAccent, uFloor, win), pow(clamp(v, 0.0, 1.0), 1.6));
  col += uAccent * vTick * 0.10;

  // The band dissolves at its two ends; this never did, because on a desktop
  // both of them are off the side of the screen. On a phone the whole night is
  // in frame, and the area under it ended in a hard vertical cut on both sides
  // — the one edge on this page that was a rectangle rather than a shape.
  // Tighter than the band's falloff (0.17) and NOT relaxed by uAmp: the band
  // relaxes because its ends become information once the arc has inflated,
  // whereas this is a wall, and the wall is worst at full amplitude.
  float ends = smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x));

  // Densest just under the crest, fading to nothing at the baseline — the
  // DetailArc's own area treatment, carried across.
  float alpha = uReveal * uAmp * ends * mix(0.0, 0.30, pow(clamp(v, 0.0, 1.0), 2.0));
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * One declaration set, instantiated twice. The band and fill shaders each
 * declare a subset of it; an unused uniform is harmless, and a single shape
 * means the per-frame writer below cannot update one mesh and forget the other.
 */
function createUniforms() {
  return {
    uAmp: { value: 0 },
    uWave: { value: 0.16 },
    uThick: { value: 0.22 },
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uCrest: { value: new THREE.Color() },
    uFloor: { value: new THREE.Color() },
    uFloorStart: { value: arc.dancefloor.tStart },
    uFloorEnd: { value: arc.dancefloor.tEnd },
  };
}

const MARKER_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// A lit bead rather than a flat dot: a fake key light off the upper left, a
// tight specular, and a rim that lifts it off the ribbon it is riding.
const MARKER_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
uniform vec3 uCrest;
uniform vec3 uAccent;
uniform float uReveal;

void main() {
  vec3 light = normalize(vec3(-0.4, 0.8, 0.6));
  float key = clamp(dot(vNormal, light), 0.0, 1.0);
  float spec = pow(key, 22.0);
  float rim = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), 2.2);
  vec3 col = mix(uAccent, uCrest, 0.35 + 0.65 * key) + uCrest * spec * 0.9 + uCrest * rim * 0.5;
  gl_FragColor = vec4(col, uReveal);
}
`;

const HALO_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
uniform vec3 uCrest;
uniform float uReveal;

void main() {
  float core = pow(clamp(dot(vNormal, vView), 0.0, 1.0), 2.4);
  gl_FragColor = vec4(uCrest, core * 0.38 * uReveal);
}
`;

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type SceneProps = {
  colors: ArcColors;
  /** 0..1 scroll progress through the hero + explorer beats. */
  progress: () => number;
  reduced: boolean;
  /** Portrait phone: the same ribbon, refitted. See COMPACT_FIT. */
  compact: boolean;
  onProject?: (poi: Projected[], axis: Projected[]) => void;
};

function Ribbon({ colors, progress, reduced, compact, onProject }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const shape = useRef<THREE.Group>(null);
  const bandGeometry = useGeometry(BAND_ROWS, "band");
  const fillGeometry = useGeometry(FILL_ROWS, "fill");
  const { camera, size } = useThree();

  // Re-fits on rotate and on the browser chrome collapsing under scroll. It is
  // only a scale and two numbers — no geometry is rebuilt, which is the reason
  // the fit is a scale group and not a differently-sized mesh.
  const fit = useMemo<Fit>(() => {
    if (!compact) return DESKTOP_FIT;
    const visibleWidth = VIEW_HEIGHT * (size.width / Math.max(1, size.height));
    return {
      ...COMPACT_FIT,
      x: (visibleWidth * COMPACT_FILL) / WIDTH,
      // Proportional rather than the desktop constant: 0.38 units is a third
      // of a short phone's whole visible width. A tenth of the visible width
      // matches the desktop correction's effect at the phone's own scale.
      shiftX: -0.10 * visibleWidth,
    };
  }, [compact, size.width, size.height]);
  const eased = useRef(0);
  // Mount fade. Deliberately NOT tied to scroll: the flat horizon is the first
  // thing the hero shows, so it has to be on screen at progress 0.
  const born = useRef(0);
  const axisTicks = useMemo(() => getAxisTicks(), []);
  const landmarks = useMemo(() => getLandmarks(), []);
  const projectedPoi = useRef<Projected[]>(landmarks.map(() => ({ x: 0, y: 0, visible: false })));
  const projectedAxis = useRef<Projected[]>(axisTicks.map(() => ({ x: 0, y: 0, visible: false })));
  const stripGeometry = useMemo(() => buildStrip(colors.genre), [colors.genre]);
  const scratch = useRef(new THREE.Vector3());

  // Built at render, never mutated at render: every per-frame write goes
  // through the material refs below, which is both what r3f expects and what
  // keeps this off the compiler's "mutated after render" path.
  const bandUniforms = useMemo(() => createUniforms(), []);
  const fillUniforms = useMemo(() => createUniforms(), []);
  const stripUniforms = useMemo(() => createUniforms(), []);
  const markerUniforms = useMemo(() => createUniforms(), []);
  const haloUniforms = useMemo(() => createUniforms(), []);
  const markerGeometry = useMemo(() => new THREE.SphereGeometry(0.043, 24, 16), []);
  const haloGeometry = useMemo(() => new THREE.SphereGeometry(0.088, 20, 14), []);
  const marker = useRef<THREE.Group>(null);
  const bandMaterial = useRef<THREE.ShaderMaterial>(null);
  const fillMaterial = useRef<THREE.ShaderMaterial>(null);
  const stripMaterial = useRef<THREE.ShaderMaterial>(null);
  const markerMaterial = useRef<THREE.ShaderMaterial>(null);
  const haloMaterial = useRef<THREE.ShaderMaterial>(null);

  // Colours arrive from :root after mount, so they are pushed in rather than
  // baked at construction — a token change retints without rebuilding shaders.
  useEffect(() => {
    for (const material of [bandMaterial.current, fillMaterial.current]) {
      if (!material) continue;
      material.uniforms.uDeep.value.set(colors.deep);
      material.uniforms.uAccent.value.set(colors.accent);
      material.uniforms.uCrest.value.set(colors.crest);
      material.uniforms.uFloor.value.set(colors.floor);
    }
  }, [colors]);

  useFrame((state, delta) => {
    const target = reduced ? 0.72 : progress();
    // Critically-damped-ish follow. This is the ribbon's own smoothing, which
    // is why the hero does not depend on the page's smooth-scroll library.
    eased.current += (target - eased.current) * Math.min(1, delta * (reduced ? 60 : 6));
    const p = eased.current;

    born.current = Math.min(1, born.current + delta / 0.9);
    const amp = easeOutCubic(smoothstep(0, 0.36, p));
    const turn = smoothstep(0.26, 0.96, p);

    for (const material of [markerMaterial.current, haloMaterial.current]) {
      if (!material) continue;
      material.uniforms.uCrest.value.set(colors.crest);
      material.uniforms.uAccent.value.set(colors.accent);
    }
    for (const material of [bandMaterial.current, fillMaterial.current, stripMaterial.current]) {
      if (!material) continue;
      material.uniforms.uAmp.value = amp;
      material.uniforms.uReveal.value = born.current * 0.98;
      material.uniforms.uTime.value = reduced ? 0 : state.clock.elapsedTime;
      material.uniforms.uWave.value = reduced ? 0 : 0.16 * turn;
      material.uniforms.uThick.value = (0.22 + 0.78 * amp) * fit.thick;
    }

    if (group.current) {
      group.current.rotation.y = fit.turnY * turn;
      group.current.rotation.x = fit.turnX * turn;
      // Sits low like a horizon at rest, lifting only as the arc needs room.
      group.current.position.y = fit.restY + fit.liftY * amp;
      group.current.position.x = fit.shiftX * turn;
      group.current.position.z = -0.55 * turn;
    }

    // The travelling bead: where "now" is, as the night plays out under scroll.
    if (marker.current) {
      const walk = Math.min(1, Math.max(0, (p - 0.3) / 0.62));
      const column = Math.round(walk * (SAMPLES - 1));
      const { heights } = getArcCurve();
      // The fit is applied to the bead's POSITION, not its scale — but the
      // wave's phase has to be read in the geometry's own pre-fit x, because
      // the vertex shader computes it inside the scale group too.
      const local = (walk - 0.5) * WIDTH;
      marker.current.position.set(
        local * fit.x,
        (heights[column] * HEIGHT * amp + BAND * 0.5) * fit.y,
        // Mirrors the vertex shader's drift so the bead sits ON the ribbon
        // rather than hovering in front of it once the surface starts moving.
        Math.sin(local * 0.85 + (reduced ? 0 : state.clock.elapsedTime) * 0.32) *
          (reduced ? 0 : 0.16 * turn) *
          amp,
      );
      const shown = p > 0.3 ? 1 : 0;
      for (const material of [markerMaterial.current, haloMaterial.current]) {
        if (material) material.uniforms.uReveal.value = shown * born.current;
      }
      marker.current.visible = shown > 0;
    }

    if (!onProject || !group.current) return;
    const { heights } = getArcCurve();
    let changed = false;

    const place = (
      store: Projected[],
      i: number,
      localX: number,
      localY: number,
      shown: boolean,
    ) => {
      scratch.current.set(localX, localY, 0);
      group.current!.localToWorld(scratch.current);
      scratch.current.project(camera);
      const entry = store[i];
      const x = (scratch.current.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.current.y * 0.5 + 0.5) * size.height;
      if (Math.abs(entry.x - x) > 0.5 || Math.abs(entry.y - y) > 0.5 || entry.visible !== shown) {
        entry.x = x;
        entry.y = y;
        entry.visible = shown;
        changed = true;
      }
    };

    // Each landmark lights when the bead reaches it, not all at once at a
    // magic progress number. The old gate (p > 0.62) fired every label on the
    // same frame the second caption arrived — four texts landing together, two
    // of them under the caption's own box. Walking them in with the bead
    // spreads the reveals across the scroll and means a label can only appear
    // at the moment the night has actually got there.
    const beadWalk = Math.min(1, Math.max(0, (p - 0.3) / 0.62));
    for (let i = 0; i < landmarks.length; i += 1) {
      const poi = landmarks[i];
      const column = Math.round(poi.t * (SAMPLES - 1));
      place(
        projectedPoi.current,
        i,
        (poi.t - 0.5) * WIDTH * fit.x,
        (heights[column] * HEIGHT * amp + BAND * 0.5) * fit.y,
        p > 0.3 && beadWalk >= poi.t,
      );
    }

    for (let i = 0; i < axisTicks.length; i += 1) {
      place(
        projectedAxis.current,
        i,
        (axisTicks[i].t - 0.5) * WIDTH * fit.x,
        AXIS_Y * fit.y,
        amp > 0.55,
      );
    }

    if (changed) onProject(projectedPoi.current, projectedAxis.current);
  });

  return (
    <group ref={group}>
      {/* renderOrder, not declaration order. All five meshes are transparent
          with depthWrite off, so what stacks over what comes out of the sort —
          which until now happened to follow the order they were written in.
          The fit group puts a nesting level between them, so the stack is
          stated instead: area, genre strip, bead, band on top. */}
      <group ref={shape} scale={[fit.x, fit.y, 1]}>
        <mesh geometry={fillGeometry} frustumCulled={false} renderOrder={0}>
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={FILL_FRAGMENT}
            ref={fillMaterial}
            uniforms={fillUniforms}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh geometry={stripGeometry} frustumCulled={false} renderOrder={1}>
          <shaderMaterial
            ref={stripMaterial}
            vertexShader={STRIP_VERTEX}
            fragmentShader={STRIP_FRAGMENT}
            uniforms={stripUniforms}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh geometry={bandGeometry} frustumCulled={false} renderOrder={4}>
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={BAND_FRAGMENT}
            ref={bandMaterial}
            uniforms={bandUniforms}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      <group ref={marker} visible={false}>
        <mesh geometry={haloGeometry} frustumCulled={false} renderOrder={2}>
          <shaderMaterial
            ref={haloMaterial}
            vertexShader={MARKER_VERTEX}
            fragmentShader={HALO_FRAGMENT}
            uniforms={haloUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh geometry={markerGeometry} frustumCulled={false} renderOrder={3}>
          <shaderMaterial
            ref={markerMaterial}
            vertexShader={MARKER_VERTEX}
            fragmentShader={MARKER_FRAGMENT}
            uniforms={markerUniforms}
            transparent
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

export default function ArcRibbonCanvas(props: SceneProps) {
  return (
    <Canvas
      className="lp-canvas"
      // A phone's dpr is 3, and this is a full-viewport transparent layer over
      // a full-viewport mesh shader. 1.75 is where the band's lit top edge
      // stops being the thing that gives the resolution away; the rest of the
      // frame is a gradient with nothing in it to alias. antialias stays on for
      // the same reason it is on everywhere else — at rest this whole object is
      // one ~7px line, and MSAA is the difference between a line and a stair.
      dpr={props.compact ? [1, 1.75] : [1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: CAMERA.fov, position: [0, 0.15, CAMERA.z], near: 0.1, far: 40 }}
      frameloop={props.reduced ? "demand" : "always"}
    >
      <Ribbon {...props} />
    </Canvas>
  );
}
