import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js';

const app=document.querySelector('#game');
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x070a12);
scene.fog=new THREE.Fog(0x070a12,35,90);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.05,150);
camera.position.set(10,8,15);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.8)); renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; app.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0x9bb7ff,0x10131c,1.5));
const sun=new THREE.DirectionalLight(0xffffff,2.1); sun.position.set(7,15,8); sun.castShadow=true; sun.shadow.mapSize.set(1024,1024); scene.add(sun);

const world=new THREE.Group(); scene.add(world);
const ball=new THREE.Mesh(new THREE.SphereGeometry(.38,28,18),new THREE.MeshStandardMaterial({color:0xffd45a,emissive:0x5a3500,emissiveIntensity:.45,metalness:.35,roughness:.25}));
ball.castShadow=true; world.add(ball);
let velocity=new THREE.Vector3(), gravity=new THREE.Vector3(0,-9.8,0);
let running=false, levelIndex=0, shots=3, passed=0, stars=0, cameraMode=0, aim=new THREE.Vector3(7,7,0), startPos=new THREE.Vector3(-8,3,0);
let objects=[], rings=[], platforms=[], switches=[], portals=[], zones=[], particles=[], keys={};
const raycaster=new THREE.Raycaster(), mouse=new THREE.Vector2(); let dragging=false;
let camYaw=0.62, camPitch=0.28, camDistance=17;
const camTarget=new THREE.Vector3(0,2,0);
const CAM_YAW_SPEED=1.7, CAM_PITCH_SPEED=1.25;

const levels=[
 {name:'3D BASICS',obj:'Pass the ring using a controlled parabola.',pos:[-8,3,0],ring:[[5,4,0]],walls:[]},
 {name:'REFLECTION',obj:'Use the wall reflection to reach the ring.',pos:[-8,3,-4],ring:[[7,5,2]],walls:[[0,3,0,0,0,Math.PI/2]]},
 {name:'MOVING PLATFORM',obj:'Land on the moving platform, then pass the ring.',pos:[-8,5,0],ring:[[8,7,0]],platform:[[0,2,0,6,0,0]]},
 {name:'SWITCH ORDER',obj:'Activate switches in order: A → B → C.',pos:[-8,3,0],ring:[[9,6,0]],switches:[[-2,2,0],[2,4,-2],[6,3,2]]},
 {name:'GRAVITY FIELD',obj:'Cross the low-gravity zone and reach the ring.',pos:[-8,4,0],ring:[[8,7,0]],zone:[[0,3,0,10,8,8,.35]]},
 {name:'PORTAL',obj:'Enter Portal A and emerge at Portal B.',pos:[-8,3,-3],ring:[[8,6,3]],portal:[[-2,4,-3],[4,6,3]]},
 {name:'MOVING WALLS',obj:'Time your launch through moving obstacles.',pos:[-8,4,0],ring:[[9,6,0]],walls:[[0,4,0,1,5,0],[5,5,0,1,4,0]]},
 {name:'REFLECT + PLATFORM',obj:'Combine a bounce with a moving platform.',pos:[-8,5,-2],ring:[[9,7,2]],walls:[[0,4,-2,0,0,Math.PI/2]],platform:[[3,2,0,4,0,0]]},
 {name:'SYSTEM CHAIN',obj:'Use switches, gravity and a portal.',pos:[-8,4,0],ring:[[10,7,3]],switches:[[-3,3,-2],[0,5,0],[3,4,2]],portal:[[5,4,-4],[7,5,3]],zone:[[0,3,0,8,8,8,.5]]},
 {name:'FINAL PUZZLE',obj:'Solve the complete 3D physics challenge.',pos:[-10,5,-4],ring:[[11,8,4]],walls:[[0,5,-4,0,0,Math.PI/2],[5,6,0,0,0,Math.PI/4]],platform:[[4,3,0,5,0,0]],switches:[[-3,3,-1],[1,5,1]],portal:[[6,5,-5],[9,7,3]],zone:[[1,4,0,8,8,8,.45]]}
];

