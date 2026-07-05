const socket = io();
let myId = null, room = null, myVote = null, selectedProp = null;
let keys = {}, joy = {x:0,z:0}, yaw = 0, pitch = -0.35, pointerDown = false, lastPointer = null;
const objects = new Map();
const staticObjects = [];
const $ = id => document.getElementById(id);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070816, 42, 105);
const camera = new THREE.PerspectiveCamera(68, innerWidth/innerHeight, .1, 180);
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
$('game').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbfe8ff, 0x15101f, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.position.set(24,40,18); sun.castShadow = true; sun.shadow.mapSize.set(1024,1024); scene.add(sun);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x10172f, roughness:.78, metalness:.08 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(90,1,90), floorMat); floor.position.y=-.55; floor.receiveShadow=true; scene.add(floor);
const grid = new THREE.GridHelper(90, 45, 0x67e8f9, 0x293047); grid.position.y=.01; scene.add(grid);

const mats = {
  hunter: new THREE.MeshStandardMaterial({color:0xef4444, roughness:.42}),
  prop: new THREE.MeshStandardMaterial({color:0x38bdf8, roughness:.55}),
  me: new THREE.MeshStandardMaterial({color:0x22c55e, roughness:.45}),
  ghost: new THREE.MeshStandardMaterial({color:0x94a3b8, transparent:true, opacity:.45}),
  dark: new THREE.MeshStandardMaterial({color:0x1e293b, roughness:.65}),
  accent: new THREE.MeshStandardMaterial({color:0xa78bfa, roughness:.5}),
  wood: new THREE.MeshStandardMaterial({color:0x9a5f28, roughness:.8}),
  green: new THREE.MeshStandardMaterial({color:0x22c55e, roughness:.9})
};

function makeLabel(text){
  const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=64; const c=canvas.getContext('2d');
  c.fillStyle='rgba(0,0,0,.5)'; c.roundRect?.(0,0,256,64,18); c.fill(); c.font='bold 26px Arial'; c.fillStyle='white'; c.textAlign='center'; c.fillText(text,128,40);
  const tex=new THREE.CanvasTexture(canvas); const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true})); spr.scale.set(4,1,1); spr.position.y=3.2; return spr;
}

function propMesh(type, team, mine){
  const mat = team === 'hunter' ? mats.hunter : mine ? mats.me : mats.prop;
  const g = new THREE.Group();
  let mesh;
  if(['Ball','Rock','Bush'].includes(type)) mesh = new THREE.Mesh(new THREE.SphereGeometry(type==='Bush'?1.25:1, 24, 16), type==='Bush'?mats.green:mat);
  else if(['Cone'].includes(type)) mesh = new THREE.Mesh(new THREE.ConeGeometry(.85,2,24), mat);
  else if(['Barrel','Can','Cup'].includes(type)) mesh = new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,1.7,24), mat);
  else if(['Bench'].includes(type)) { mesh = new THREE.Group(); const a=new THREE.Mesh(new THREE.BoxGeometry(2.7,.35,.75), mats.wood); a.position.y=1; const b=a.clone(); b.position.z=.55; b.position.y=1.55; mesh.add(a,b); }
  else if(['Chair'].includes(type)) { mesh = new THREE.Group(); const s=new THREE.Mesh(new THREE.BoxGeometry(1.3,.25,1.3), mat); s.position.y=.85; const back=new THREE.Mesh(new THREE.BoxGeometry(1.3,1.3,.25), mat); back.position.set(0,1.45,.55); mesh.add(s,back); }
  else if(['Monitor'].includes(type)) { mesh = new THREE.Group(); const sc=new THREE.Mesh(new THREE.BoxGeometry(1.8,1.05,.18), mat); sc.position.y=1.35; const st=new THREE.Mesh(new THREE.BoxGeometry(.22,.75,.22), mats.dark); st.position.y=.55; mesh.add(sc,st); }
  else if(['Plant'].includes(type)) { mesh = new THREE.Group(); const pot=new THREE.Mesh(new THREE.CylinderGeometry(.55,.7,.75,18), mats.wood); pot.position.y=.35; const leaf=new THREE.Mesh(new THREE.SphereGeometry(.9,18,12), mats.green); leaf.position.y=1.25; mesh.add(pot,leaf); }
  else if(['Tire'].includes(type)) mesh = new THREE.Mesh(new THREE.TorusGeometry(.8,.28,12,28), mats.dark);
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), mat);
  mesh.traverse?.(o=>{ if(o.isMesh){o.castShadow=true; o.receiveShadow=true;} }); if(mesh.isMesh){mesh.castShadow=true; mesh.receiveShadow=true;}
  g.add(mesh); return g;
}

