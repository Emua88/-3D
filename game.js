// Physics Arc 3D
// - 카메라 회전: 방향키만 사용 (마우스 회전 없음, requestAnimationFrame 기반)
// - 물리: 1/120초 고정 timestep + 렌더 보간
// - 발사: 드래그 → 방향/각도/세기 → 중력 포물선
// 예측 궤적과 실제 공은 동일한 stepBall() 함수를 사용한다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js';

/* ------------------------------------------------------------------ */
/* 렌더러 / 씬                                                          */
/* ------------------------------------------------------------------ */

const app = document.querySelector('#game');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a12);
scene.fog = new THREE.Fog(0x070a12, 45, 120);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 250);
camera.position.set(-20, 10, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x9bb7ff, 0x10131c, 1.4));

const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(12, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
// 기본 shadow camera는 ±5라서 30m 경기장을 덮지 못한다. 직접 맞춰준다.
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0008;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

const world = new THREE.Group();
scene.add(world);

/* ------------------------------------------------------------------ */
/* 상수 / 상태                                                          */
/* ------------------------------------------------------------------ */

const BALL_R = 0.38;
const GRAVITY = new THREE.Vector3(0, -9.8, 0);
const RESTITUTION = 0.8;

const PHYSICS_DT = 1 / 120;      // 고정 physics timestep
const MAX_STEPS = 8;             // 한 프레임에서 허용하는 최대 physics step
const MAX_FRAME_DT = 0.05;       // 프레임 dt 상한 (탭 전환 등으로 튀는 것 방지)

const ARENA_X = 15;
const ARENA_Z = 12;
const CEILING = 20;

const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 32, 20),
  new THREE.MeshStandardMaterial({
    color: 0xffd45a, emissive: 0x5a3500, emissiveIntensity: 0.5,
    metalness: 0.35, roughness: 0.25
  })
);
ball.castShadow = true;
world.add(ball);

// 물리 상태 (시뮬레이션 전용)
const simPosition = new THREE.Vector3();
const simVelocity = new THREE.Vector3();
const previousSimPosition = new THREE.Vector3();
const renderPosition = new THREE.Vector3();

let simTime = 0;          // 시뮬레이션 누적 시간 (움직이는 오브젝트용)
let accumulator = 0;
let running = false;
let resetTimer = 0;
let gameStarted = false;

let levelIndex = 0;
let shots = 3;
let passed = 0;
let stars = 0;

const startPos = new THREE.Vector3(-8, 3, 0);
const focusPoint = new THREE.Vector3(0, 3, 0);
const baseHeading = new THREE.Vector3(1, 0, 0);   // 기본 발사 방향(수평)

// 조준 상태: 드래그로 결정된다. heading은 절대 방향이므로
// 나중에 카메라를 돌려도 조준이 흔들리지 않는다.
const aim = { heading: new THREE.Vector3(1, 0, 0), elevation: 0.84, power: 0.45 };
const AIM_MIN_ELEV = 0.45;   // ≈26°
const AIM_MAX_ELEV = 1.22;   // ≈70°
const SPEED_MIN = 7;
const SPEED_MAX = 19;

let objects = [];      // 레벨 지오메트리 (clearWorld 대상)
let rings = [];
let walls = [];        // 충돌 박스
let platforms = [];    // 충돌 박스 + 이동
let movers = [];       // 시간에 따라 움직이는 오브젝트
let switches = [];
let portals = [];
let zones = [];

const keys = Object.create(null);
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
const dragRight = new THREE.Vector3(0, 0, 1);   // pointerdown 시점의 화면 오른쪽(지면 투영)

/* ------------------------------------------------------------------ */
/* 카메라 (방향키 전용)                                                 */
/* ------------------------------------------------------------------ */

let camYaw = 0;
let camPitch = 0.30;
let camDistance = 20;
let camDistanceTarget = 20;
let cameraMode = 0; // 0 FREE / 1 BALL / 2 OVERVIEW

