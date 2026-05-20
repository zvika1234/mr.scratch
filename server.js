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

  socket.on('room:create', ({ name, lang, clientId }, cb) => {
    const safeName = sanitizeName(name);
    const room = rooms.createRoom(socket.id, safeName, lang, clientId);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = clientId;
    cb && cb({ ok: true, code: room.code, you: socket.id, snapshot: rooms.publicSnapshot(room) });
    game.broadcastSnapshot(room);
  });

  socket.on('room:join', ({ code, name, clientId }, cb) => {
    const room = rooms.getRoom((code || '').toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'room_not_found' });
    const safeName = sanitizeName(name);
    const result = rooms.addPlayer(room, socket.id, safeName, clientId);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = clientId;
    cb && cb({ ok: true, code: room.code, you: socket.id, snapshot: rooms.publicSnapshot(room) });
    game.broadcastSnapshot(room);
  });

  // Reconnect: client comes back with the same clientId and the room code
  // it was last in. If the player still exists in the room (within the 60s
  // grace window), restore them to active state — same role, same score.
  socket.on('room:reconnect', ({ code, clientId }, cb) => {
    if (!code || !clientId) return cb && cb({ ok: false, error: 'bad_payload' });
    const room = rooms.getRoom(String(code).toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'room_not_found' });
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return cb && cb({ ok: false, error: 'player_not_found' });

    // Cancel any pending purge timer.
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    // Migrate every reference from the old socket id to the new one.
    const oldId = player.id;
    rooms.replaceSocketId(room, oldId, socket.id);
    player.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = clientId;

    // Build a full resume payload so the client can jump straight back in.
    const resume = {
      ok: true,
      code: room.code,
      you: socket.id,
      snapshot: rooms.publicSnapshot(room),
      state: room.state,
      canvasOps: room.canvasOps || [],
    };
    // If the game has started, send their role + (word, if not impostor).
    if (room.state !== 'lobby' && room.impostorId) {
      const isImpostor = room.impostorId === socket.id;
      resume.role = {
        role: isImpostor ? 'impostor' : 'player',
        category: room.categoryKey,
        word: isImpostor ? null : room.word,
      };
      // Current turn info, if drawing.
      if (room.state === 'drawing' && room.turnDeadline) {
        const currentTurnId = room.turnOrder[room.turnIndex];
        const turnPlayer = rooms.allParticipants(room).find((p) => p.id === currentTurnId);
        resume.turn = {
          playerId: currentTurnId,
          playerName: turnPlayer ? turnPlayer.name : '',
          round: room.currentRound,
          totalRounds: room.totalRounds,
          deadline: room.turnDeadline,
          durationMs: Math.max(0, room.turnDeadline - Date.now()),
        };
      }
    }

    cb && cb(resume);
    game.broadcastSnapshot(room);
  });

  socket.on('room:leave', () => {
    // Explicit leave — purge immediately, no grace period.
    handleLeave(socket);
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

const RECONNECT_GRACE_MS = 60_000;

// Soft disconnect: keep the player slot alive for 60s so a returning client
// (same clientId) can resume. Only purge if they never come back.
function handleDisconnect(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.getRoom(code);
  if (!room) return;

  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  player.connected = false;

  // If they were the active drawer, end their turn so the game keeps moving.
  if (room.state === 'drawing' && room.turnOrder[room.turnIndex] === socket.id) {
    game.handleStrokeEnd(room, socket.id);
  }
  // If they're a voter mid-vote and haven't voted yet, auto-cast a random vote
  // so the room isn't blocked waiting on them.
  if (room.state === 'voting' && !(socket.id in room.votes)) {
    game.autoVoteFor(room, socket.id);
  }
  // If they're the impostor mid-guess, submit an empty guess.
  if (room.state === 'impostor_guess' && room.impostorId === socket.id) {
    game.submitImpostorGuess(room, socket.id, '');
  }

  // Schedule purge after grace window.
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = setTimeout(() => {
    const current = rooms.getRoom(code);
    if (!current) return;
    const stillThere = current.players.find((p) => p.id === socket.id || p.clientId === player.clientId);
    if (stillThere && stillThere.connected) return; // they came back
    rooms.purgePlayer(current, stillThere ? stillThere.id : socket.id);
    if (current.players.length === 0) {
      rooms.deleteRoom(current.code);
      return;
    }
    game.broadcastSnapshot(current);
  }, RECONNECT_GRACE_MS);

  game.broadcastSnapshot(room);
}

// Hard leave (user clicked Home / "leave room"). Purge immediately.
function handleLeave(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.getRoom(code);
  if (!room) return;

  const player = room.players.find((p) => p.id === socket.id);
  if (player && player.disconnectTimer) clearTimeout(player.disconnectTimer);

  // Same in-progress cleanup as a soft disconnect.
  if (room.state === 'drawing' && room.turnOrder[room.turnIndex] === socket.id) {
    game.handleStrokeEnd(room, socket.id);
  }
  if (room.state === 'voting' && !(socket.id in room.votes)) {
    game.autoVoteFor(room, socket.id);
  }
  if (room.state === 'impostor_guess' && room.impostorId === socket.id) {
    game.submitImpostorGuess(room, socket.id, '');
  }

  rooms.purgePlayer(room, socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    rooms.deleteRoom(room.code);
    return;
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