function rebuildMap(map){
  staticObjects.forEach(o=>scene.remove(o)); staticObjects.length=0;
  scene.background = new THREE.Color(map.color || '#070816');
  const add=(o,x,y,z,s=1)=>{o.position.set(x,y,z);o.scale.setScalar(s);o.traverse?.(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});scene.add(o);staticObjects.push(o)};
  const wallMat = new THREE.MeshStandardMaterial({color:new THREE.Color(map.color).offsetHSL(0,-.15,-.2), roughness:.8});
  [[0,2,-45,90,4,1],[0,2,45,90,4,1],[-45,2,0,1,4,90],[45,2,0,1,4,90]].forEach(w=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w[3],w[4],w[5]),wallMat);add(m,w[0],w[1],w[2])});
  for(let i=0;i<26;i++){
    const x=(Math.random()-.5)*72,z=(Math.random()-.5)*72;
    let o;
    if(map.theme==='park') o=propMesh(i%3?'Bush':'Rock','prop',false);
    else if(map.theme==='office') o=propMesh(['Chair','Monitor','Plant','Cabinet'][i%4],'prop',false);
    else if(map.theme==='market') o=propMesh(['Crate','Can','Box','Cone'][i%4],'prop',false);
    else if(map.theme==='warehouse') o=propMesh(['Pallet','Barrel','CandyBox','Tire'][i%4],'prop',false);
    else o=propMesh(['Block','Ball','Book','Cup'][i%4],'prop',false);
    add(o,x,0,z,.9+Math.random()*.55);
  }
}

function upsertPlayer(p){
  let rec = objects.get(p.id);
  if(!rec || rec.type !== p.propType || rec.team !== p.team){
    if(rec) scene.remove(rec.group);
    const group = propMesh(p.propType, p.team, p.id===myId); const label = makeLabel(p.name); group.add(label); scene.add(group);
    rec = { group, type:p.propType, team:p.team }; objects.set(p.id, rec);
  }
  rec.group.position.lerp(new THREE.Vector3(p.x,p.y,p.z), p.id===myId?1:.35);
  rec.group.rotation.y = p.ry || 0;
  rec.group.visible = !(p.id===myId && p.team !== 'spectator');
}

function renderUI(){
  if(!room) return;
  const me = room.players[myId];
  $('roomInfo').textContent = `Room: ${room.code}  •  Map: ${room.map.name}`;
  $('phase').textContent = `${room.phase.toUpperCase()} • ${room.timeLeft}s`;
  $('role').textContent = `Role: ${me?.team || 'waiting'} ${me?.team==='prop' ? '• Disguise: '+me.propType : ''}`;
  $('players').innerHTML = Object.values(room.players).map(p=>`<span class="tag"><i class="dot ${p.team}"></i>${p.name} · ${p.team} · ${p.score}</span>`).join('');
  $('votePanel').style.display = ['voting','lobby'].includes(room.phase) ? 'block':'none';
  $('start').style.display = room.hostId===myId ? 'block':'none';
  $('maps').innerHTML = room.maps.map(m=>{
    const count = Object.values(room.votes||{}).filter(v=>v===m.id).length;
    return `<button class="mapBtn ${myVote===m.id?'active':''}" data-map="${m.id}" style="box-shadow:inset 0 -4px 0 ${m.color}"><span class="mapName">${m.name}</span><span class="votes">${count} vote${count===1?'':'s'}</span></button>`;
  }).join('');
  document.querySelectorAll('.mapBtn').forEach(b=>b.onclick=()=>{myVote=b.dataset.map;socket.emit('voteMap',{mapId:myVote});renderUI();});
  if(me?.team==='prop'){
    $('propBar').style.display='flex';
    $('propBar').innerHTML = room.map.props.map(p=>`<button class="propBtn ${me.propType===p?'active':''}" data-prop="${p}">${p}</button>`).join('');
    document.querySelectorAll('.propBtn').forEach(b=>b.onclick=()=>socket.emit('changeProp',{propType:b.dataset.prop}));
  } else $('propBar').style.display='none';
  $('hint').style.display = room.phase==='hide' ? 'block':'none';
  $('hint').textContent = me?.team==='hunter' ? `Hunters locked: ${room.timeLeft}s` : `Hide and transform: ${room.timeLeft}s`;
  $('tag').style.display = me?.team==='hunter' ? 'block':'none';
}