const CAM_YAW_SPEED = 1.6;     // rad/sec
const CAM_PITCH_SPEED = 1.1;   // rad/sec
const CAM_PITCH_MIN = 0.06;
const CAM_PITCH_MAX = 1.25;

const camLook = new THREE.Vector3(0, 3, 0);      // 실제로 바라보는 점 (감쇠)
const camDesiredLook = new THREE.Vector3(0, 3, 0);

/* ------------------------------------------------------------------ */
/* 레벨 데이터                                                          */
/* ------------------------------------------------------------------ */

const levels = [
  { name: '3D BASICS', obj: '공을 포물선으로 발사해 링을 통과시키세요.',
    pos: [-8, 3, 0], ring: [[6, 4.5, 0]] },
  { name: 'REFLECTION', obj: '벽을 넘기거나 튕겨서 링을 통과시키세요.',
    pos: [-8, 3, -4], ring: [[7, 5, 2]], walls: [[0, 2.5, 0, 0.4, 7, 10]] },
  { name: 'MOVING PLATFORM', obj: '움직이는 플랫폼을 이용해 링에 도달하세요.',
    pos: [-8, 4, 0], ring: [[8, 7, 0]], platform: [[0, 2, 0, 6, 3]] },
  { name: 'SWITCH ORDER', obj: '스위치를 지나며 링을 통과시키세요.',
    pos: [-8, 3, 0], ring: [[9, 6, 0]], switches: [[-2, 2, 0], [2, 4, -2], [6, 3, 2]] },
  { name: 'GRAVITY FIELD', obj: '저중력 구역을 지나 링에 도달하세요.',
    pos: [-8, 4, 0], ring: [[8, 7, 0]], zone: [[0, 5, 0, 12, 10, 10, 0.35]] },
  { name: 'PORTAL', obj: '포털 A로 들어가 포털 B에서 나오세요.',
    pos: [-8, 3, -3], ring: [[8, 6, 3]], portal: [[-1, 5, -3], [4, 7, 3]] },
  { name: 'MOVING WALLS', obj: '움직이는 장애물 사이로 타이밍을 맞춰 발사하세요.',
    pos: [-8, 4, 0], ring: [[9, 6, 0]],
    walls: [[0, 4, 0, 0.5, 4, 5, 0, 1.6], [5, 5, 0, 0.5, 4, 5, 0, 1.6]] },
  { name: 'REFLECT + PLATFORM', obj: '반사와 플랫폼을 함께 이용하세요.',
    pos: [-8, 5, -2], ring: [[9, 7, 2]],
    walls: [[0, 2.5, -2, 0.4, 6, 8]], platform: [[3, 2, 0, 5, 3]] },
  { name: 'SYSTEM CHAIN', obj: '스위치·저중력·포털을 모두 이용하세요.',
    pos: [-8, 4, 0], ring: [[10, 7, 3]],
    switches: [[-3, 3, -2], [0, 5, 0], [3, 4, 2]],
    portal: [[5, 4, -4], [7, 6, 3]], zone: [[0, 5, 0, 10, 10, 10, 0.5]] },
  { name: 'FINAL PUZZLE', obj: '모든 요소를 조합한 최종 퍼즐입니다.',
    pos: [-10, 5, -4], ring: [[11, 8, 4]],
    walls: [[0, 3, -4, 0.4, 7, 8], [5, 3, 0, 0.4, 6, 8, Math.PI / 4]],
    platform: [[4, 3, 0, 5, 3]],
    switches: [[-3, 3, -1], [1, 5, 1]],
    portal: [[6, 5, -5], [9, 7, 3]], zone: [[1, 5, 0, 9, 9, 9, 0.45]] }
];

/* ------------------------------------------------------------------ */
/* 파티클 풀 (런타임 할당 없음 → GC 끊김 방지)                           */
/* ------------------------------------------------------------------ */

