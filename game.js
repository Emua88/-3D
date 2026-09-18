import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js';

const app = document.querySelector('#game');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a12);
scene.fog = new THREE.Fog(0x070a12, 35, 90);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 150);
camera.position.set(10, 8, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x9bb7ff, 0x10131c, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(7, 15, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const ballMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd45a,
  emissive: 0x5a3500,
  emissiveIntensity: 0.45,
  metalness: 0.35,
  roughness: 0.25
});
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 20), ballMaterial);
ball.castShadow = true;
world.add(ball);

const gravity = new THREE.Vector3(0, -9.8, 0);
const simPosition = new THREE.Vector3();
const previousSimPosition = new THREE.Vector3();
const simVelocity = new THREE.Vector3();
const renderPosition = new THREE.Vector3();
let activeGravity = gravity.clone();

let running = false;
let levelIndex = 0;
let shots = 3;
let passed = 0;
let stars = 0;
let cameraMode = 0;
let aim = new THREE.Vector3(9, 7, 0);
let startPos = new THREE.Vector3(-8, 3, 0);

let objects = [];
let rings = [];
let platforms = [];
let switches = [];
let portals = [];
let zones = [];
let particles = [];
let trajectoryLine = null;
let dragging = false;
const keys = Object.create(null);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// 카메라는 마우스가 아니라 방향키로만 회전한다.
let camYaw = 0.62;
let camPitch = 0.28;
let camDistance = 17;
const camTarget = new THREE.Vector3(0, 2, 0);
const CAM_YAW_SPEED = 1.75;
const CAM_PITCH_SPEED = 1.25;

// 물리 계산은 120Hz 고정 스텝으로 하고, 렌더링은 보간한다.
// 그래서 공이 프레임 단위로 '점프'하는 느낌을 최대한 줄인다.
const PHYSICS_DT = 1 / 120;
const MAX_PHYSICS_STEPS = 10;
let accumulator = 0;

const levels = [
  { name: '3D BASICS', obj: 'Pass the ring using a controlled parabola.', pos: [-8, 3, 0], ring: [[5, 4, 0]], walls: [] },
  { name: 'REFLECTION', obj: 'Use the wall reflection to reach the ring.', pos: [-8, 3, -4], ring: [[7, 5, 2]], walls: [[0, 3, 0, 0, 0, Math.PI / 2]] },
  { name: 'MOVING PLATFORM', obj: 'Land on the moving platform, then pass the ring.', pos: [-8, 5, 0], ring: [[8, 7, 0]], platform: [[0, 2, 0, 6, 0, 0]] },
  { name: 'SWITCH ORDER', obj: 'Activate switches in order: A → B → C.', pos: [-8, 3, 0], ring: [[9, 6, 0]], switches: [[-2, 2, 0], [2, 4, -2], [6, 3, 2]] },
  { name: 'GRAVITY FIELD', obj: 'Cross the low-gravity zone and reach the ring.', pos: [-8, 4, 0], ring: [[8, 7, 0]], zone: [[0, 3, 0, 10, 8, 8, 0.35]] },
  { name: 'PORTAL', obj: 'Enter Portal A and emerge at Portal B.', pos: [-8, 3, -3], ring: [[8, 6, 3]], portal: [[-2, 4, -3], [4, 6, 3]] },
  { name: 'MOVING WALLS', obj: 'Time your launch through moving obstacles.', pos: [-8, 4, 0], ring: [[9, 6, 0]], walls: [[0, 4, 0, 1, 5, 0], [5, 5, 0, 1, 4, 0]] },
  { name: 'REFLECT + PLATFORM', obj: 'Combine a bounce with a moving platform.', pos: [-8, 5, -2], ring: [[9, 7, 2]], walls: [[0, 4, -2, 0, 0, Math.PI / 2]], platform: [[3, 2, 0, 4, 0, 0]] },
  { name: 'SYSTEM CHAIN', obj: 'Use switches, gravity and a portal.', pos: [-8, 4, 0], ring: [[10, 7, 3]], switches: [[-3, 3, -2], [0, 5, 0], [3, 4, 2]], portal: [[5, 4, -4], [7, 5, 3]], zone: [[0, 3, 0, 8, 8, 8, 0.5]] },
  { name: 'FINAL PUZZLE', obj: 'Solve the complete 3D physics challenge.', pos: [-10, 5, -4], ring: [[11, 8, 4]], walls: [[0, 5, -4, 0, 0, Math.PI / 2], [5, 6, 0, 0, 0, Math.PI / 4]], platform: [[4, 3, 0, 5, 0, 0]], switches: [[-3, 3, -1], [1, 5, 1]], portal: [[6, 5, -5], [9, 7, 3]], zone: [[1, 4, 0, 8, 8, 8, 0.45]] }
];