function mat(c,e=0){return new THREE.MeshStandardMaterial({color:c,emissive:e,emissiveIntensity:.25,metalness:.15,roughness:.55})}
function clearWorld(){for(const o of objects) world.remove(o);objects=[];rings=[];platforms=[];switches=[];portals=[];zones=[];particles=[]}
function addBox(pos,size,color=0x3d6aa8,rot=0){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat(color));m.position.set(...pos);m.rotation.y=rot;m.castShadow=m.receiveShadow=true;world.add(m);objects.push(m);return m}
function addRing(pos){const g=new THREE.TorusGeometry(1.35,.12,16,48);const m=new THREE.Mesh(g,mat(0x49e6ff,0x0b5b6b));m.position.set(...pos);m.rotation.y=Math.PI/2;world.add(m);rings.push(m);objects.push(m)}
function loadLevel(i){clearWorld(); const l=levels[i]; startPos.set(...l.pos); ball.position.copy(startPos); velocity.set(0,0,0); running=false;passed=0;shots=3;
  for(const p of l.ring||[]) addRing(p);
  for(const w of l.walls||[]) addBox(w.slice(0,3),[w[3]||10,w[4]||8,.35],0x8d5260,w[5]||0);
  for(const p of l.platform||[]){const m=addBox(p.slice(0,3),[p[3]||5,0.5,p[4]||3],0x657a9b);m.userData.base=m.position.clone();m.userData.phase=Math.random()*6.28;platforms.push(m)}
  for(const s of l.switches||[]){const m=addBox(s,[1,.25,1],0xe4a33b);m.userData.active=false;switches.push(m)}
  for(const p of l.portal||[]){const m=new THREE.Mesh(new THREE.TorusGeometry(.9,.18,14,36),mat(0xb56cff,0x57208f));m.position.set(...p);world.add(m);portals.push(m);objects.push(m)}
  for(const z of l.zone||[]){const m=addBox(z.slice(0,3),[z[3],z[4],z[5]],0x305d45);m.material.transparent=true;m.material.opacity=.18;m.userData.gravity=z[6];zones.push(m)}
  // arena floor and guide lines
  addBox([0,-.45,0],[30,.4,26],0x172031);
  for(let x=-15;x<=15;x+=3){const g=new THREE.Mesh(new THREE.BoxGeometry(.025,.02,26),new THREE.MeshBasicMaterial({color:0x233047}));g.position.set(x,-.23,0);world.add(g);objects.push(g)}
  updateUI();
}
function updateUI(){document.querySelector('#level').textContent=`LEVEL ${String(levelIndex+1).padStart(2,'0')}`;document.querySelector('#objective').textContent=levels[levelIndex].obj;document.querySelector('#shots').textContent='● '.repeat(shots).trim()+(' ○ '.repeat(3-shots));document.querySelector('#stars').textContent='★'.repeat(stars)+'☆'.repeat(3-stars);document.querySelector('#status').textContent=running?'공이 날아가는 중…':'마우스로 발사 방향/힘 조절 · SPACE로 발사 · 화살표키로 카메라 회전';document.querySelector('#next').style.display=(passed>=rings.length&&rings.length)?'inline-block':'none'}
function trajectory(){
  for(const p of particles) world.remove(p);
  particles=[];
  if(running)return;

  let p=startPos.clone();
  let v=aim.clone().normalize().multiplyScalar(Math.min(aim.length(),18));
  const dt=.08;
  for(let i=0;i<55;i++){
    p.addScaledVector(v,dt);
    v.addScaledVector(gravity,dt);

    const s=new THREE.Mesh(
      new THREE.SphereGeometry(.045,8,6),
      new THREE.MeshBasicMaterial({
        color:0xffd45a,
        transparent:true,
        opacity:Math.max(.12,1-i/60)
      })
    );
    s.position.copy(p);
    world.add(s);
    particles.push(s);
  }
}
function launch(){if(running||shots<=0)return;shots--;running=true;passed=0;velocity.copy(aim).normalize().multiplyScalar(Math.min(aim.length(),18));document.querySelector('#status').textContent='FLIGHT';updateUI(); beep(440,.08)}
function hitRing(r){const d=ball.position.distanceTo(r.position);if(d<1.15){passed++;r.material.emissive.setHex(0x46ff88);burst(r.position,0x46ff88);beep(880,.12);if(passed>=rings.length){running=false;stars=Math.max(1,3-(3-shots));document.querySelector('#status').textContent='LEVEL CLEAR';updateUI()}}}
function burst(pos,c){for(let i=0;i<18;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.05,6,5),new THREE.MeshBasicMaterial({color:c}));s.position.copy(pos);s.userData.v=new THREE.Vector3((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*5);s.userData.life=1;world.add(s);objects.push(s)}}
function beep(freq,d){try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.frequency.value=freq;g.gain.value=.035;o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+d)}catch{}}
function update(dt){
  if(!running)return;

  // 여러 번의 작은 물리 스텝으로 계산해 저프레임에서도 궤적과 충돌이 더 안정적으로 보이게 한다.
  const steps=4;
  const stepDt=dt/steps;

  for(let step=0;step<steps;step++){
    let g=gravity.clone();
    for(const z of zones){
      if(
        Math.abs(ball.position.x-z.position.x)<z.scale.x/2 &&
        Math.abs(ball.position.y-z.position.y)<z.scale.y/2 &&
        Math.abs(ball.position.z-z.position.z)<z.scale.z/2
      ){
        g.multiplyScalar(z.userData.gravity);
      }
    }

    velocity.addScaledVector(g,stepDt);
    ball.position.addScaledVector(velocity,stepDt);

    for(const p of platforms){
      p.position.x=p.userData.base.x+
        Math.sin(performance.now()/1000+p.userData.phase)*3;

      if(
        ball.position.y < p.position.y+1 &&
        ball.position.y > p.position.y &&
        Math.abs(ball.position.x-p.position.x)<p.geometry.parameters.width/2 &&
        Math.abs(ball.position.z-p.position.z)<p.geometry.parameters.depth/2 &&
        velocity.y<0
      ){
        ball.position.y=p.position.y+1;
        velocity.y=Math.abs(velocity.y)*.55;
      }
    }

    for(const r of rings)hitRing(r);

    if(ball.position.y<0 || ball.position.length()>35){
      running=false;
      burst(ball.position,0xff5555);
      document.querySelector('#status').textContent='MISS · RESTART OR TRY AGAIN';
      updateUI();
      return;
    }

    if(ball.position.y>18){
      velocity.y*=-.8;
      ball.position.y=18;
    }

    for(const axis of ['x','z']){
      if(Math.abs(ball.position[axis])>15){
        ball.position[axis]=Math.sign(ball.position[axis])*15;
        velocity[axis]*=-.82;
        burst(ball.position,0x7cc7ff);
      }
    }
  }
}
function updateCamera(){
  const target=running ? ball.position : camTarget;
  const cp=Math.cos(camPitch);
  const desired=new THREE.Vector3(
    target.x + Math.sin(camYaw)*cp*camDistance,
    target.y + Math.sin(camPitch)*camDistance,
    target.z + Math.cos(camYaw)*cp*camDistance
  );
  camera.position.lerp(desired,.14);
  camera.lookAt(target);
}

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.025);

  update(dt);
  updateCamera();

  for(const o of objects){
    if(o.userData?.v){
      o.position.addScaledVector(o.userData.v,dt);
      o.userData.life-=dt;
      if(o.userData.life<0)world.remove(o);
    }
  }

  renderer.render(scene,camera);
}
const clock=new THREE.Clock();
renderer.domElement.addEventListener('pointerdown',e=>{if(running)return;dragging=true;setMouse(e)});
renderer.domElement.addEventListener('pointermove',e=>{if(!dragging||running)return;setMouse(e);trajectory()});
addEventListener('pointerup',()=>dragging=false);
function setMouse(e){
  mouse.x=e.clientX/innerWidth*2-1;
  mouse.y=-(e.clientY/innerHeight)*2+1;

  raycaster.setFromCamera(mouse,camera);

  // 화면과 거의 평행한 평면을 사용해 마우스의 위/아래 움직임도 발사각에 반영한다.
  const normal=new THREE.Vector3();
  camera.getWorldDirection(normal);

  const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,startPos);
  const p=new THREE.Vector3();

  if(raycaster.ray.intersectPlane(plane,p)){
    aim.copy(startPos).sub(p);

    // 너무 약한 입력 방지 + 충분히 큰 수직 발사각 허용
    if(aim.length()<1) aim.set(6,6,0);
    aim.clampLength(1,18);
  }
}