const PARTICLE_COUNT = 140;
const particleGeo = new THREE.SphereGeometry(0.06, 6, 5);
const particleMats = {
  green: new THREE.MeshBasicMaterial({ color: 0x46ff88 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff5555 }),
  blue: new THREE.MeshBasicMaterial({ color: 0x7cc7ff })
};
const particles = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const m = new THREE.Mesh(particleGeo, particleMats.blue);
  m.visible = false;
  m.userData.life = 0;
  m.userData.v = new THREE.Vector3();
  scene.add(m);
  particles.push(m);
}
let particleCursor = 0;

function burst(pos, colorKey) {
  for (let i = 0; i < 16; i++) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
    p.material = particleMats[colorKey] || particleMats.blue;
    p.position.copy(pos);
    p.userData.v.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6
    );
    p.userData.life = 0.8;
    p.visible = true;
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.visible) continue;
    p.userData.life -= dt;
    if (p.userData.life <= 0) { p.visible = false; continue; }
    p.position.addScaledVector(p.userData.v, dt);
    p.userData.v.y -= 9.8 * dt;
  }
}

/* ------------------------------------------------------------------ */
/* 사운드 (AudioContext 1개만 재사용)                                    */
/* ------------------------------------------------------------------ */

let audioCtx = null;
function beep(freq, duration) {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.04, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + duration);
  } catch (err) { /* 사운드는 실패해도 게임에 영향 없음 */ }
}

/* ------------------------------------------------------------------ */
/* 레벨 생성                                                            */
/* ------------------------------------------------------------------ */

function mat(c, e = 0x000000) {
  return new THREE.MeshStandardMaterial({
    color: c, emissive: e, emissiveIntensity: 0.3, metalness: 0.15, roughness: 0.55
  });
}

function disposeMesh(m) {
  if (m.geometry) m.geometry.dispose();
  if (m.material && m.material.dispose) m.material.dispose();
}

function clearWorld() {
  for (const o of objects) { world.remove(o); disposeMesh(o); }
  objects = [];
  rings = [];
  walls = [];
  platforms = [];
  movers = [];
  switches = [];
  portals = [];
  zones = [];
  for (const p of particles) p.visible = false;
}

function refreshBoxMatrix(m) {
  m.updateMatrixWorld(true);
  m.userData.invMat.copy(m.matrixWorld).invert();
}

function addBox(pos, size, color, rotY = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat(color));
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
  m.userData.invMat = new THREE.Matrix4();
  world.add(m);
  refreshBoxMatrix(m);
  objects.push(m);
  return m;
}

function addRing(pos) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.13, 16, 56),
    mat(0x49e6ff, 0x0b5b6b)
  );
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = Math.PI / 2;   // 구멍이 X축 방향
  m.userData.passed = false;
  world.add(m);
  rings.push(m);
  objects.push(m);
  return m;
}

