// In-memory room store. No DB — rooms vanish when the process restarts.

const { customAlphabet } = require('nanoid');

// 4-char uppercase room codes, alphanumeric minus easily-confused chars.
const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

const rooms = new Map();

function createRoom(hostSocketId, hostName, lang) {
  let code;
  // Defensive: avoid the (astronomically unlikely) chance of code collision.
  do {
    code = generateCode();
  } while (rooms.has(code));

  const host = {
    id: hostSocketId,
    name: hostName,
    isBot: false,
    isHost: true,
    connected: true,
  };

  const room = {
    code,
    hostId: hostSocketId,
    players: [host],
    bots: [],
    lang: lang === 'he' ? 'he' : 'en',
    category: 'random',
    state: 'lobby',
    scores: { [hostSocketId]: 0 },

    // Game runtime fields (populated on game:start):
    impostorId: null,
    categoryKey: null,
    word: null,
    turnOrder: [],
    turnIndex: 0,
    currentRound: 0,
    totalRounds: 3,
    turnDeadline: null,
    turnTimer: null,
    canvasOps: [], // recorded strokes for late joins / state replay (optional)
    votes: {}, // playerId -> targetId
    impostorGuess: null,
    impostorGuessTimer: null,
  };

  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  // Clear any active timers so they don't fire on a dead room.
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.impostorGuessTimer) clearTimeout(room.impostorGuessTimer);
  rooms.delete(code);
}

function findRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

function addPlayer(room, socketId, name) {
  if (room.players.length + room.bots.length >= 5) return { error: 'room_full' };
  if (room.state !== 'lobby') return { error: 'game_in_progress' };
  const player = {
    id: socketId,
    name: name || 'Player',
    isBot: false,
    isHost: false,
    connected: true,
  };
  room.players.push(player);
  room.scores[socketId] = 0;
  return { player };
}

function addBot(room) {
  if (room.players.length + room.bots.length >= 5) return null;
  if (room.state !== 'lobby') return null;
  const botNumber = room.bots.length + 1;
  const bot = {
    id: `bot-${room.code}-${botNumber}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Bot ${botNumber}`,
    isBot: true,
    isHost: false,
    connected: true,
  };
  room.bots.push(bot);
  room.scores[bot.id] = 0;
  return bot;
}

function removeBot(room, botId) {
  const idx = room.bots.findIndex((b) => b.id === botId);
  if (idx === -1) return false;
  room.bots.splice(idx, 1);
  delete room.scores[botId];
  return true;
}

function removePlayer(room, socketId) {
  const idx = room.players.findIndex((p) => p.id === socketId);
  if (idx === -1) return false;
  room.players.splice(idx, 1);
  // Don't delete the score in case we want to display final results.
  // Reassign host if the host left.
  if (room.hostId === socketId && room.players.length > 0) {
    room.hostId = room.players[0].id;
    room.players[0].isHost = true;
  }
  return true;
}

function allParticipants(room) {
  // Players + bots, in a stable order: humans first then bots.
  return [...room.players, ...room.bots];
}

function publicSnapshot(room) {
  // The shape sent to clients. Never includes the secret word or impostor id
  // (those are sent only via the private role:assigned message).
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ id, name, isHost, connected }) => ({
      id,
      name,
      isHost,
      isBot: false,
      connected,
    })),
    bots: room.bots.map(({ id, name }) => ({ id, name, isBot: true })),
    lang: room.lang,
    category: room.category,
    state: room.state,
    scores: room.scores,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
  };
}

module.exports = {
  createRoom,
  getRoom,
  deleteRoom,
  findRoomBySocketId,
  addPlayer,
  addBot,
  removeBot,
  removePlayer,
  allParticipants,
  publicSnapshot,
};