addEventListener('keydown',e=>{
  keys[e.code]=true;

  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)){
    e.preventDefault();
  }

  if(e.code==='Space')launch();
  if(e.code==='KeyR'){
    loadLevel(levelIndex);
    trajectory();
  }
});
addEventListener('keyup',e=>keys[e.code]=false);

setInterval(()=>{
  const dt=.016;
  if(keys.ArrowLeft)  camYaw += CAM_YAW_SPEED*dt;
  if(keys.ArrowRight) camYaw -= CAM_YAW_SPEED*dt;
  if(keys.ArrowUp)    camPitch = Math.min(.95,camPitch + CAM_PITCH_SPEED*dt);
  if(keys.ArrowDown)  camPitch = Math.max(-.25,camPitch - CAM_PITCH_SPEED*dt);
},16);
document.querySelector('#restart').onclick=()=>{loadLevel(levelIndex);trajectory()};
document.querySelector('#next').onclick=()=>{if(passed>=rings.length){levelIndex=Math.min(9,levelIndex+1);loadLevel(levelIndex);trajectory()}};
document.querySelector('#camera').onclick=()=>{
  cameraMode=(cameraMode+1)%3;
  if(cameraMode===0){camDistance=17;camPitch=.28;}
  if(cameraMode===1){camDistance=11;camPitch=.35;}
  if(cameraMode===2){camDistance=23;camPitch=.85;}
  document.querySelector('#camera').textContent=['CAMERA: FREE','CAMERA: BALL','CAMERA: OVERVIEW'][cameraMode];
};
document.querySelector('#startBtn').onclick=()=>{document.querySelector('#start').style.display='none';loadLevel(0);trajectory()};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
loadLevel(0);trajectory();animate();