function loadLevel(i) {
  clearWorld();
  const l = levels[i];

  startPos.set(l.pos[0], l.pos[1], l.pos[2]);

  for (const p of l.ring || []) addRing(p);

  // walls: [x, y, z, sx, sy, sz, rotY?, moveAmp?]
  for (const w of l.walls || []) {
    const m = addBox([w[0], w[1], w[2]], [w[3], w[4], w[5]], 0x8d5260, w[6] || 0);
    walls.push(m);
    if (w[7]) {
      movers.push({ mesh: m, base: m.position.clone(), axis: 'y', amp: w[7], phase: movers.length * 1.7, speed: 1.1 });
    }
  }

  // platform: [x, y, z, sx, sz]
  for (const p of l.platform || []) {
    const m = addBox([p[0], p[1], p[2]], [p[3], 0.5, p[4]], 0x657a9b);
    platforms.push(m);
    walls.push(m);
    movers.push({ mesh: m, base: m.position.clone(), axis: 'x', amp: 3, phase: movers.length * 1.3, speed: 1.0 });
  }

  for (const s of l.switches || []) {
    const m = addBox([s[0], s[1], s[2]], [1, 0.25, 1], 0xe4a33b);
    m.userData.active = false;
    switches.push(m);
  }

  for (const p of l.portal || []) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 14, 40), mat(0xb56cff, 0x57208f));
    m.position.set(p[0], p[1], p[2]);
    world.add(m);
    portals.push(m);
    objects.push(m);
  }

  // zone: [x, y, z, sx, sy, sz, gravityScale]
  for (const z of l.zone || []) {
    const m = addBox([z[0], z[1], z[2]], [z[3], z[4], z[5]], 0x2f6f52);
    m.material.transparent = true;
    m.material.opacity = 0.14;
    m.material.depthWrite = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.gravityScale = z[6];
    zones.push(m);
  }

  // 바닥
  const floor = addBox([0, -0.5, 0], [ARENA_X * 2 + 4, 0.5, ARENA_Z * 2 + 4], 0x172031);
  floor.castShadow = false;

  for (let x = -ARENA_X; x <= ARENA_X; x += 3) {
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.02, ARENA_Z * 2),
      new THREE.MeshBasicMaterial({ color: 0x233047 })
    );
    g.position.set(x, -0.24, 0);
    world.add(g);
    objects.push(g);
  }

  // 기본 발사 방향 = 첫 번째 링을 향하는 수평 방향
  const target = rings.length ? rings[0].position : new THREE.Vector3(0, 3, 0);
  baseHeading.set(target.x - startPos.x, 0, target.z - startPos.z);
  if (baseHeading.lengthSq() < 1e-6) baseHeading.set(1, 0, 0);
  baseHeading.normalize();

  focusPoint.set(
    (startPos.x + target.x) / 2,
    (startPos.y + target.y) / 2 + 1.5,
    (startPos.z + target.z) / 2
  );
  camLook.copy(focusPoint);
  camDesiredLook.copy(focusPoint);

  // 카메라를 발사 방향의 뒤쪽 비스듬한 위치로 초기화 (포물선이 잘 보이는 3/4 뷰)
  camYaw = Math.atan2(-baseHeading.x, -baseHeading.z) + 0.85;
  camPitch = 0.30;
  cameraMode = 0;
  camDistanceTarget = Math.max(20, startPos.distanceTo(target) * 1.25);
  camDistance = camDistanceTarget;
  const camBtn = document.querySelector('#camera');
  if (camBtn) camBtn.textContent = 'CAMERA: FREE';

  sun.target.position.copy(focusPoint);
  sun.target.updateMatrixWorld();

  aim.heading.copy(baseHeading);
  aim.elevation = 0.84;
  aim.power = 0.45;

  passed = 0;
  shots = 3;
  resetTimer = 0;
  simTime = 0;
  setMoversTime(0);

  resetBall();
  updateUI();
}

function resetBall() {
  running = false;
  accumulator = 0;
  resetTimer = 0;
  simPosition.copy(startPos);
  previousSimPosition.copy(startPos);
  renderPosition.copy(startPos);
  simVelocity.set(0, 0, 0);
  ball.position.copy(startPos);
  for (const s of switches) { s.userData.active = false; s.material.emissive.setHex(0x000000); }
  updateTrajectory();
}

/* ------------------------------------------------------------------ */
/* 발사 벡터                                                            */
/* ------------------------------------------------------------------ */

const _camRight = new THREE.Vector3();
const _heading = new THREE.Vector3();

function groundRight() {
  // 카메라의 오른쪽 벡터를 지면에 투영
  _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _camRight.y = 0;
  if (_camRight.lengthSq() < 1e-6) _camRight.set(1, 0, 0);
  return _camRight.normalize();
}

// 드래그 → 3D 발사 속도.
// 좌우 드래그 = 수평 방향 조정, 위 드래그 = 수직속도 증가(발사각 상승),
// 드래그 길이 = 세기.
function getLaunchVelocity(out) {
  const v = out || new THREE.Vector3();

  _heading.copy(aim.heading);
  _heading.y = 0;
  if (_heading.lengthSq() < 1e-6) _heading.copy(baseHeading);
  _heading.normalize();

  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * aim.power;
  const cosE = Math.cos(aim.elevation);
  const sinE = Math.sin(aim.elevation);

  v.set(_heading.x * speed * cosE, speed * sinE, _heading.z * speed * cosE);
  return v;
}

