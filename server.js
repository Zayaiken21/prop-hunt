const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

const TICK_MS = 80;
const VOTE_TIME = 30;
const HIDE_TIME = 30;
const ROUND_TIME = 210;
const BETWEEN_TIME = 12;
const MAX_ROUNDS = 3;
const WORLD_LIMIT = 45;
const BOT_COUNT = 6;
const SOUND_EVERY = 7;

const MAPS = [
  { id:'toybox', name:'Toy Box Bedroom', color:'#7c3aed', theme:'bedroom', props:['Block','Ball','Book','Cup','Pillow','Lamp'], spawns:{hunter:[0,0], prop:[-25,20]} },
  { id:'market', name:'Neon Mini Market', color:'#06b6d4', theme:'market', props:['Crate','Can','Box','Cone','Bottle','Register'], spawns:{hunter:[0,-28], prop:[22,20]} },
  { id:'park', name:'Moonlight Park', color:'#22c55e', theme:'park', props:['Bush','Bench','Rock','Barrel','TrashCan','Log'], spawns:{hunter:[-30,-25], prop:[22,18]} },
  { id:'office', name:'Tiny Office', color:'#f59e0b', theme:'office', props:['Chair','Monitor','Plant','Cabinet','Printer','Mug'], spawns:{hunter:[26,-26], prop:[-22,21]} },
  { id:'warehouse', name:'Candy Warehouse', color:'#ec4899', theme:'warehouse', props:['Pallet','Barrel','CandyBox','Tire','Lollipop','GumBox'], spawns:{hunter:[0,30], prop:[-22,-18]} },
  { id:'arcade', name:'Retro Arcade', color:'#a855f7', theme:'arcade', props:['Cabinet','Stool','Speaker','TokenBox','PrizeBox','NeonCube'], spawns:{hunter:[-28,0], prop:[20,-22]} },
  { id:'kitchen', name:'Giant Kitchen', color:'#fb7185', theme:'kitchen', props:['Cup','Plate','Pan','Bottle','BreadBox','Apple'], spawns:{hunter:[25,25], prop:[-20,-24]} }
];

const rooms = new Map();

function code(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<5;i++) c+=chars[Math.floor(Math.random()*chars.length)]; return rooms.has(c)?code():c; }
function cleanName(name){ const n=String(name||'').replace(/[<>]/g,'').trim().slice(0,16); return n; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, Number.isFinite(n)?n:0)); }
function currentMap(room){ return MAPS.find(m=>m.id===room.mapId) || MAPS[0]; }
function botId(room,i){ return `bot_${room.code}_${i}`; }
function isBotId(id){ return String(id).startsWith('bot_'); }