function mat(c, e = 0) {
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: e,
    emissiveIntensity: 0.25,
    metalness: 0.15,
    roughness: 0.55
  });
}

function clearWorld() {
  for (const o of objects) world.remove(o);
  for (const p of particles) world.remove(p);
  objects = [];
  particles = [];
  rings = [];
  platforms = [];
  switches = [];
  portals = [];
  zones = [];
  if (trajectoryLine) {
    world.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine.material.dispose();
    trajectoryLine = null;
  }
}

function addBox(pos, size, color = 0x3d6aa8, rot = 0) {
  // size가 0으로 들어오던 기존 데이터도 안전하게 처리한다.
  const sx = size[0] || 10;
  const sy = size[1] || 8;
  const sz = size[2] || 0.35;
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color));
  m.position.set(...pos);
  m.rotation.y = rot;
  m.castShadow = true;
  m.receiveShadow = true;
  world.add(m);
  objects.push(m);
  return m;
}

function addRing(pos) {
  const g = new THREE.TorusGeometry(1.35, 0.12, 16, 56);
  const m = new THREE.Mesh(g, mat(0x49e6ff, 0x0b5b6b));
  m.position.set(...pos);
  m.rotation.y = Math.PI / 2;
  m.userData.passed = false;
  world.add(m);
  rings.push(m);
  objects.push(m);
}

function loadLevel(i) {
  clearWorld();
  const l = levels[i];
  startPos.set(...l.pos);
  simPosition.copy(startPos);
  previousSimPosition.copy(startPos);
  renderPosition.copy(startPos);
  ball.position.copy(startPos);
  simVelocity.set(0, 0, 0);
  activeGravity.copy(gravity);
  running = false;
  passed = 0;
  shots = 3;
  accumulator = 0;

  for (const p of l.ring || []) addRing(p);
  for (const w of l.walls || []) addBox(w.slice(0, 3), [w[3] || 10, w[4] || 8, 0.35], 0x8d5260, w[5] || 0);
  for (const p of l.platform || []) {
    const m = addBox(p.slice(0, 3), [p[3] || 5, 0.5, p[4] || 3], 0x657a9b);
    m.userData.base = m.position.clone();
    m.userData.phase = Math.random() * Math.PI * 2;
    platforms.push(m);
  }
  for (const s of l.switches || []) {
    const m = addBox(s, [1, 0.25, 1], 0xe4a33b);
    m.userData.active = false;
    switches.push(m);
  }
  for (const p of l.portal || []) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 14, 40), mat(0xb56cff, 0x57208f));
    m.position.set(...p);
    world.add(m);
    portals.push(m);
    objects.push(m);
  }
  for (const z of l.zone || []) {
    const m = addBox(z.slice(0, 3), [z[3], z[4], z[5]], 0x305d45);
    m.material.transparent = true;
    m.material.opacity = 0.18;
    m.userData.gravity = z[6];
    zones.push(m);
  }

  addBox([0, -0.45, 0], [30, 0.4, 26], 0x172031);
  for (let x = -15; x <= 15; x += 3) {
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.02, 26),
      new THREE.MeshBasicMaterial({ color: 0x233047 })
    );
    g.position.set(x, -0.23, 0);
    world.add(g);
    objects.push(g);
  }

  updateUI();
}

