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

const TICK_MS = 50;
const LOBBY_TIME = 20;
const HIDE_TIME = 25;
const ROUND_TIME = 240;
const BETWEEN_TIME = 15;
const WORLD_LIMIT = 42;

const MAPS = [
  { id: 'toybox', name: 'Toy Box Bedroom', color: '#7c3aed', props: ['Block', 'Ball', 'Book', 'Cup'], theme: 'bedroom' },
  { id: 'market', name: 'Neon Mini Market', color: '#06b6d4', props: ['Crate', 'Can', 'Box', 'Cone'], theme: 'market' },
  { id: 'park', name: 'Moonlight Park', color: '#22c55e', props: ['Bush', 'Bench', 'Rock', 'Barrel'], theme: 'park' },
  { id: 'office', name: 'Tiny Office', color: '#f59e0b', props: ['Chair', 'Monitor', 'Plant', 'Cabinet'], theme: 'office' },
  { id: 'warehouse', name: 'Candy Warehouse', color: '#ec4899', props: ['Pallet', 'Barrel', 'CandyBox', 'Tire'], theme: 'warehouse' }
];

const rooms = new Map();

function code() {
  let c = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(c) ? code() : c;
}

function makeRoom(roomCode, hostId) {
  return {
    code: roomCode,
    hostId,
    phase: 'lobby',
    timeLeft: LOBBY_TIME,
    mapId: MAPS[0].id,
    votes: {},
    players: {},
    caught: new Set(),
    lastTick: Date.now()
  };
}

function randSpawn(team) {
  const spread = team === 'hunter' ? 10 : 28;
  return {
    x: (Math.random() - 0.5) * spread,
    y: 1.1,
    z: (Math.random() - 0.5) * spread,
    ry: Math.random() * Math.PI * 2
  };
}

function currentMap(room) {
  return MAPS.find(m => m.id === room.mapId) || MAPS[0];
}

function pickVotedMap(room) {
  const counts = {};
  Object.values(room.votes).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  let best = MAPS[Math.floor(Math.random() * MAPS.length)].id;
  let bestCount = -1;
  for (const m of MAPS) {
    if ((counts[m.id] || 0) > bestCount) {
      best = m.id;
      bestCount = counts[m.id] || 0;
    }
  }
  return best;
}

function assignTeams(room) {
  const ids = Object.keys(room.players);
  const shuffled = ids.sort(() => Math.random() - 0.5);
  const hunters = Math.max(1, Math.floor(ids.length / 4));
  shuffled.forEach((id, i) => {
    const p = room.players[id];
    p.team = i < hunters ? 'hunter' : 'prop';
    p.health = p.team === 'hunter' ? 100 : 3;
    p.propType = p.team === 'prop' ? (currentMap(room).props[i % currentMap(room).props.length]) : 'Hunter';
    p.frozen = p.team === 'hunter';
    Object.assign(p, randSpawn(p.team));
  });
}

function publicRoom(room) {
  const players = {};
  for (const [id, p] of Object.entries(room.players)) {
    players[id] = { id, name: p.name, team: p.team, x: p.x, y: p.y, z: p.z, ry: p.ry, propType: p.propType, health: p.health, frozen: p.frozen, caught: room.caught.has(id), score: p.score || 0 };
  }
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    timeLeft: Math.ceil(room.timeLeft),
    mapId: room.mapId,
    map: currentMap(room),
    maps: MAPS,
    votes: room.votes,
    players
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicRoom(room));
}

function startVote(room) {
  room.phase = 'voting';
  room.timeLeft = LOBBY_TIME;
  room.votes = {};
  room.caught.clear();
  for (const p of Object.values(room.players)) {
    p.team = 'waiting';
    p.propType = 'Player';
    p.health = 100;
    p.frozen = false;
    Object.assign(p, randSpawn('prop'));
  }
  broadcast(room);
}

function startRound(room) {
  room.mapId = pickVotedMap(room);
  room.votes = {};
  room.phase = 'hide';
  room.timeLeft = HIDE_TIME;
  room.caught.clear();
  assignTeams(room);
  broadcast(room);
}

