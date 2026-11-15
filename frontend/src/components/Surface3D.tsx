import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { errorRamp, ramp, sampleGrid } from '../lib/field';
import { prefersReducedMotion } from '../lib/motion';

export interface P3 {
  u: number;
  v: number;
  kind: 'run' | 'check' | 'pending';
}
export interface Beacon {
  u: number;
  v: number;
  state: 'plain' | 'open' | 'hit' | 'ghost';
}
export interface Layers {
  surface: boolean;
  grid: boolean;
  contours: boolean;
  runs: boolean;
  features: boolean;
}
export const ALL_LAYERS: Layers = { surface: true, grid: true, contours: true, runs: true, features: true };

interface Props {
  z: Float32Array | null;
  grid: number;
  lo: number;
  hi: number;
  gamma: number;
  /** Optional colouring that replaces the output colours: values 0..1 on the same grid, drawn with the error ramp. */
  tint?: Float32Array | null;
  points?: P3[];
  /** Changes whenever the points belong to a different series, so they appear at once instead of dropping in. */
  pointsKey?: string;
  beacons?: Beacon[];
  layers?: Layers;
  autoRotate?: boolean;
  label: string;
}

export interface Surface3DHandle {
  snapshot(): string | null;
  resetView(): void;
  zoom(factor: number): void;
}

const H = 0.78; // height of the full output range, in scene units (the map is 2 x 2)
const MAX_POINTS = 2400;
const HOME = new THREE.Vector3(2.45, 1.8, 2.65);
const TARGET = new THREE.Vector3(0, 0.22, 0);