socket.on('joined', d=>{myId=d.id; $('menu').style.display='none';});
socket.on('errorMsg', msg=>{$('err').textContent=msg;});
socket.on('roundMessage', d=>toast(d.message));
socket.on('state', st=>{
  const oldMap = room?.mapId; room = st; if(oldMap!==room.mapId) rebuildMap(room.map);
  const live = new Set(Object.keys(room.players));
  for(const id of objects.keys()) if(!live.has(id)){scene.remove(objects.get(id).group);objects.delete(id)}
  Object.values(room.players).forEach(upsertPlayer); renderUI();
});

$('create').onclick=()=>socket.emit('createRoom',{name:$('name').value});
$('join').onclick=()=>socket.emit('joinRoom',{name:$('name').value,roomCode:$('code').value});
$('start').onclick=()=>socket.emit('forceStart');
$('tag').onclick=tagClosest;

function tagClosest(){
  if(!room) return; const me=room.players[myId]; if(!me || me.team!=='hunter') return;
  let best=null, bd=999;
  for(const p of Object.values(room.players)){ if(p.team!=='prop') continue; const d=Math.hypot(me.x-p.x,me.z-p.z); if(d<bd){bd=d;best=p;} }
  if(best && bd<3.2) socket.emit('tag',{targetId:best.id}); else toast('No prop close enough to tag');
}
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',2200)}

addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true); addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
renderer.domElement.addEventListener('pointerdown',e=>{pointerDown=true;lastPointer={x:e.clientX,y:e.clientY};});
addEventListener('pointerup',()=>{pointerDown=false;lastPointer=null;});
addEventListener('pointermove',e=>{if(!pointerDown||!lastPointer)return; yaw -= (e.clientX-lastPointer.x)*.006; pitch = Math.max(-.85,Math.min(.25,pitch-(e.clientY-lastPointer.y)*.004)); lastPointer={x:e.clientX,y:e.clientY};});

const joyEl=$('joy'), knob=$('knob'); let joyActive=false, joyCenter=null;
joyEl.addEventListener('pointerdown',e=>{joyActive=true;joyCenter={x:e.clientX,y:e.clientY};joyEl.setPointerCapture(e.pointerId);});
joyEl.addEventListener('pointermove',e=>{if(!joyActive)return; const dx=e.clientX-joyCenter.x, dy=e.clientY-joyCenter.y, len=Math.min(44,Math.hypot(dx,dy)), a=Math.atan2(dy,dx); joy.x=Math.cos(a)*len/44; joy.z=Math.sin(a)*len/44; knob.style.left=(37+Math.cos(a)*len)+'px'; knob.style.top=(37+Math.sin(a)*len)+'px';});
joyEl.addEventListener('pointerup',()=>{joyActive=false;joy={x:0,z:0};knob.style.left='37px';knob.style.top='37px';});

let lastSend=0;
function animate(t){
  requestAnimationFrame(animate);
  const me = room?.players?.[myId];
  if(me){
    let f=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0) - joy.z;
    let r=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0) + joy.x;
    const speed = me.team==='hunter'? .24 : .18;
    const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    if((Math.abs(f)+Math.abs(r))>0 && !(me.team==='hunter' && room.phase==='hide')){
      const pos = new THREE.Vector3(me.x,me.y,me.z).add(forward.multiplyScalar(f*speed)).add(right.multiplyScalar(r*speed));
      pos.x=Math.max(-41,Math.min(41,pos.x)); pos.z=Math.max(-41,Math.min(41,pos.z));
      me.x=pos.x; me.z=pos.z; me.ry=yaw;
      if(t-lastSend>45){socket.emit('move',{x:me.x,z:me.z,ry:yaw}); lastSend=t;}
    }
    const camDist = me.team==='hunter'? 9.5 : 11.5;
    const camHeight = me.team==='hunter'? 5.4 : 6.4;
    const target = new THREE.Vector3(me.x, me.y+1, me.z);
    const cam = new THREE.Vector3(me.x - Math.sin(yaw)*camDist, me.y+camHeight + pitch*3, me.z - Math.cos(yaw)*camDist);
    camera.position.lerp(cam,.16); camera.lookAt(target);
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(animate);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