function updateUI() {
  document.querySelector('#level').textContent = `LEVEL ${String(levelIndex + 1).padStart(2, '0')}`;
  document.querySelector('#objective').textContent = levels[levelIndex].obj;
  document.querySelector('#shots').textContent = '● '.repeat(shots).trim() + (' ○ '.repeat(3 - shots));
  document.querySelector('#stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  document.querySelector('#status').textContent = running
    ? '공이 날아가는 중…'
    : '마우스를 공에서 원하는 방향으로 드래그 · SPACE: 발사 · ← → ↑ ↓: 카메라 회전';
  document.querySelector('#next').style.display = (passed >= rings.length && rings.length) ? 'inline-block' : 'none';
}

function getLaunchVelocity() {
  const horizontal = new THREE.Vector3(aim.x, 0, aim.z);
  let horizontalLength = horizontal.length();

  // 너무 수직으로만 드래그한 경우에도 앞으로 나가도록 기본 방향을 넣는다.
  if (horizontalLength < 0.05) {
    horizontal.set(1, 0, 0);
    horizontalLength = 1;
  }
  horizontal.normalize();

  // 발사 세기는 드래그 길이로 결정하되, 충분한 속도 범위를 확보한다.
  const dragLength = THREE.MathUtils.clamp(aim.length(), 2, 18);
  const speed = THREE.MathUtils.clamp(8 + dragLength * 0.9, 10, 24);

  // 핵심 수정: 최소 약 32도 이상의 상승각을 보장한다.
  // 따라서 수평에 가깝게 드래그해도 '직선 발사'가 아니라 눈에 띄는 포물선이 된다.
  const rawAngle = Math.atan2(Math.abs(aim.y), Math.max(horizontalLength, 0.01));
  const elevation = THREE.MathUtils.clamp(0.56 + rawAngle * 0.45, 0.56, 1.00);

  const v = new THREE.Vector3();
  v.x = horizontal.x * speed * Math.cos(elevation);
  v.z = horizontal.z * speed * Math.cos(elevation);
  v.y = speed * Math.sin(elevation);
  return v;
}

function trajectory() {
  for (const p of particles) world.remove(p);
  particles = [];
  if (trajectoryLine) {
    world.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine.material.dispose();
    trajectoryLine = null;
  }
  if (running) return;

  const points = [];
  const p = startPos.clone();
  const v = getLaunchVelocity();
  const dt = 0.045;

  // 110개 샘플로 연속 라인을 만들어 예측 궤적이 점점 끊겨 보이지 않게 한다.
  for (let i = 0; i < 110; i++) {
    const t = i * dt;
    points.push(new THREE.Vector3(
      p.x + v.x * t + 0.5 * gravity.x * t * t,
      p.y + v.y * t + 0.5 * gravity.y * t * t,
      p.z + v.z * t + 0.5 * gravity.z * t * t
    ));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xffd45a,
    transparent: true,
    opacity: 0.62
  });
  trajectoryLine = new THREE.Line(geometry, material);
  world.add(trajectoryLine);
}

function launch() {
  if (running || shots <= 0) return;

  shots--;
  running = true;
  passed = 0;
  accumulator = 0;

  previousSimPosition.copy(simPosition);
  simVelocity.copy(getLaunchVelocity());
  activeGravity.copy(gravity);

  if (trajectoryLine) {
    world.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine.material.dispose();
    trajectoryLine = null;
  }

  document.querySelector('#status').textContent = 'FLIGHT · 포물선 운동';
  updateUI();
  beep(440, 0.08);
}

function hitRing(r) {
  if (r.userData.passed) return;
  const d = simPosition.distanceTo(r.position);
  if (d < 1.15) {
    r.userData.passed = true;
    passed++;
    r.material.emissive.setHex(0x46ff88);
    burst(r.position, 0x46ff88);
    beep(880, 0.12);

    if (passed >= rings.length) {
      running = false;
      stars = Math.max(1, 3 - (3 - shots));
      document.querySelector('#status').textContent = 'LEVEL CLEAR';
      updateUI();
    }
  }
}

function burst(pos, color) {
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 5),
      new THREE.MeshBasicMaterial({ color })
    );
    s.position.copy(pos);
    s.userData.v = new THREE.Vector3(
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5
    );
    s.userData.life = 1;
    world.add(s);
    objects.push(s);
  }
}

function beep(freq, duration) {
  try {
    const a = new AudioContext();
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.035;
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + duration);
  } catch {}
}

function isInsideZone(position, z) {
  return (
    Math.abs(position.x - z.position.x) < z.scale.x / 2 &&
    Math.abs(position.y - z.position.y) < z.scale.y / 2 &&
    Math.abs(position.z - z.position.z) < z.scale.z / 2
  );
}

function physicsStep(dt) {
  if (!running) return;

  previousSimPosition.copy(simPosition);

  activeGravity.copy(gravity);
  for (const z of zones) {
    if (isInsideZone(simPosition, z)) {
      activeGravity.multiplyScalar(z.userData.gravity);
      break;
    }
  }

  // 고정 시간 간격으로 속도와 위치를 갱신한다.
  simVelocity.addScaledVector(activeGravity, dt);
  simPosition.addScaledVector(simVelocity, dt);

  // 움직이는 플랫폼
  for (const p of platforms) {
    p.position.x = p.userData.base.x + Math.sin(performance.now() / 1000 + p.userData.phase) * 3;
    const halfW = p.geometry.parameters.width / 2;
    const halfD = p.geometry.parameters.depth / 2;
    if (
      simPosition.y < p.position.y + 1.0 &&
      simPosition.y > p.position.y - 0.15 &&
      Math.abs(simPosition.x - p.position.x) < halfW &&
      Math.abs(simPosition.z - p.position.z) < halfD &&
      simVelocity.y < 0
    ) {
      simPosition.y = p.position.y + 1.0;
      simVelocity.y = Math.abs(simVelocity.y) * 0.55;
    }
  }

  for (const r of rings) hitRing(r);

  if (simPosition.y < 0 || simPosition.length() > 35) {
    running = false;
    burst(simPosition, 0xff5555);
    document.querySelector('#status').textContent = 'MISS · R 또는 RESTART';
    updateUI();
    return;
  }

  if (simPosition.y > 18) {
    simVelocity.y *= -0.8;
    simPosition.y = 18;
  }

  for (const axis of ['x', 'z']) {
    if (Math.abs(simPosition[axis]) > 15) {
      simPosition[axis] = Math.sign(simPosition[axis]) * 15;
      simVelocity[axis] *= -0.82;
      burst(simPosition, 0x7cc7ff);
    }
  }
}