const toLinear = (c: [number, number, number]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

const SURFACE_VERT = /* glsl */ `
attribute float aT;
varying vec3 vColor;
varying float vT;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vColor = color;
  vT = aT;
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SURFACE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uContours;
uniform float uGrid;
uniform float uScan;
uniform float uDim;
varying vec3 vColor;
varying float vT;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
float line(float x, float w) {
  float f = abs(fract(x - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, w, f / max(fwidth(x), 1e-4));
}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(0.35, 0.9, 0.45));
  float diff = 0.42 + 0.58 * max(dot(n, L), 0.0);
  vec3 base = vColor * uDim;
  vec3 c = base * diff;
  float cl = line(vT * 16.0, 1.0) * uContours;
  c = mix(c, base * 1.55 + 0.05, cl * 0.75);
  float g = max(line(vUv.x * 28.0, 0.7), line(vUv.y * 28.0, 0.7)) * uGrid;
  c += vec3(0.22, 0.5, 1.0) * g * 0.22;
  float sx = mod(uTime * 0.22, 1.7) - 0.35;
  float s = exp(-pow((vUv.x + vUv.y * 0.35 - sx) * 26.0, 2.0)) * uScan;
  c += vec3(0.35, 0.85, 1.0) * s * 0.5;
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  c += base * rim * 0.35;
  gl_FragColor = vec4(c, uOpacity);
}`;

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aBorn;
attribute float aPulse;
uniform float uTime;
uniform float uScale;
varying vec3 vC;
varying float vA;
void main() {
  float age = uTime - aBorn;
  float drop = clamp(1.0 - age / 0.75, 0.0, 1.0);
  vec3 p = position;
  p.y += drop * drop * 0.95;
  vA = age < 0.0 ? 0.0 : 1.0 - drop * 0.4;
  float pulse = aPulse > 0.5 ? 0.8 + 0.35 * sin(uTime * 5.0 + position.x * 9.0) : 1.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * uScale * pulse * (1.0 + drop * 1.6) / -mv.z;
  gl_Position = projectionMatrix * mv;
  vC = aColor;
}`;

const POINT_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.2, 0.0, r);
  float halo = smoothstep(0.5, 0.05, r) * 0.5;
  gl_FragColor = vec4(vC * (core * 1.7 + halo), (core + halo) * vA);
}`;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(40,120,255,0.55)');
  grad.addColorStop(0.45, 'rgba(20,70,200,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Scene {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  beacons: THREE.Group;
  res: number;
  cur: { pos: Float32Array; col: Float32Array; t: Float32Array };
  tgt: { y: Float32Array; col: Float32Array; t: Float32Array };
  morphing: boolean;
  introUntil: number;
  clock: THREE.Clock;
  reduced: boolean;
}

/** The surface as a glowing 3D terrain: output as height and colour, runs as falling sparks, features as light pillars. */
export const Surface3D = forwardRef<Surface3DHandle, Props>(function Surface3D(
  { z, grid, lo, hi, gamma, tint, points = [], pointsKey = '', beacons = [], layers = ALL_LAYERS, autoRotate = true, label },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const sc = useRef<Scene | null>(null);
  const [failed, setFailed] = useState(false);
  const seen = useRef<{ key: string; n: number }>({ key: '', n: 0 });

  /* ---------- build the scene once ---------- */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    const reduced = prefersReducedMotion();
    const small = el.clientWidth < 640;
    const res = small ? 85 : 129;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.setClearColor(0x03060c, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    scene.fog = new THREE.Fog(0x03060c, 4.2, 8.5);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);
    camera.position.copy(reduced ? HOME : HOME.clone().multiplyScalar(2.3).add(new THREE.Vector3(0, 1.6, 0)));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.enableZoom = false; // the page scrolls with the wheel; zoom has its own buttons
    controls.minDistance = 1.3;
    controls.maxDistance = 6.5;
    controls.maxPolarAngle = 1.48;
    controls.autoRotateSpeed = 0.55;

    /* surface */
    const n = res * res;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const tt = new Float32Array(n);
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const k = i * res + j;
        const u = j / (res - 1);
        const v = i / (res - 1);
        pos[3 * k] = u * 2 - 1;
        pos[3 * k + 1] = 0;
        pos[3 * k + 2] = 1 - v * 2;
        uv[2 * k] = u;
        uv[2 * k + 1] = v;
        col[3 * k] = 0.05;
        col[3 * k + 1] = 0.09;
        col[3 * k + 2] = 0.22;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < res - 1; i++)
      for (let j = 0; j < res - 1; j++) {
        const a = i * res + j;
        idx.push(a, a + 1, a + res, a + 1, a + res + 1, a + res);
      }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.96 },
        uContours: { value: 1 },
        uGrid: { value: 1 },
        uScan: { value: reduced ? 0 : 1 },
        uDim: { value: 1 },
      },
    });
    const surface = new THREE.Mesh(geo, mat);
    scene.add(surface);

    /* floor: grid, glow pool, frame, dust */
    const floor = new THREE.GridHelper(3.4, 34, 0x1d4a8f, 0x0c1d3a);
    floor.position.y = -0.08;
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.55;
    scene.add(floor);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.079;
    scene.add(pool);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.04, 0.001, 2.04)),
      new THREE.LineBasicMaterial({ color: 0x2b6cff, transparent: true, opacity: 0.55 }),
    );
    frame.position.y = -0.078;
    scene.add(frame);
    const corner = new THREE.Group();
    for (const [x, zz] of [[-1.02, -1.02], [1.02, -1.02], [-1.02, 1.02], [1.02, 1.02]] as const) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -0.078, zz), new THREE.Vector3(x, 0.95, zz)]);
      corner.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1f4fae, transparent: true, opacity: 0.25 })));
    }
    scene.add(corner);
    const dustGeo = new THREE.BufferGeometry();
    const dust = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      dust[3 * i] = (Math.random() - 0.5) * 6;
      dust[3 * i + 1] = Math.random() * 2.6 - 0.3;
      dust[3 * i + 2] = (Math.random() - 0.5) * 6;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    const dustPts = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x4f8dff, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scene.add(dustPts);

    /* runs */
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    pg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    pg.setAttribute('aBorn', new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    pg.setAttribute('aPulse', new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    pg.setDrawRange(0, 0);
    const pm = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
    });
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false;
    // Transparent objects are sorted far-to-near by bounding-sphere centre. The runs and the
    // surface both sit near the origin, so without this the order flips with the view angle
    // and the 96%-opaque surface can paint over every run. Always draw them after it; the
    // surface still writes depth, so a run behind a hill stays hidden.
    pts.renderOrder = 1;
    scene.add(pts);

    const beaconGroup = new THREE.Group();
    beaconGroup.renderOrder = 1; // same reason, for the feature pillars and rings
    scene.add(beaconGroup);

    /* post: bloom */
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.45, 0.8);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const clock = new THREE.Clock();
    const s: Scene = {
      renderer, composer, bloom, camera, controls, surface, points: pts, beacons: beaconGroup, res,
      cur: { pos, col, t: tt },
      tgt: { y: new Float32Array(n), col: Float32Array.from(col), t: new Float32Array(n) },
      morphing: false,
      introUntil: reduced ? 0 : 2.2,
      clock,
      reduced,
    }; // prettier-ignore
    sc.current = s;
    controls.addEventListener('start', () => (s.introUntil = 0));

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      pm.uniforms.uScale.value = h * 0.55 * renderer.getPixelRatio();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.01 });
    io.observe(el);

    const start = HOME.clone().multiplyScalar(2.3).add(new THREE.Vector3(0, 1.6, 0));
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      const t = clock.getElapsedTime();
      if (s.introUntil > 0) {
        const f = Math.min(1, t / s.introUntil);
        const e = 1 - Math.pow(1 - f, 4);
        camera.position.lerpVectors(start, HOME, e);
        if (f >= 1) s.introUntil = 0;
      }
      if (s.morphing) step(s);
      mat.uniforms.uTime.value = t;
      pm.uniforms.uTime.value = t;
      dustPts.rotation.y = t * 0.012;
      let bi = 0;
      for (const b of beaconGroup.children) {
        const ring = b.userData.ring as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
        if (!ring) continue;
        const ph = s.reduced ? 0.4 : (t * 0.55 + bi * 0.17) % 1;
        ring.scale.setScalar(1 + ph * 1.8);
        ring.material.opacity = (1 - ph) * (b.userData.dim ? 0.45 : 0.95);
        bi++;
      }
      controls.update();
      composer.render();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      clearBeacons(beaconGroup);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else if (mm) {
          (mm as THREE.MeshBasicMaterial).map?.dispose();
          mm.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sc.current = null;
    };
  }, []);

  /* ---------- the surface: heights and colours ---------- */
  useEffect(() => {
    const s = sc.current;
    if (!s) return;
    const res = s.res;
    const span = hi > lo ? hi - lo : 1;
    const { y, col, t } = s.tgt;
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const k = i * res + j;
        const u = j / (res - 1);
        const v = i / (res - 1);
        if (!z) {
          y[k] = 0;
          col[3 * k] = 0.03;
          col[3 * k + 1] = 0.06;
          col[3 * k + 2] = 0.16;
          t[k] = 0;
          continue;
        }
        const raw = (sampleGrid(z, grid, u, v) - lo) / span;
        const c01 = Math.min(1, Math.max(0, raw));
        const shown = Math.pow(c01, gamma);
        y[k] = Math.min(1.15, Math.max(-0.08, raw < 0 ? raw : shown)) * H;
        const tv = tint ? sampleGrid(tint, grid, u, v) : shown;
        const c = toLinear(tint ? errorRamp(tv) : ramp(c01, gamma));
        col[3 * k] = c.r;
        col[3 * k + 1] = c.g;
        col[3 * k + 2] = c.b;
        t[k] = tv;
      }
    }
    s.surface.material.uniforms.uContours.value = z ? (layers.contours ? 1 : 0) : 0;
    s.morphing = true;
    if (s.reduced) step(s, 1);
    placePoints(s, points, seen.current, pointsKey, true);
    placeBeacons(s, beacons);
    // placement depends on heights, which the next effects also read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z, grid, lo, hi, gamma, tint]);

  /* ---------- runs ---------- */
  useEffect(() => {
    const s = sc.current;
    if (s) placePoints(s, points, seen.current, pointsKey, false);
  }, [points, pointsKey]);

  /* ---------- feature beacons ---------- */
  const beaconSig = beacons.map((b) => `${b.u.toFixed(4)},${b.v.toFixed(4)},${b.state}`).join('|');
  useEffect(() => {
    const s = sc.current;
    if (s) placeBeacons(s, beacons);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beaconSig]);

  /* ---------- layers and rotation ---------- */
  useEffect(() => {
    const s = sc.current;
    if (!s) return;
    const u = s.surface.material.uniforms;
    s.surface.visible = layers.surface;
    u.uGrid.value = layers.grid ? 1 : 0;
    u.uContours.value = z && layers.contours ? 1 : 0;
    s.points.visible = layers.runs;
    s.beacons.visible = layers.features;
  }, [layers, z]);
  useEffect(() => {
    const s = sc.current;
    if (s) s.controls.autoRotate = autoRotate && !s.reduced;
  }, [autoRotate]);

  useImperativeHandle(ref, () => ({
    snapshot() {
      const s = sc.current;
      if (!s) return null;
      s.composer.render();
      return s.renderer.domElement.toDataURL('image/png');
    },
    resetView() {
      const s = sc.current;
      if (!s) return;
      s.camera.position.copy(HOME);
      s.controls.target.copy(TARGET);
    },
    zoom(factor: number) {
      const s = sc.current;
      if (!s) return;
      const d = s.camera.position.clone().sub(s.controls.target);
      const len = Math.min(s.controls.maxDistance, Math.max(s.controls.minDistance, d.length() * factor));
      s.camera.position.copy(s.controls.target).add(d.setLength(len));
    },
  }));

  return (
    <div className="surface3d" ref={host} role="img" aria-label={label}>
      {failed && <p className="surface-fallback">3D needs WebGL, which this browser has turned off. The flat maps below show the same surfaces.</p>}
    </div>
  );
});