function makeRoom(roomCode, hostId){
  return { code:roomCode, hostId, phase:'voting', timeLeft:VOTE_TIME, mapId:MAPS[0].id, votes:{}, players:{}, caught:new Set(), round:0, message:'Vote for a real map. All players voting starts faster.', nextSoundAt:0, sounds:[], lastBotThink:0 };
}
function spawnNear(map, team){
  const base = team==='hunter' ? map.spawns.hunter : map.spawns.prop;
  return { x:base[0]+(Math.random()-.5)*10, y:1.1, z:base[1]+(Math.random()-.5)*10, ry:Math.random()*Math.PI*2 };
}
function addBots(room){
  for(let i=0;i<BOT_COUNT;i++){
    const id=botId(room,i); if(room.players[id]) continue;
    room.players[id]={ id, name:['NovaBot','SeekBot','MangoBot','PixelBot','SneakBot','ZippyBot'][i]||`Bot ${i+1}`, bot:true, team:'waiting', propType:'Player', health:100, score:0, target:null, aiTimer:0, ...spawnNear(currentMap(room),'prop') };
  }
}
function humanIds(room){ return Object.keys(room.players).filter(id=>!isBotId(id)); }
function allHumansVoted(room){ const ids=humanIds(room); return ids.length>0 && ids.every(id=>room.votes[id]); }
function pickVotedMap(room){
  const counts={}; Object.values(room.votes).forEach(v=>counts[v]=(counts[v]||0)+1);
  let best=MAPS[Math.floor(Math.random()*MAPS.length)].id, bestCount=-1;
  for(const m of MAPS){ const c=counts[m.id]||0; if(c>bestCount){ best=m.id; bestCount=c; } }
  return best;
}
function assignTeams(room){
  const ids=Object.keys(room.players); const humans=humanIds(room);
  const hunterCount = Math.max(1, Math.floor(ids.length/4));
  let hunterPool = humans.length ? humans.slice() : ids.slice();
  if(room.lastHunters?.length){ hunterPool = hunterPool.filter(id=>!room.lastHunters.includes(id)); if(!hunterPool.length) hunterPool=humans.length?humans.slice():ids.slice(); }
  const firstHunter = hunterPool[Math.floor(Math.random()*hunterPool.length)];
  const shuffled = ids.filter(id=>id!==firstHunter).sort(()=>Math.random()-.5);
  const hunters=[firstHunter, ...shuffled.slice(0, hunterCount-1)]; room.lastHunters=hunters;
  const map=currentMap(room);
  ids.forEach((id,i)=>{ const p=room.players[id]; p.team=hunters.includes(id)?'hunter':'prop'; p.health=p.team==='hunter'?100:3; p.propType=p.team==='prop'?map.props[i%map.props.length]:'Hunter'; p.frozen=p.team==='hunter'; p.caught=false; p.target=null; Object.assign(p, spawnNear(map,p.team)); });
}
function publicRoom(room){
  const players={}; for(const [id,p] of Object.entries(room.players)){ players[id]={id,name:p.name,bot:!!p.bot,team:p.team,x:p.x,y:p.y,z:p.z,ry:p.ry,propType:p.propType,health:p.health,frozen:p.frozen,caught:room.caught.has(id),score:p.score||0}; }
  return { code:room.code, hostId:room.hostId, phase:room.phase, timeLeft:Math.ceil(room.timeLeft), round:room.round, maxRounds:MAX_ROUNDS, soundCountdown: room.phase==='round' ? Math.max(0, Math.ceil(room.nextSoundAt-room.timeLeft)) : 0, mapId:room.mapId, map:currentMap(room), maps:MAPS, votes:room.votes, players, message:room.message, sounds:room.sounds.slice(-5) };
}
function broadcast(room){ io.to(room.code).emit('state', publicRoom(room)); }
function startVote(room){ room.phase='voting'; room.timeLeft=VOTE_TIME; room.votes={}; room.caught.clear(); room.round=0; room.message='Vote for the next map. Home leaves instantly.'; room.sounds=[]; addBots(room); for(const p of Object.values(room.players)){ p.team='waiting'; p.propType='Player'; p.frozen=false; Object.assign(p, spawnNear(currentMap(room),'prop')); } broadcast(room); }
function startRound(room){ room.mapId=pickVotedMap(room); room.phase='hide'; room.timeLeft=HIDE_TIME; room.round+=1; room.votes={}; room.caught.clear(); room.message=`Round ${room.round}/${MAX_ROUNDS}: props hide now. Hunters unlock soon.`; room.sounds=[]; assignTeams(room); broadcast(room); }
function nextRoundOrVote(room,msg){
  room.phase='between'; room.timeLeft=BETWEEN_TIME; room.message=msg;
  const alive=Object.values(room.players).filter(p=>p.team==='prop'&&!room.caught.has(p.id));
  if(alive.length) alive.forEach(p=>p.score=(p.score||0)+2); else Object.values(room.players).filter(p=>p.team==='hunter').forEach(p=>p.score=(p.score||0)+2);
  io.to(room.code).emit('roundMessage',{message:msg}); broadcast(room);
}
function releaseHunters(room){ room.phase='round'; room.timeLeft=ROUND_TIME; room.nextSoundAt=ROUND_TIME-SOUND_EVERY; room.message='Hunters released. Props make a sound every 7 seconds.'; for(const p of Object.values(room.players)) p.frozen=false; io.to(room.code).emit('roundMessage',{message:'Hunters released! Listen for prop sounds.'}); broadcast(room); }
function caught(room,hunter,target){ room.caught.add(target.id); target.team='spectator'; target.propType='Ghost'; target.caught=true; hunter.score=(hunter.score||0)+1; room.message=`${hunter.name} caught ${target.name}!`; io.to(room.code).emit('roundMessage',{message:room.message}); const alive=Object.values(room.players).filter(p=>p.team==='prop'&&!room.caught.has(p.id)); if(!alive.length) nextRoundOrVote(room,'All props caught! Teams switch next round.'); }
function doPropSounds(room){
  const props=Object.values(room.players).filter(p=>p.team==='prop'&&!room.caught.has(p.id));
  for(const p of props){ room.sounds.push({id:p.id,name:p.name,x:p.x,z:p.z,t:Date.now()}); }
  room.message = props.length ? `Sound event: ${props.map(p=>p.name).join(', ')} made noise!` : 'No props left to make sound.';
  io.to(room.code).emit('propSound',{sounds:room.sounds.slice(-props.length),message:room.message});
  room.nextSoundAt = room.timeLeft-SOUND_EVERY;
}
function botThink(room,dt){
  if(room.phase!=='hide' && room.phase!=='round') return;
  for(const p of Object.values(room.players).filter(p=>p.bot)){
    if(room.caught.has(p.id)||p.team==='spectator') continue;
    if(p.team==='hunter' && room.phase==='hide') continue;
    if(p.team==='prop'){
      p.aiTimer-=dt; if(p.aiTimer<=0){ p.aiTimer=1.5+Math.random()*3; const map=currentMap(room); p.propType=map.props[Math.floor(Math.random()*map.props.length)]; p.target={x:p.x+(Math.random()-.5)*18,z:p.z+(Math.random()-.5)*18}; }
      if(room.phase==='round' && Math.random()<.025) p.target={x:p.x+(Math.random()-.5)*8,z:p.z+(Math.random()-.5)*8};
    } else if(p.team==='hunter'){
      let target=null, best=999;
      const sounds=room.sounds.slice(-10);
      for(const s of sounds){ const d=Math.hypot(p.x-s.x,p.z-s.z); if(d<best){best=d; target={x:s.x+(Math.random()-.5)*7,z:s.z+(Math.random()-.5)*7};} }
      if(!target){ for(const q of Object.values(room.players)){ if(q.team==='prop'&&!room.caught.has(q.id)){ const d=Math.hypot(p.x-q.x,p.z-q.z); if(d<best && d<18){best=d; target={x:q.x,z:q.z,targetId:q.id};} } } }
      if(!target || Math.random()<.02) target={x:(Math.random()-.5)*70,z:(Math.random()-.5)*70}; p.target=target;
      for(const q of Object.values(room.players)){ if(q.team==='prop'&&!room.caught.has(q.id)&&Math.hypot(p.x-q.x,p.z-q.z)<2.8){ caught(room,p,q); break; } }
    }
    if(p.target){ const dx=p.target.x-p.x, dz=p.target.z-p.z, len=Math.hypot(dx,dz)||1; const sp=(p.team==='hunter'?9:6)*dt; p.x=clamp(p.x+dx/len*sp,-WORLD_LIMIT,WORLD_LIMIT); p.z=clamp(p.z+dz/len*sp,-WORLD_LIMIT,WORLD_LIMIT); p.ry=Math.atan2(dx,dz); if(len<1.2) p.target=null; }
  }
}