function endRound(room, message = 'Round complete') {
  const propsAlive = Object.values(room.players).filter(p => p.team === 'prop' && !room.caught.has(p.id));
  const hunters = Object.values(room.players).filter(p => p.team === 'hunter');
  if (propsAlive.length) propsAlive.forEach(p => p.score = (p.score || 0) + 2);
  else hunters.forEach(p => p.score = (p.score || 0) + 2);
  room.phase = 'between';
  room.timeLeft = BETWEEN_TIME;
  io.to(room.code).emit('roundMessage', { message });
  broadcast(room);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    const roomCode = code();
    const room = makeRoom(roomCode, socket.id);
    rooms.set(roomCode, room);
    room.players[socket.id] = { id: socket.id, name: cleanName(name), team: 'waiting', propType: 'Player', health: 100, score: 0, ...randSpawn('prop') };
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.emit('joined', { roomCode, id: socket.id });
    startVote(room);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    roomCode = String(roomCode || '').toUpperCase().trim();
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('errorMsg', 'Room not found. Create a new lobby or check the code.');
    room.players[socket.id] = { id: socket.id, name: cleanName(name), team: 'waiting', propType: 'Player', health: 100, score: 0, ...randSpawn('prop') };
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.emit('joined', { roomCode, id: socket.id });
    broadcast(room);
  });

  socket.on('voteMap', ({ mapId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !MAPS.some(m => m.id === mapId)) return;
    room.votes[socket.id] = mapId;
    broadcast(room);
  });

  socket.on('forceStart', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase === 'voting' || room.phase === 'lobby') startRound(room);
  });

  socket.on('move', data => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players[socket.id];
    if (!room || !p || room.caught.has(socket.id)) return;
    if (p.team === 'hunter' && room.phase === 'hide') return;
    const nx = clamp(Number(data.x), -WORLD_LIMIT, WORLD_LIMIT);
    const nz = clamp(Number(data.z), -WORLD_LIMIT, WORLD_LIMIT);
    p.x = nx; p.z = nz; p.y = 1.1; p.ry = Number(data.ry) || p.ry;
  });

  socket.on('changeProp', ({ propType }) => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players[socket.id];
    if (!room || !p || p.team !== 'prop' || room.caught.has(socket.id)) return;
    if (!currentMap(room).props.includes(propType)) return;
    p.propType = propType;
    broadcast(room);
  });

  socket.on('tag', ({ targetId }) => {
    const room = rooms.get(socket.data.roomCode);
    const hunter = room?.players[socket.id];
    const target = room?.players[targetId];
    if (!room || !hunter || !target || hunter.team !== 'hunter' || target.team !== 'prop' || room.caught.has(targetId) || room.phase !== 'round') return;
    const d = Math.hypot(hunter.x - target.x, hunter.z - target.z);
    if (d <= 3.0) {
      room.caught.add(targetId);
      target.team = 'spectator';
      target.propType = 'Ghost';
      hunter.score = (hunter.score || 0) + 1;
      io.to(room.code).emit('roundMessage', { message: `${hunter.name} caught ${target.name}!` });
      const alive = Object.values(room.players).filter(p => p.team === 'prop' && !room.caught.has(p.id));
      if (!alive.length) endRound(room, 'Hunters caught every prop!');
      else broadcast(room);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    delete room.players[socket.id];
    delete room.votes[socket.id];
    room.caught.delete(socket.id);
    const ids = Object.keys(room.players);
    if (!ids.length) rooms.delete(room.code);
    else {
      if (room.hostId === socket.id) room.hostId = ids[0];
      broadcast(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    room.timeLeft -= TICK_MS / 1000;
    if (room.phase === 'voting' && room.timeLeft <= 0) startRound(room);
    else if (room.phase === 'hide' && room.timeLeft <= 0) {
      room.phase = 'round';
      room.timeLeft = ROUND_TIME;
      for (const p of Object.values(room.players)) p.frozen = false;
      io.to(room.code).emit('roundMessage', { message: 'Hunters released!' });
      broadcast(room);
    } else if (room.phase === 'round') {
      const propsAlive = Object.values(room.players).filter(p => p.team === 'prop' && !room.caught.has(p.id));
      if (room.timeLeft <= 0) endRound(room, 'Props survived the hunt!');
      else if (!propsAlive.length) endRound(room, 'Hunters caught every prop!');
    } else if (room.phase === 'between' && room.timeLeft <= 0) startVote(room);
    broadcast(room);
  }
}, TICK_MS);

function cleanName(name) {
  const n = String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16);
  return n || 'Player';
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0)); }

server.listen(PORT, () => console.log(`Dropz Prop Hunt running on ${PORT}`));