/* ---------- helpers that work on the live scene ---------- */

/** Move the drawn surface a step towards the target heights and colours. */
function step(s: Scene, k = 0.14) {
  const { pos, col, t } = s.cur;
  const tg = s.tgt;
  const n = s.res * s.res;
  let moving = false;
  for (let i = 0; i < n; i++) {
    const dy = tg.y[i] - pos[3 * i + 1];
    if (Math.abs(dy) > 1e-4) moving = true;
    pos[3 * i + 1] += dy * k;
    t[i] += (tg.t[i] - t[i]) * k;
  }
  for (let i = 0; i < 3 * n; i++) {
    const d = tg.col[i] - col[i];
    if (Math.abs(d) > 1e-3) moving = true;
    col[i] += d * k;
  }
  const g = s.surface.geometry;
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
  g.attributes.aT.needsUpdate = true;
  g.computeVertexNormals();
  if (!moving || k >= 1) s.morphing = false;
}

/** Height of the target surface at (u, v), in scene units. */
function heightAt(s: Scene, u: number, v: number): number {
  const r = s.res;
  const x = Math.min(1, Math.max(0, u)) * (r - 1);
  const y = Math.min(1, Math.max(0, v)) * (r - 1);
  const j0 = Math.min(r - 2, Math.floor(x));
  const i0 = Math.min(r - 2, Math.floor(y));
  const fx = x - j0;
  const fy = y - i0;
  const h = s.tgt.y;
  return (
    h[i0 * r + j0] * (1 - fx) * (1 - fy) + h[i0 * r + j0 + 1] * fx * (1 - fy) + h[(i0 + 1) * r + j0] * (1 - fx) * fy + h[(i0 + 1) * r + j0 + 1] * fx * fy
  );
}