/* ------------------------------------------------------------------ */
/* 물리                                                                */
/* ------------------------------------------------------------------ */

const _g = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pn = new THREE.Vector3();

function gravityAt(pos) {
  _g.copy(GRAVITY);
  for (const z of zones) {
    const h = z.userData.half;
    if (Math.abs(pos.x - z.position.x) < h.x &&
        Math.abs(pos.y - z.position.y) < h.y &&
        Math.abs(pos.z - z.position.z) < h.z) {
      _g.multiplyScalar(z.userData.gravityScale);
      break;
    }
  }
  return _g;
}

function setMoversTime(t) {
  for (const m of movers) {
    const off = Math.sin(t * m.speed + m.phase) * m.amp;
    m.mesh.position[m.axis] = m.base[m.axis] + off;
    refreshBoxMatrix(m.mesh);
  }
}

// 벽/플랫폼(회전 가능한 박스)과 구의 충돌 + 반사
function collideBoxes(pos, vel, emit) {
  for (const w of walls) {
    const lp = _v1.copy(pos).applyMatrix4(w.userData.invMat);
    const h = w.userData.half;
    const cx = THREE.MathUtils.clamp(lp.x, -h.x, h.x);
    const cy = THREE.MathUtils.clamp(lp.y, -h.y, h.y);
    const cz = THREE.MathUtils.clamp(lp.z, -h.z, h.z);

    let nx = lp.x - cx, ny = lp.y - cy, nz = lp.z - cz;
    let dist = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (dist > BALL_R) continue;

    if (dist < 1e-5) {
      // 박스 내부로 들어간 경우: 가장 얕은 축으로 밀어낸다.
      const ox = h.x - Math.abs(lp.x);
      const oy = h.y - Math.abs(lp.y);
      const oz = h.z - Math.abs(lp.z);
      nx = ny = nz = 0;
      if (ox <= oy && ox <= oz) nx = Math.sign(lp.x) || 1;
      else if (oy <= oz) ny = Math.sign(lp.y) || 1;
      else nz = Math.sign(lp.z) || 1;
      dist = 0;
    }

    _n.set(nx, ny, nz);
    if (_n.lengthSq() < 1e-9) continue;
    _n.normalize();
    _n.applyQuaternion(w.quaternion);   // world 그룹은 회전이 없으므로 이걸로 충분

    const push = BALL_R - dist;
    pos.addScaledVector(_n, push + 0.001);

    const vn = vel.dot(_n);
    if (vn < 0) {
      vel.addScaledVector(_n, -(1 + RESTITUTION) * vn);
      if (emit) { burst(pos, 'blue'); beep(240, 0.05); }
    }
  }
}

function collidePortals(pos, vel) {
  if (portals.length < 2) return;
  const a = portals[0], b = portals[1];
  const from = pos.distanceTo(a.position) < 1.0 ? b : (pos.distanceTo(b.position) < 1.0 ? a : null);
  if (!from) return;
  _pn.copy(vel);
  if (_pn.lengthSq() < 1e-6) _pn.set(1, 0, 0);
  _pn.normalize();
  pos.copy(from.position).addScaledVector(_pn, 1.25);
}

