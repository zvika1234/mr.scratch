// Mr.Scratch — server entry point.
// Serves the static frontend and runs the Socket.io game server.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');

const rooms = require('./src/rooms');
const game = require('./src/game');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }, // local dev; tighten in production
});

game.init(io);

// Helpers --------------------------------------------------------------------

function isHost(room, socketId) {
  return room && room.hostId === socketId;
}

function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.getRoom(code);
}

// Socket handlers ------------------------------------------------------------

io.on('connection', (socket) => {
  // --- Room create / join ---

  socket.on('room:create', ({ name, lang }, cb) => {
    const safeName = sanitizeName(name);
    const room = rooms.createRoom(socket.id, safeName, lang);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, code: room.code, you: socket.id, snapshot: rooms.publicSnapshot(room) });
    game.broadcastSnapshot(room);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    const room = rooms.getRoom((code || '').toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'room_not_found' });
    const safeName = sanitizeName(name);
    const result = rooms.addPlayer(room, socket.id, safeName);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, code: room.code, you: socket.id, snapshot: rooms.publicSnapshot(room) });
    game.broadcastSnapshot(room);
  });

  socket.on('room:leave', () => {
    handleDisconnect(socket);
  });

  // --- Lobby controls (host only) ---

  socket.on('lobby:addBot', () => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    rooms.addBot(room);
    game.broadcastSnapshot(room);
  });

  socket.on('lobby:removeBot', ({ botId }) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    if (rooms.removeBot(room, botId)) game.broadcastSnapshot(room);
  });

  socket.on('lobby:setCategory', ({ category }) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    if (room.state !== 'lobby') return;
    const allowed = ['random', 'food', 'animals', 'transportation', 'clothing', 'fitness'];
    if (!allowed.includes(category)) return;
    room.category = category;
    game.broadcastSnapshot(room);
  });

  socket.on('lobby:setLang', ({ lang }) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    if (room.state !== 'lobby') return;
    room.lang = lang === 'he' ? 'he' : 'en';
    game.broadcastSnapshot(room);
  });

  // --- Game flow ---

  socket.on('game:start', (_, cb) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return cb && cb({ ok: false, error: 'not_host' });
    const r = game.startGame(room);
    cb && cb(r);
  });

  socket.on('draw:stroke', (stroke) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    game.handleStroke(room, socket.id, stroke);
  });

  socket.on('draw:end', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    game.handleStrokeEnd(room, socket.id);
  });

  socket.on('vote:cast', ({ targetId }) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    game.castVote(room, socket.id, targetId);
  });

  socket.on('impostor:guess', ({ guess }) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    game.submitImpostorGuess(room, socket.id, guess);
  });

  socket.on('round:next', () => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    game.nextRound(room);
  });

  socket.on('match:new', () => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(room, socket.id)) return;
    game.newMatch(room);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.getRoom(code);
  if (!room) return;

  // Mark disconnected; if it was the active drawer, end their turn.
  const player = room.players.find((p) => p.id === socket.id);
  if (player) player.connected = false;

  rooms.removePlayer(room, socket.id);
  socket.data.roomCode = null;

  // Empty room: clean up.
  if (room.players.length === 0) {
    rooms.deleteRoom(room.code);
    return;
  }

  // If the disconnected player was currently drawing, advance the turn.
  if (room.state === 'drawing' && room.turnOrder[room.turnIndex] === socket.id) {
    // Force end turn for that player.
    game.handleStrokeEnd(room, socket.id);
  }

  game.broadcastSnapshot(room);
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Player';
  const trimmed = name.trim().slice(0, 20);
  return trimmed || 'Player';
}

server.listen(PORT, () => {
  console.log(`Mr.Scratch listening on http://localhost:${PORT}`);
});
