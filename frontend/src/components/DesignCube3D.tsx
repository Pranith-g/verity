import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { prefersReducedMotion } from '../lib/motion';
import type { InitDesignExample } from '../types';

export interface DesignTile {
  key: string;
  ex: InitDesignExample;
  /** CSS hex colour for the runs on this tile. */
  color: string;
  /** Draw the n×n Latin-hypercube grid on the floor. */
  grid: boolean;
}

interface Props {
  tiles: DesignTile[];
  label: string;
}

const HALF = 1; // each unit square is 2×2 world units
const GAP = 0.32; // space between tiles
const PILLAR_MAX = 1.25;

/** Distance from each run to its nearest neighbour, in unit-square units. */
export function nearestDistances(points: [number, number][]): number[] {
  return points.map(([u, v], i) => {
    let best = Infinity;
    points.forEach(([a, b], j) => {
      if (j !== i) best = Math.min(best, Math.hypot(u - a, v - b));
    });
    return Number.isFinite(best) ? best : 0;
  });
}

/**
 * The opening runs of each design as glowing pillars on a floating tile.
 * Pillar height is the distance to the nearest other run, so a design with even spacing reads as an even skyline;
 * the closest pair is joined by a bright line and the biggest blind spot is a red well. Drag to turn it.
 */
