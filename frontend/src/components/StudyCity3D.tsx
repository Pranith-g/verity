import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { prefersReducedMotion } from '../lib/motion';
import type { Study, StudyStatus } from '../types';

/** The status tones from styles.css, as hex for WebGL. */
const TONE: Record<StudyStatus, number> = {
  collecting: 0x00d4ff,
  learning: 0x7c5cff,
  ready: 0x2ee59d,
  out_of_budget: 0xff5468,
};

const SIZE = 0.5; // hex circumradius on the board
const TOWER_MAX = 1.9;

/** Axial hex coordinates in rings around the centre: 1, 6, 12, 18 … cells. */
function hexSpiral(count: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (let ring = 1; out.length < count; ring++) {
    let q = -ring;
    let r = ring; // start at direction 4 × ring
    for (const [dq, dr] of dirs)
      for (let k = 0; k < ring; k++) {
        out.push([q, r]);
        q += dq;
        r += dr;
      }
  }
  return out.slice(0, count);
}

/** Pointy-top layout in the x–z plane (CylinderGeometry with 6 sides has a vertex on +z). */
const hexToXZ = ([q, r]: [number, number]): [number, number] => [SIZE * Math.sqrt(3) * (q + r / 2), SIZE * 1.5 * r];

function ringsFor(n: number) {
  let ring = 0;
  while (1 + 3 * ring * (ring + 1) < n) ring++;
  return ring;
}

interface Tower {
  id: string;
  body: THREE.Mesh;
  cap: THREE.Mesh;
  pulse: THREE.Mesh | null;
  h: number;
  target: number;
  lift: number;
  color: THREE.Color;
}

interface Props {
  studies: Study[];
  onPick: (id: string) => void;
}

/**
 * Every study as a hex tower on a floating board: height is the share of its run budget used, colour is its status,
 * and a ring pulses under studies the server is running by itself. Hover a tower to name it; click to open it.
 * The list beside it carries the same links for keyboard and screen-reader use.
 */