// 예측 궤적과 실제 공이 **동일하게** 쓰는 단 하나의 적분 함수.
// live=true 일 때만 UI/사운드/판정을 수행한다.
// 반환값: 'fly' | 'dead'
function stepBall(pos, vel, dt, t, live) {
  const g = gravityAt(pos);
  vel.addScaledVector(g, dt);          // semi-implicit Euler
  pos.addScaledVector(vel, dt);

  collideBoxes(pos, vel, live);
  collidePortals(pos, vel);

  // 경기장 경계
  if (Math.abs(pos.x) > ARENA_X) {
    pos.x = Math.sign(pos.x) * ARENA_X;
    vel.x *= -RESTITUTION;
    if (live) burst(pos, 'blue');
  }
  if (Math.abs(pos.z) > ARENA_Z) {
    pos.z = Math.sign(pos.z) * ARENA_Z;
    vel.z *= -RESTITUTION;
    if (live) burst(pos, 'blue');
  }
  if (pos.y > CEILING) {
    pos.y = CEILING;
    vel.y *= -RESTITUTION;
  }

  if (live) {
    for (const s of switches) {
      if (!s.userData.active && pos.distanceTo(s.position) < 1.0) {
        s.userData.active = true;
        s.material.emissive.setHex(0x46ff88);
        beep(660, 0.06);
      }
    }
    for (const r of rings) checkRing(r, pos);
  }

  if (pos.y < BALL_R) return 'dead';
  return 'fly';
}

function checkRing(r, pos) {
  if (r.userData.passed) return;
  if (pos.distanceTo(r.position) > 1.2) return;
  r.userData.passed = true;
  passed++;
  r.material.emissive.setHex(0x46ff88);
  burst(r.position, 'green');
  beep(880, 0.15);

  if (passed >= rings.length) {
    running = false;
    resetTimer = 0;
    stars = Math.max(1, Math.min(3, shots + 1));
    setStatus('LEVEL CLEAR · NEXT LEVEL 버튼으로 진행');
    updateUI();
  }
}

/* ------------------------------------------------------------------ */
/* 예측 궤적 (물리와 동일한 stepBall 사용)                               */
/* ------------------------------------------------------------------ */

const TRAJ_MAX = 260;
const trajPositions = new Float32Array(TRAJ_MAX * 3);
const trajGeometry = new THREE.BufferGeometry();
trajGeometry.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
trajGeometry.setDrawRange(0, 0);
const trajectoryLine = new THREE.Line(
  trajGeometry,
  new THREE.LineBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0.7 })
);
trajectoryLine.frustumCulled = false;
scene.add(trajectoryLine);

const _tp = new THREE.Vector3();
const _tv = new THREE.Vector3();

function updateTrajectory() {
  if (running || !gameStarted) {
    trajGeometry.setDrawRange(0, 0);
    trajectoryLine.visible = false;
    return;
  }
  trajectoryLine.visible = true;

  _tp.copy(startPos);
  getLaunchVelocity(_tv);

  let count = 0;
  trajPositions[0] = _tp.x; trajPositions[1] = _tp.y; trajPositions[2] = _tp.z;
  count = 1;

  const SAMPLE_EVERY = 3;            // 1/120초 스텝 3개마다 한 점 (=1/40초)
  const MAX_SUBSTEPS = 540;          // 최대 4.5초 예측
  let t = simTime;

  for (let i = 0; i < MAX_SUBSTEPS && count < TRAJ_MAX; i++) {
    t += PHYSICS_DT;
    if (movers.length && i % 4 === 0) setMoversTime(t);
    const state = stepBall(_tp, _tv, PHYSICS_DT, t, false);
    if (i % SAMPLE_EVERY === 0) {
      trajPositions[count * 3] = _tp.x;
      trajPositions[count * 3 + 1] = _tp.y;
      trajPositions[count * 3 + 2] = _tp.z;
      count++;
    }
    if (state === 'dead') break;
  }

  setMoversTime(simTime);   // 예측 때문에 움직인 오브젝트를 원상복구
  trajGeometry.attributes.position.needsUpdate = true;
  trajGeometry.setDrawRange(0, count);
}

/* ------------------------------------------------------------------ */
/* 발사 / UI                                                            */
/* ------------------------------------------------------------------ */

function setStatus(text) {
  const el = document.querySelector('#status');
  if (el) el.textContent = text;
}