io.on('connection', socket=>{
  socket.on('createRoom', ({name})=>{ const n=cleanName(name); if(!n) return socket.emit('errorMsg','Pick a username first.'); const roomCode=code(); const room=makeRoom(roomCode,socket.id); rooms.set(roomCode,room); room.players[socket.id]={id:socket.id,name:n,team:'waiting',propType:'Player',health:100,score:0,...spawnNear(currentMap(room),'prop')}; addBots(room); socket.join(roomCode); socket.data.roomCode=roomCode; socket.emit('joined',{roomCode,id:socket.id}); broadcast(room); });
  socket.on('joinRoom', ({roomCode,name})=>{ const n=cleanName(name); if(!n) return socket.emit('errorMsg','Pick a username first.'); roomCode=String(roomCode||'').toUpperCase().trim(); const room=rooms.get(roomCode); if(!room) return socket.emit('errorMsg','Room not found.'); room.players[socket.id]={id:socket.id,name:n,team:'waiting',propType:'Player',health:100,score:0,...spawnNear(currentMap(room),'prop')}; socket.join(roomCode); socket.data.roomCode=roomCode; socket.emit('joined',{roomCode,id:socket.id}); broadcast(room); });
  socket.on('leaveRoom',()=>{ const room=rooms.get(socket.data.roomCode); if(!room) return; delete room.players[socket.id]; delete room.votes[socket.id]; socket.leave(room.code); socket.data.roomCode=null; const ids=humanIds(room); if(!ids.length) rooms.delete(room.code); else { if(room.hostId===socket.id) room.hostId=ids[0]; broadcast(room); } socket.emit('leftRoom'); });
  socket.on('voteMap', ({mapId})=>{ const room=rooms.get(socket.data.roomCode); if(!room||!MAPS.some(m=>m.id===mapId)||room.phase!=='voting') return; room.votes[socket.id]=mapId; room.message=`${room.players[socket.id]?.name||'Player'} voted.`; if(allHumansVoted(room)) room.timeLeft=Math.min(room.timeLeft,3); broadcast(room); });
  socket.on('forceStart',()=>{ const room=rooms.get(socket.data.roomCode); if(room&&room.hostId===socket.id&&room.phase==='voting') startRound(room); });
  socket.on('move', data=>{ const room=rooms.get(socket.data.roomCode); const p=room?.players[socket.id]; if(!room||!p||room.caught.has(socket.id)) return; if(p.team==='hunter'&&room.phase==='hide') return; if(!['hide','round','between','voting'].includes(room.phase)) return; p.x=clamp(Number(data.x),-WORLD_LIMIT,WORLD_LIMIT); p.z=clamp(Number(data.z),-WORLD_LIMIT,WORLD_LIMIT); p.y=1.1; p.ry=Number(data.ry)||p.ry; });
  socket.on('changeProp', ({propType})=>{ const room=rooms.get(socket.data.roomCode); const p=room?.players[socket.id]; if(!room||!p||p.team!=='prop'||room.caught.has(socket.id)) return; if(!currentMap(room).props.includes(propType)) return; p.propType=propType; room.message=`${p.name} transformed into ${propType}.`; broadcast(room); });
  socket.on('tag', ({targetId})=>{ const room=rooms.get(socket.data.roomCode); const hunter=room?.players[socket.id], target=room?.players[targetId]; if(!room||!hunter||!target||hunter.team!=='hunter'||target.team!=='prop'||room.caught.has(targetId)||room.phase!=='round') return; if(Math.hypot(hunter.x-target.x,hunter.z-target.z)<=3.1) caught(room,hunter,target); });
  socket.on('disconnect',()=>{ const room=rooms.get(socket.data.roomCode); if(!room) return; delete room.players[socket.id]; delete room.votes[socket.id]; const ids=humanIds(room); if(!ids.length) rooms.delete(room.code); else { if(room.hostId===socket.id) room.hostId=ids[0]; broadcast(room); } });
});

setInterval(()=>{ for(const room of rooms.values()){ const dt=TICK_MS/1000; room.timeLeft-=dt; botThink(room,dt); if(room.phase==='voting'&&room.timeLeft<=0) startRound(room); else if(room.phase==='hide'&&room.timeLeft<=0) releaseHunters(room); else if(room.phase==='round'){ if(room.timeLeft<=room.nextSoundAt) doPropSounds(room); const alive=Object.values(room.players).filter(p=>p.team==='prop'&&!room.caught.has(p.id)); if(room.timeLeft<=0) nextRoundOrVote(room,'Time is up! Props survived.'); else if(!alive.length) nextRoundOrVote(room,'All props caught! Teams switch next round.'); } else if(room.phase==='between'&&room.timeLeft<=0){ if(room.round>=MAX_ROUNDS) startVote(room); else startRound(room); } broadcast(room); } }, TICK_MS);
server.listen(PORT,()=>console.log(`Dropz Prop Hunt running on ${PORT}`));