export function DesignCube3D({ tiles, label }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || tiles.length === 0) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return; // no WebGL: the flat view is still one click away
    }
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    scene.add(new THREE.AmbientLight(0x8fb0ff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 6, 4);
    scene.add(key);

    const span = tiles.length * 2 * HALF + (tiles.length - 1) * GAP;
    const offsets = tiles.map((_, i) => -span / 2 + HALF + i * (2 * HALF + GAP));
    const allNN = tiles.map((t) => nearestDistances(t.ex.points));
    const nnMax = Math.max(1e-6, ...allNN.flat());

    type Pillar = { mesh: THREE.Mesh; cap: THREE.Mesh; h: number; delay: number };
    const pillars: Pillar[] = [];
    const wells: { ring: THREE.Mesh; wall: THREE.Mesh }[] = [];
    const pillarGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 14, 1);
    pillarGeo.translate(0, 0.5, 0); // grow from the floor
    const capGeo = new THREE.SphereGeometry(0.075, 18, 14);

    tiles.forEach((tile, ti) => {
      const ox = offsets[ti];
      const color = new THREE.Color(tile.color);
      const toX = (u: number) => ox + (u - 0.5) * 2 * HALF;
      const toZ = (v: number) => -(v - 0.5) * 2 * HALF;

      /* floor: dark glass slab with a lit rim */
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(2 * HALF, 0.06, 2 * HALF),
        new THREE.MeshStandardMaterial({ color: 0x0a1426, roughness: 0.35, metalness: 0.4, transparent: true, opacity: 0.85 }),
      );
      slab.position.set(ox, -0.03, 0);
      scene.add(slab);
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * HALF, 0.06, 2 * HALF)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
      );
      rim.position.copy(slab.position);
      scene.add(rim);

      /* Latin-hypercube grid: one run per row and per column */
      const n = tile.ex.points.length;
      if (tile.grid && n > 1) {
        const pts: number[] = [];
        for (let k = 1; k < n; k++) {
          const t = k / n;
          pts.push(toX(t), 0.002, toZ(0), toX(t), 0.002, toZ(1));
          pts.push(toX(0), 0.002, toZ(t), toX(1), 0.002, toZ(t));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5a7bb0, transparent: true, opacity: 0.35 })));
      }

      /* biggest blind spot: a red well, clipped to this tile */
      const clip = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -(ox - HALF)),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), ox + HALF),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), HALF),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), HALF),
      ];
      const r = Math.max(0.01, tile.ex.gap * 2 * HALF);
      const gx = toX(tile.ex.gap_at[0]);
      const gz = toZ(tile.ex.gap_at[1]);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(r, 64),
        new THREE.MeshBasicMaterial({ color: 0xff5468, transparent: true, opacity: 0.16, clippingPlanes: clip, depthWrite: false }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(gx, 0.004, gz);
      scene.add(disc);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.985, r, 96),
        new THREE.MeshBasicMaterial({ color: 0xff5468, transparent: true, opacity: 0.85, clippingPlanes: clip, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(gx, 0.006, gz);
      scene.add(ring);
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 0.35, 96, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xff5468,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          clippingPlanes: clip,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      wall.position.set(gx, 0.175, gz);
      scene.add(wall);
      wells.push({ ring, wall });

      /* runs: pillar + glowing cap, height = nearest-neighbour distance */
      const pillarMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2 });
      const capMat = new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35) });
      tile.ex.points.forEach(([u, v], i) => {
        const h = 0.12 + (allNN[ti][i] / nnMax) * PILLAR_MAX;
        const mesh = new THREE.Mesh(pillarGeo, pillarMat);
        mesh.position.set(toX(u), 0, toZ(v));
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(toX(u), h, toZ(v));
        scene.add(mesh, cap);
        pillars.push({ mesh, cap, h, delay: ti * 0.25 + i * 0.05 });
      });

      /* closest pair: a bright bridge across the floor */
      let pair: [number, number] = [0, 1];
      let best = Infinity;
      const P = tile.ex.points;
      for (let i = 0; i < P.length; i++)
        for (let j = i + 1; j < P.length; j++) {
          const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
          if (d < best) [best, pair] = [d, [i, j]];
        }
      if (P.length > 1) {
        const [a, b] = pair;
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(toX(P[a][0]), 0.01, toZ(P[a][1])),
          new THREE.Vector3(toX(P[b][0]), 0.01, toZ(P[b][1])),
        ]);
        scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffc24b })));
      }
    });

    /* a faint floor grid that the tiles float over */
    const floor = new THREE.GridHelper(14, 28, 0x1d3157, 0x0f1c33);
    floor.position.y = -0.45;
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.5;
    scene.add(floor);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.2));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = !reduced;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.35;
    controls.minAzimuthAngle = -1.1;
    controls.maxAzimuthAngle = 1.1;
    controls.target.set(0, 0.3, 0);

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      // keep both tiles in frame on narrow panels
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const byWidth = (span / 2 + 0.45) / (tanHalf * camera.aspect);
      const byHeight = (HALF + PILLAR_MAX * 0.6) / tanHalf;
      const dist = Math.max(byWidth, byHeight) * 0.84 + 0.4;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.62, 0.78);
      camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(dist));
      camera.updateProjectionMatrix();
      controls.update();
    };
    camera.position.set(0, 3.1, 3.9);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);

    const place = (k: number) => {
      for (const p of pillars) {
        const s = Math.max(0.001, p.h * k);
        p.mesh.scale.set(1, s, 1);
        p.cap.position.y = s;
      }
    };

    let raf = 0;
    if (reduced) {
      place(1);
      const draw = () => composer.render();
      controls.addEventListener('change', draw);
      draw();
    } else {
      const clock = new THREE.Clock();
      let idle = 0;
      controls.addEventListener('start', () => (idle = -1));
      controls.addEventListener('end', () => (idle = clock.getElapsedTime()));
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!visible) return;
        const t = clock.getElapsedTime();
        for (const p of pillars) {
          const k = Math.min(1, Math.max(0, (t - p.delay) / 0.7));
          const e = 1 - Math.pow(1 - k, 3);
          const s = Math.max(0.001, p.h * e);
          p.mesh.scale.set(1, s, 1);
          p.cap.position.y = s;
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
        for (const w of wells) {
          (w.wall.material as THREE.MeshBasicMaterial).opacity = 0.06 + pulse * 0.12;
          w.wall.scale.y = 0.8 + pulse * 0.4;
          (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.4;
        }
        // a slow sway while nobody is dragging, so the depth reads without interaction
        if (idle >= 0 && t - idle > 2.5) {
          const sway = Math.sin((t - idle) * 0.25) * 0.004;
          camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
        }
        controls.update();
        composer.render();
      };
      idle = 0;
      frame();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // rebuild only when the designs themselves change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tiles.map((t) => [t.key, t.color, t.grid, t.ex]))]);

  return <div ref={host} className="design3d" role="img" aria-label={label} />;
}