export function StudyCity3D({ studies, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const api = useRef<{ sync: (s: Study[]) => void } | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const byId = useRef(new Map<string, Study>());
  const [hover, setHover] = useState<Study | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    scene.add(new THREE.AmbientLight(0x9ab4ff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-3, 7, 5);
    scene.add(sun);
    const rimLight = new THREE.PointLight(0x7c5cff, 6, 12);
    rimLight.position.set(3, 2, -3);
    scene.add(rimLight);

    const board = new THREE.Group();
    scene.add(board);
    const tiles = new THREE.Group();
    board.add(tiles);

    const hexGeo = new THREE.CylinderGeometry(SIZE * 0.92, SIZE * 0.92, 1, 6, 1);
    hexGeo.translate(0, 0.5, 0);
    const capGeo = new THREE.CylinderGeometry(SIZE * 0.92, SIZE * 0.92, 0.035, 6, 1);
    const tileGeo = new THREE.CylinderGeometry(SIZE * 0.95, SIZE * 0.95, 0.05, 6, 1);
    const tileEdges = new THREE.EdgesGeometry(tileGeo);
    const ringGeo = new THREE.RingGeometry(SIZE * 0.98, SIZE * 1.12, 6, 1);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0x0b1628, roughness: 0.5, metalness: 0.5, transparent: true, opacity: 0.9 });
    const tileLine = new THREE.LineBasicMaterial({ color: 0x2a4a80, transparent: true, opacity: 0.45 });

    let rings = -1;
    const layoutBoard = (n: number) => {
      const want = ringsFor(Math.max(1, n)) + 1; // one empty ring of plinths around the towers
      if (want === rings) return;
      rings = want;
      tiles.clear();
      for (const cell of hexSpiral(1 + 3 * want * (want + 1))) {
        const [x, z] = hexToXZ(cell);
        const t = new THREE.Mesh(tileGeo, tileMat);
        t.position.set(x, -0.025, z);
        const e = new THREE.LineSegments(tileEdges, tileLine);
        e.position.copy(t.position);
        tiles.add(t, e);
      }
    };

    const towers = new Map<string, Tower>();
    const sync = (list: Study[]) => {
      byId.current = new Map(list.map((s) => [s.id, s]));
      // oldest first, so a new study takes the next free cell and nobody else moves
      const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      layoutBoard(ordered.length);
      const cells = hexSpiral(ordered.length);
      const keep = new Set(ordered.map((s) => s.id));
      for (const [id, t] of towers)
        if (!keep.has(id)) {
          board.remove(t.body, t.cap);
          if (t.pulse) board.remove(t.pulse);
          (t.body.material as THREE.Material).dispose();
          (t.cap.material as THREE.Material).dispose();
          if (t.pulse) (t.pulse.material as THREE.Material).dispose();
          towers.delete(id);
        }
      ordered.forEach((s, i) => {
        const [x, z] = hexToXZ(cells[i]);
        const target = 0.08 + Math.min(1, s.runs_done / Math.max(1, s.max_runs)) * TOWER_MAX;
        let t = towers.get(s.id);
        if (!t) {
          const color = new THREE.Color(TONE[s.status]);
          const body = new THREE.Mesh(
            hexGeo,
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.88 }),
          );
          body.userData.id = s.id;
          const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.12) }));
          cap.userData.id = s.id;
          board.add(body, cap);
          t = { id: s.id, body, cap, pulse: null, h: reduced ? target : 0.001, target, lift: 0, color };
          towers.set(s.id, t);
        }
        t.target = target;
        t.body.position.set(x, 0, z);
        t.cap.position.set(x, t.h, z);
        const tone = TONE[s.status];
        if (t.color.getHex() !== tone) {
          t.color.setHex(tone);
          const m = t.body.material as THREE.MeshStandardMaterial;
          m.color.copy(t.color);
          m.emissive.copy(t.color);
          (t.cap.material as THREE.MeshBasicMaterial).color.copy(t.color.clone().lerp(new THREE.Color(0xffffff), 0.12));
        }
        if (s.autorun && !t.pulse) {
          t.pulse = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          t.pulse.rotation.x = -Math.PI / 2;
          t.pulse.rotation.z = Math.PI / 6; // ring sides line up with the hex
          board.add(t.pulse);
        } else if (!s.autorun && t.pulse) {
          board.remove(t.pulse);
          (t.pulse.material as THREE.Material).dispose();
          t.pulse = null;
        }
        if (t.pulse) t.pulse.position.set(x, 0.01, z);
      });
      fit();
      if (reduced) draw();
    };

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.35, 0.55));
    composer.addPass(new OutputPass());
    const draw = () => composer.render();

    const fit = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      const radius = (Math.max(1, rings) + 0.5) * SIZE * Math.sqrt(3);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // fit the board's width, and its foreshortened depth plus the tallest tower's height
      const dist = Math.max((radius * 1.15) / (tanHalf * camera.aspect), (radius * 0.6 + 0.5) / tanHalf) + 0.3;
      camera.position.set(0, dist * 0.46, dist * 0.89);
      camera.lookAt(0, 0.35, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(() => {
      fit();
      if (reduced) draw();
    });
    ro.observe(el);

    /* hover and click */
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2(9, 9);
    let hovered: string | null = null;
    let parX = 0;
    let parY = 0;
    const hitTest = () => {
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects([...towers.values()].flatMap((t) => [t.body, t.cap]), false);
      return (hits[0]?.object.userData.id as string | undefined) ?? null;
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      parX = ndc.x;
      parY = ndc.y;
      const id = hitTest();
      if (id !== hovered) {
        hovered = id;
        setHover(id ? byId.current.get(id) ?? null : null);
        el.style.cursor = id ? 'pointer' : '';
        if (reduced) draw();
      }
      if (tip.current) tip.current.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
    };
    const onLeave = () => {
      ndc.set(9, 9);
      parX = parY = 0;
      hovered = null;
      setHover(null);
      el.style.cursor = '';
    };
    const onClick = () => {
      const id = hitTest();
      if (id) pick.current(id);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('click', onClick);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);

    let raf = 0;
    const clock = new THREE.Clock();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const dt = Math.min(0.1, clock.getDelta());
      const t = clock.elapsedTime;
      const ease = (rate: number) => 1 - Math.exp(-dt * rate); // frame-rate independent
      board.rotation.y += ((hovered ? board.rotation.y : t * 0.08 + parX * 0.25) - board.rotation.y) * ease(3);
      board.rotation.x = -parY * 0.06;
      for (const tw of towers.values()) {
        tw.h += (tw.target - tw.h) * ease(3.5);
        tw.lift += ((hovered === tw.id ? 0.18 : 0) - tw.lift) * ease(9);
        tw.body.scale.set(1, tw.h, 1);
        tw.body.position.y = tw.lift;
        tw.cap.position.y = tw.h + tw.lift;
        (tw.body.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.18 + (hovered === tw.id ? 0.55 : 0);
        if (tw.pulse) {
          const k = (t * 0.7 + tw.h) % 1;
          tw.pulse.scale.setScalar(1 + k * 0.6);
          (tw.pulse.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
        }
      }
      draw();
    };

    api.current = { sync };
    if (reduced) {
      board.rotation.y = 0.35;
      fit();
    } else frame();

    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('click', onClick);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      [hexGeo, capGeo, tileGeo, tileEdges, ringGeo].forEach((g) => g.dispose());
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    api.current?.sync(studies);
  }, [studies]);

  const ready = studies.filter((s) => s.status === 'ready').length;
  return (
    <div className="city3d-wrap">
      <div
        ref={host}
        className="city3d"
        role="img"
        aria-label={`${studies.length} studies as towers; height is the share of each run budget used. ${ready} ready to stop.`}
      />
      <div ref={tip} className={`city3d-tip${hover ? ' on' : ''}`} aria-hidden="true">
        {hover && (
          <>
            <b>{hover.name}</b>
            <span className="mono">
              {hover.runs_done} / {hover.max_runs} runs
            </span>
          </>
        )}
      </div>
    </div>
  );
}