const C_RUN = toLinear([215, 238, 255]);
const C_CHECK = toLinear([47, 243, 160]);
const C_PENDING = toLinear([255, 194, 75]);

function placePoints(s: Scene, pts: P3[], seen: { key: string; n: number }, key: string, heightsOnly: boolean) {
  const g = s.points.geometry;
  const P = g.attributes.position.array as Float32Array;
  const C = g.attributes.aColor.array as Float32Array;
  const S = g.attributes.aSize.array as Float32Array;
  const B = g.attributes.aBorn.array as Float32Array;
  const U = g.attributes.aPulse.array as Float32Array;
  const n = Math.min(MAX_POINTS, pts.length);
  const now = s.clock.getElapsedTime();
  const fresh = key !== seen.key || n < seen.n;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    P[3 * i] = p.u * 2 - 1;
    P[3 * i + 1] = heightAt(s, p.u, p.v) + 0.018;
    P[3 * i + 2] = 1 - p.v * 2;
    if (heightsOnly) continue;
    const c = p.kind === 'check' ? C_CHECK : p.kind === 'pending' ? C_PENDING : C_RUN;
    C[3 * i] = c.r;
    C[3 * i + 1] = c.g;
    C[3 * i + 2] = c.b;
    S[i] = p.kind === 'check' ? 0.07 : p.kind === 'pending' ? 0.08 : 0.042;
    U[i] = p.kind === 'pending' ? 1 : 0;
    if (fresh) B[i] = now - 5 + (s.reduced ? 0 : Math.min(0.9, i * 0.004)) - 0.9;
    else if (i >= seen.n) B[i] = s.reduced ? now - 5 : now + (i - seen.n) * 0.025;
  }
  g.attributes.position.needsUpdate = true;
  if (!heightsOnly) {
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aBorn.needsUpdate = true;
    g.attributes.aPulse.needsUpdate = true;
    seen.key = key;
    seen.n = n;
  }
  g.setDrawRange(0, n);
}