function aimText() {
  const deg = Math.round(THREE.MathUtils.radToDeg(aim.elevation));
  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * aim.power;
  return `발사각 ${deg}° · 세기 ${speed.toFixed(1)} · 남은 샷 ${shots}`;
}

function updateUI() {
  document.querySelector('#level').textContent = `LEVEL ${String(levelIndex + 1).padStart(2, '0')}`;
  document.querySelector('#objective').textContent = levels[levelIndex].obj;
  document.querySelector('#shots').textContent = '●'.repeat(shots) + '○'.repeat(Math.max(0, 3 - shots));
  document.querySelector('#stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  document.querySelector('#next').style.display =
    (rings.length && passed >= rings.length) ? 'inline-block' : 'none';
  if (!running && !(rings.length && passed >= rings.length)) setStatus(aimText());
}

function launch() {
  if (!gameStarted || running || resetTimer > 0) return;
  if (rings.length && passed >= rings.length) return;
  if (shots <= 0) {
    setStatus('샷을 모두 사용했습니다 · R 키로 재시작');
    return;
  }

  shots--;
  running = true;
  accumulator = 0;
  previousSimPosition.copy(simPosition);
  getLaunchVelocity(simVelocity);

  trajectoryLine.visible = false;
  trajGeometry.setDrawRange(0, 0);

  setStatus('비행 중 · 포물선 운동');
  updateUI();
  beep(440, 0.08);
}

function endShot(message) {
  running = false;
  resetTimer = 0.7;
  burst(simPosition, 'red');
  beep(180, 0.15);
  setStatus(message);
}

/* ------------------------------------------------------------------ */
/* 카메라 업데이트 (방향키, rAF 기반, 프레임률 독립 감쇠)                 */
/* ------------------------------------------------------------------ */

function updateCamera(dt) {
  if (keys.ArrowLeft) camYaw += CAM_YAW_SPEED * dt;
  if (keys.ArrowRight) camYaw -= CAM_YAW_SPEED * dt;
  if (keys.ArrowUp) camPitch += CAM_PITCH_SPEED * dt;
  if (keys.ArrowDown) camPitch -= CAM_PITCH_SPEED * dt;
  camPitch = THREE.MathUtils.clamp(camPitch, CAM_PITCH_MIN, CAM_PITCH_MAX);

  // BALL 모드일 때만 공을 따라간다. FREE/OVERVIEW에서는 경기장을 본다.
  if (cameraMode === 1) camDesiredLook.copy(renderPosition);
  else camDesiredLook.copy(focusPoint);

  const k = 1 - Math.exp(-6 * dt);        // 프레임률에 독립적인 감쇠
  camLook.lerp(camDesiredLook, k);
  camDistance += (camDistanceTarget - camDistance) * k;

  const cp = Math.cos(camPitch);
  camera.position.set(
    camLook.x + Math.sin(camYaw) * cp * camDistance,
    camLook.y + Math.sin(camPitch) * camDistance,
    camLook.z + Math.cos(camYaw) * cp * camDistance
  );
  if (camera.position.y < 0.6) camera.position.y = 0.6;
  camera.lookAt(camLook);
}

/* ------------------------------------------------------------------ */
/* 메인 루프: physics(고정 스텝) 와 render(보간) 완전 분리               */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const frameDt = Math.min(clock.getDelta(), MAX_FRAME_DT);

  // ---------- PHYSICS ----------
  if (running) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_STEPS) {
      previousSimPosition.copy(simPosition);
      simTime += PHYSICS_DT;
      setMoversTime(simTime);
      const state = stepBall(simPosition, simVelocity, PHYSICS_DT, simTime, true);
      accumulator -= PHYSICS_DT;
      steps++;

      if (state === 'dead') {
        endShot('MISS · 다시 조준하세요 (R: 재시작)');
        break;
      }
      if (!running) break;              // 링 통과로 클리어된 경우
      if (simPosition.length() > 60) {
        endShot('경기장을 벗어났습니다 · 다시 조준하세요');
        break;
      }
    }
    if (accumulator > PHYSICS_DT * MAX_STEPS) accumulator = 0;   // 나선형 지연 방지
  } else {
    simTime += frameDt;
    setMoversTime(simTime);
    accumulator = 0;
    previousSimPosition.copy(simPosition);
  }

  // ---------- RENDER ----------
  const alpha = running ? THREE.MathUtils.clamp(accumulator / PHYSICS_DT, 0, 1) : 1;
  renderPosition.lerpVectors(previousSimPosition, simPosition, alpha);
  ball.position.copy(renderPosition);

  if (resetTimer > 0) {
    resetTimer -= frameDt;
    if (resetTimer <= 0) {
      resetTimer = 0;
      resetBall();
      updateUI();
    }
  }

  for (const r of rings) r.rotation.x += frameDt * 0.6;
  for (const p of portals) p.rotation.z += frameDt * 1.2;

  updateCamera(frameDt);
  updateParticles(frameDt);

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* 입력: 마우스는 조준 전용 (카메라 회전에 사용하지 않는다)               */
/* ------------------------------------------------------------------ */

