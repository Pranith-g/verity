import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { prefersReducedMotion } from '../lib/motion';

export interface OrbitDef {
  key: string;
  hue: number;
}

interface Props {
  orbits: OrbitDef[];
  /** The orbit to light up (the card under the pointer), or null. */
  focus: string | null;
  label: string;
}

const GLOBE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GLOBE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.4);
  float bands = 0.5 + 0.5 * sin(vW.y * 22.0 - uTime * 1.4);
  vec3 deep = vec3(0.01, 0.04, 0.10);
  vec3 glow = mix(vec3(0.0, 0.55, 1.0), vec3(0.45, 0.3, 1.0), 0.5 + 0.5 * vN.y);
  vec3 c = deep + glow * rim * 1.25 + glow * 0.05 * bands;
  gl_FragColor = vec4(c, 0.92);
}`;

/** A slowly turning data globe with one orbit per application. Purely decorative: the cards beside it carry the content. */
export function AppHero3D({ orbits, focus, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const focusRef = useRef<string | null>(focus);
  focusRef.current = focus;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return; // no WebGL: the hero keeps its CSS glow
    }
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.set(0, 0.6, 6.2);
    const world = new THREE.Group();
    scene.add(world);

    /* globe: shaded core, wireframe shell, glowing vertices */
    const globeMat = new THREE.ShaderMaterial({
      vertexShader: GLOBE_VERT,
      fragmentShader: GLOBE_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), globeMat);
    world.add(core);
    const shellGeo = new THREE.IcosahedronGeometry(1.08, 3);
    const shell = new THREE.LineSegments(
      new THREE.WireframeGeometry(shellGeo),
      new THREE.LineBasicMaterial({ color: 0x2a7bff, transparent: true, opacity: 0.22 }),
    );
    world.add(shell);
    const dots = new THREE.Points(
      shellGeo,
      new THREE.PointsMaterial({ color: 0x7fe6ff, size: 0.028, transparent: true, opacity: 0.85, sizeAttenuation: true }),
    );
    world.add(dots);

    /* arcs: data hops between points on the globe, each with a travelling spark */
    const arcs: { curve: THREE.QuadraticBezierCurve3; spark: THREE.Mesh; speed: number; phase: number }[] = [];
    const rnd = (() => {
      let s = 7;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    })();
    const onSphere = () => {
      const t = rnd() * Math.PI * 2;
      const p = Math.acos(2 * rnd() - 1);
      return new THREE.Vector3(Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)).multiplyScalar(1.08);
    };
    for (let i = 0; i < 9; i++) {
      const a = onSphere();
      const b = onSphere();
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1.08 + a.distanceTo(b) * 0.55);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
        new THREE.LineBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.28 }),
      );
      world.add(line);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), new THREE.MeshBasicMaterial({ color: 0xbff4ff }));
      world.add(spark);
      arcs.push({ curve, spark, speed: 0.18 + rnd() * 0.25, phase: rnd() });
    }

    /* one orbit per application, tilted differently, each with a satellite and a comet trail */
    const rings = orbits.map((o, i) => {
      const color = new THREE.Color().setHSL(o.hue / 360, 0.95, 0.58);
      const pivot = new THREE.Group();
      pivot.rotation.set(0.35 + i * 0.5, i * 1.1, -0.25 + i * 0.32);
      scene.add(pivot);
      const radius = 1.65 + i * 0.32;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.006, 8, 220),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }),
      );
      ring.rotation.x = Math.PI / 2;
      pivot.add(ring);
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 20), new THREE.MeshBasicMaterial({ color }));
      pivot.add(sat);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 20, 20),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      sat.add(halo);
      const trailN = 40;
      const trailPos = new Float32Array(trailN * 3);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
      const trail = new THREE.Points(
        trailGeo,
        new THREE.PointsMaterial({ color, size: 0.035, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      pivot.add(trail);
      return { key: o.key, pivot, ring, sat, halo, trail, trailPos, trailN, radius, speed: 0.32 - i * 0.06, phase: i * 2.1, glow: 0 };
    });

    /* star dust */
    const dustN = 900;
    const dustPos = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      const r = 3 + rnd() * 9;
      const t = rnd() * Math.PI * 2;
      const p = Math.acos(2 * rnd() - 1);
      dustPos.set([r * Math.sin(p) * Math.cos(t), r * Math.cos(p) * 0.6, r * Math.sin(p) * Math.sin(t) - 3], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x8fb8ff, size: 0.02, transparent: true, opacity: 0.6 }));
    scene.add(dust);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.12);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.position.z = w / h < 1.1 ? 7.6 : 6.2;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = clock.getElapsedTime();
      globeMat.uniforms.uTime.value = t;
      world.rotation.y = t * 0.12;
      world.rotation.x = Math.sin(t * 0.2) * 0.08;
      dust.rotation.y = -t * 0.015;
      for (const a of arcs) a.spark.position.copy(a.curve.getPoint((t * a.speed + a.phase) % 1));
      for (const r of rings) {
        const lit = focusRef.current === r.key ? 1 : 0;
        r.glow += (lit - r.glow) * 0.08;
        const ang = t * r.speed * (1 + r.glow * 0.8) + r.phase;
        r.sat.position.set(Math.cos(ang) * r.radius, 0, Math.sin(ang) * r.radius);
        r.sat.scale.setScalar(1 + r.glow * 0.8);
        (r.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + r.glow * 0.6;
        r.ring.scale.setScalar(1 + r.glow * 0.03);
        (r.halo.material as THREE.MeshBasicMaterial).opacity = 0.16 + r.glow * 0.3;
        for (let k = 0; k < r.trailN; k++) {
          const b = ang - k * 0.035;
          r.trailPos.set([Math.cos(b) * r.radius, 0, Math.sin(b) * r.radius], k * 3);
        }
        r.trail.geometry.attributes.position.needsUpdate = true;
      }
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      camera.position.x = pointer.x * 0.6;
      camera.position.y = 0.6 - pointer.y * 0.4;
      camera.lookAt(0, 0, 0);
      composer.render();
    };
    if (reduced) {
      // one still frame, satellites placed, no motion
      for (const r of rings) r.sat.position.set(Math.cos(r.phase) * r.radius, 0, Math.sin(r.phase) * r.radius);
      for (const a of arcs) a.spark.position.copy(a.curve.getPoint(a.phase));
      camera.lookAt(0, 0, 0);
      composer.render();
    } else frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
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
    // the orbits are fixed for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbits.map((o) => o.key).join()]);

  return <div ref={host} className="hero3d" role="img" aria-label={label} />;
}