function clearBeacons(group: THREE.Group) {
  for (const b of [...group.children]) {
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
    group.remove(b);
  }
}

const BEACON_COLOR: Record<Beacon['state'], number> = { plain: 0x9ec5ff, open: 0x9ec5ff, hit: 0x2ff3a0, ghost: 0xff4d6a };

function placeBeacons(s: Scene, beacons: Beacon[]) {
  clearBeacons(s.beacons);
  for (const b of beacons) {
    const x = b.u * 2 - 1;
    const zz = 1 - b.v * 2;
    const h = heightAt(s, b.u, b.v);
    const color = new THREE.Color(BEACON_COLOR[b.state]);
    const dim = b.state === 'open' || b.state === 'plain';
    const g = new THREE.Group();
    const tall = b.state === 'ghost' ? 0.3 : 0.46;
    const pillarGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, h, zz), new THREE.Vector3(x, h + tall, zz)]);
    pillarGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([color.r, color.g, color.b, 0, 0, 0]), 3),
    );
    g.add(
      new THREE.Line(
        pillarGeo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: dim ? 0.55 : 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      ),
    );
    const ringBase = new THREE.Mesh(
      new THREE.RingGeometry(0.036, 0.046, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dim ? 0.6 : 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ringBase.rotation.x = -Math.PI / 2;
    ringBase.position.set(x, h + 0.012, zz);
    g.add(ringBase);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.047, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, h + 0.014, zz);
    g.add(ring);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(b.state === 'hit' ? 0.014 : 0.011, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dim ? 0.7 : 1 }),
    );
    cap.position.set(x, h + tall, zz);
    g.add(cap);
    g.userData = { ring, dim };
    s.beacons.add(g);
  }
}