function updateCamera(dt) {
  if (keys.ArrowLeft) camYaw += CAM_YAW_SPEED * dt;
  if (keys.ArrowRight) camYaw -= CAM_YAW_SPEED * dt;
  if (keys.ArrowUp) camPitch = Math.min(0.95, camPitch + CAM_PITCH_SPEED * dt);
  if (keys.ArrowDown) camPitch = Math.max(-0.20, camPitch - CAM_PITCH_SPEED * dt);

  const target = running ? renderPosition : camTarget;
  const cp = Math.cos(camPitch);
  const desired = new THREE.Vector3(
    target.x + Math.sin(camYaw) * cp * camDistance,
    target.y + Math.sin(camPitch) * camDistance,
    target.z + Math.cos(camYaw) * cp * camDistance
  );

  camera.position.lerp(desired, 0.16);
  camera.lookAt(target);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const frameDt = Math.min(clock.getDelta(), 0.05);

  accumulator += frameDt;
  let steps = 0;
  while (running && accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
    physicsStep(PHYSICS_DT);
    accumulator -= PHYSICS_DT;
    steps++;
  }

  // 고정 스텝 결과 사이를 보간하여 화면에서는 한 프레임씩 매끄럽게 보이도록 한다.
  const alpha = running ? THREE.MathUtils.clamp(accumulator / PHYSICS_DT, 0, 1) : 1;
  renderPosition.lerpVectors(previousSimPosition, simPosition, alpha);
  ball.position.copy(renderPosition);

  updateCamera(frameDt);

  // 파티클 애니메이션
  for (const o of objects) {
    if (o.userData?.v) {
      o.position.addScaledVector(o.userData.v, frameDt);
      o.userData.life -= frameDt;
      if (o.userData.life < 0) world.remove(o);
    }
  }

  renderer.render(scene, camera);
}

function setMouse(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // 카메라가 보는 방향에 수직인 조준 평면을 사용한다.
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startPos);
  const p = new THREE.Vector3();

  if (raycaster.ray.intersectPlane(plane, p)) {
    // 사용자가 공에서 드래그한 방향이 곧 발사 방향이 되도록 수정했다.
    aim.copy(p).sub(startPos);
    if (aim.length() < 1) aim.set(9, 7, 0);
    aim.clampLength(2, 18);
    trajectory();
  }
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (running || document.querySelector('#start').style.display !== 'none') return;
  dragging = true;
  setMouse(e);
});

renderer.domElement.addEventListener('pointermove', e => {
  if (!dragging || running) return;
  setMouse(e);
});

addEventListener('pointerup', () => {
  dragging = false;
});

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();

  if (e.code === 'Space') launch();
  if (e.code === 'KeyR') {
    loadLevel(levelIndex);
    trajectory();
  }
});

addEventListener('keyup', e => {
  keys[e.code] = false;
});

document.querySelector('#restart').onclick = () => {
  loadLevel(levelIndex);
  trajectory();
};

document.querySelector('#next').onclick = () => {
  if (passed >= rings.length) {
    levelIndex = Math.min(9, levelIndex + 1);
    loadLevel(levelIndex);
    trajectory();
  }
};

document.querySelector('#camera').onclick = () => {
  cameraMode = (cameraMode + 1) % 3;
  if (cameraMode === 0) { camDistance = 17; camPitch = 0.28; }
  if (cameraMode === 1) { camDistance = 11; camPitch = 0.35; }
  if (cameraMode === 2) { camDistance = 23; camPitch = 0.85; }
  document.querySelector('#camera').textContent = ['CAMERA: FREE', 'CAMERA: BALL', 'CAMERA: OVERVIEW'][cameraMode];
};

document.querySelector('#startBtn').onclick = () => {
  document.querySelector('#start').style.display = 'none';
  loadLevel(0);
  trajectory();
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

loadLevel(0);
trajectory();
animate();
