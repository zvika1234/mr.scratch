// In-memory room store. No DB — rooms vanish when the process restarts.

const { customAlphabet } = require('nanoid');

// 4-char uppercase room codes, alphanumeric minus easily-confused chars.
const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

// Each player/bot gets a unique animal avatar from this pool (max 5 players).
const PLAYER_ANIMALS = ['🦊', '🐸', '🦌', '🦢', '🐋'];

function pickAvatar(room) {
  const used = new Set([...room.players, ...room.bots].map((p) => p.avatar));
  const available = PLAYER_ANIMALS.filter((a) => !used.has(a));
  if (!available.length) return '🎮'; // fallback (should never happen)
  return available[Math.floor(Math.random() * available.length)];
}

const rooms = new Map();

function createRoom(hostSocketId, hostName, lang, clientId, isPublic) {
  let code;
  // Defensive: avoid the (astronomically unlikely) chance of code collision.
  do {
    code = generateCode();
  } while (rooms.has(code));

  // Room must exist before pickAvatar can filter used avatars.
  const room = {
    code,
    hostId: hostSocketId,
    players: [],
    bots: [],
    lang: lang === 'he' ? 'he' : 'en',
    category: 'random',
    state: 'lobby',
    isPublic: isPublic === true,
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
    voteTimer: null,
    voteDeadline: null,
    impostorGuess: null,
    impostorGuessTimer: null,
  };

  const host = {
    id: hostSocketId,
    clientId: clientId || hostSocketId, // stable identity across reconnects
    name: hostName,
    avatar: pickAvatar(room),
    isBot: false,
    isHost: true,
    connected: true,
    disconnectTimer: null,
  };

  room.players.push(host);
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
  if (room.voteTimer) clearTimeout(room.voteTimer);
  if (room.impostorGuessTimer) clearTimeout(room.impostorGuessTimer);
  rooms.delete(code);
}

function findRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

function addPlayer(room, socketId, name, clientId) {
  if (room.players.length + room.bots.length >= 5) return { error: 'room_full' };
  if (room.state !== 'lobby') return { error: 'game_in_progress' };
  const player = {
    id: socketId,
    clientId: clientId || socketId,
    name: name || 'Player',
    avatar: pickAvatar(room),
    isBot: false,
    isHost: false,
    connected: true,
    disconnectTimer: null,
  };
  room.players.push(player);
  room.scores[socketId] = 0;
  return { player };
}

// Replace a player's socket id (used on reconnect). Migrates every reference:
// scores, turnOrder, impostorId, hostId, votes (keys + values), accusedId.
// Avatar is stored on the player object itself, so it persists automatically.
function replaceSocketId(room, oldId, newId) {
  if (oldId === newId) return;
  const player = room.players.find((p) => p.id === oldId);
  if (player) player.id = newId;
  if (room.hostId === oldId) room.hostId = newId;
  if (room.impostorId === oldId) room.impostorId = newId;
  if (room.accusedId === oldId) room.accusedId = newId;
  if (oldId in room.scores) {
    room.scores[newId] = room.scores[oldId];
    delete room.scores[oldId];
  }
  for (let i = 0; i < room.turnOrder.length; i++) {
    if (room.turnOrder[i] === oldId) room.turnOrder[i] = newId;
  }
  // Votes: keys are voter ids, values are target ids.
  if (room.votes && typeof room.votes === 'object') {
    const newVotes = {};
    for (const [voter, target] of Object.entries(room.votes)) {
      const k = voter === oldId ? newId : voter;
      const v = target === oldId ? newId : target;
      newVotes[k] = v;
    }
    room.votes = newVotes;
  }
  // Vote counts: keys are target player ids.
  if (room.voteCounts && typeof room.voteCounts === 'object') {
    const newCounts = {};
    for (const [target, count] of Object.entries(room.voteCounts)) {
      newCounts[target === oldId ? newId : target] = count;
    }
    room.voteCounts = newCounts;
  }
}

// Permanently remove a player and all their references (after disconnect timer expires).
function purgePlayer(room, socketId) {
  const idx = room.players.findIndex((p) => p.id === socketId);
  if (idx === -1) return false;
  room.players.splice(idx, 1);
  delete room.scores[socketId];
  // Remove from turnOrder so they don't get a turn.
  room.turnOrder = room.turnOrder.filter((id) => id !== socketId);
  if (room.hostId === socketId && room.players.length > 0) {
    room.hostId = room.players[0].id;
    room.players[0].isHost = true;
  }
  return true;
}

function addBot(room) {
  if (room.players.length + room.bots.length >= 5) return null;
  if (room.state !== 'lobby') return null;
  const botNumber = room.bots.length + 1;
  const bot = {
    id: `bot-${room.code}-${botNumber}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Bot ${botNumber}`,
    avatar: pickAvatar(room),
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
    players: room.players.map(({ id, name, avatar, isHost, connected }) => ({
      id,
      name,
      avatar,
      isHost,
      isBot: false,
      connected,
    })),
    bots: room.bots.map(({ id, name, avatar }) => ({ id, name, avatar, isBot: true })),
    lang: room.lang,
    category: room.category,
    state: room.state,
    scores: room.scores,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
  };
}

// Returns a safe summary of every public room currently in the lobby state.
// Used by the home-screen browser — never leaks word / impostorId.
function getPublicLobbies() {
  return [...rooms.values()]
    .filter((r) => r.isPublic && r.state === 'lobby')
    .map((r) => {
      const host = r.players.find((p) => p.isHost);
      return {
        code: r.code,
        hostName: host ? host.name : '?',
        hostAvatar: host ? (host.avatar || '') : '',
        playerCount: r.players.length + r.bots.length,
        maxPlayers: 5,
        category: r.category,
        lang: r.lang,
      };
    });
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
  replaceSocketId,
  purgePlayer,
  allParticipants,
  publicSnapshot,
  getPublicLobbies,
};