function applyDrag(clientX, clientY) {
  const dx = clientX - dragStartX;
  const dy = clientY - dragStartY;
  const unit = Math.max(140, innerHeight * 0.32);

  const nx = THREE.MathUtils.clamp(dx / unit, -1, 1);
  const ny = THREE.MathUtils.clamp(-dy / unit, -1, 1);   // 위로 드래그 = +

  // 좌우 드래그 → 수평 발사 방향 (pointerdown 시점의 화면 기준 고정)
  aim.heading.copy(baseHeading).addScaledVector(dragRight, nx * 1.5);
  aim.heading.y = 0;
  if (aim.heading.lengthSq() < 1e-6) aim.heading.copy(baseHeading);
  aim.heading.normalize();

  // 위로 드래그하면 수직 속도 증가, 아래로 드래그하면 감소
  aim.elevation = THREE.MathUtils.clamp(
    0.84 + ny * 0.38, AIM_MIN_ELEV, AIM_MAX_ELEV
  );
  const len = Math.min(1, Math.hypot(dx, dy) / unit);
  aim.power = THREE.MathUtils.clamp(0.15 + len * 0.85, 0.05, 1);

  updateTrajectory();
  if (!running) setStatus(aimText());
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (!gameStarted || running || resetTimer > 0) return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragRight.copy(groundRight());
  renderer.domElement.setPointerCapture?.(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', e => {
  if (!dragging || running) return;
  applyDrag(e.clientX, e.clientY);
});

addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointercancel', () => { dragging = false; });

addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;

  if (e.code === 'Space') launch();
  if (e.code === 'KeyR') { loadLevel(levelIndex); }
});

addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

document.querySelector('#restart').onclick = () => loadLevel(levelIndex);

document.querySelector('#next').onclick = () => {
  if (rings.length && passed >= rings.length) {
    levelIndex = Math.min(levels.length - 1, levelIndex + 1);
    loadLevel(levelIndex);
  }
};

document.querySelector('#camera').onclick = () => {
  cameraMode = (cameraMode + 1) % 3;
  if (cameraMode === 0) { camDistanceTarget = 20; camPitch = 0.30; }
  if (cameraMode === 1) { camDistanceTarget = 13; camPitch = 0.35; }
  if (cameraMode === 2) { camDistanceTarget = 32; camPitch = 0.95; }
  document.querySelector('#camera').textContent =
    ['CAMERA: FREE', 'CAMERA: BALL', 'CAMERA: OVERVIEW'][cameraMode];
};

document.querySelector('#startBtn').onclick = () => {
  document.querySelector('#start').style.display = 'none';
  gameStarted = true;
  levelIndex = 0;
  stars = 0;
  loadLevel(0);
  beep(520, 0.1);
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------------------------------------------ */

loadLevel(0);
animate();
