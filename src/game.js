// Game state machine: lobby -> drawing -> voting -> impostor_guess -> round_results -> (drawing | match_end)
//
// All authoritative state lives on the server. Clients are dumb renderers that
// receive events and emit user intent.

const { allParticipants, publicSnapshot, deleteRoom } = require('./rooms');
const { pickCategory, pickWord, pickWrongWord, CATEGORIES } = require('./words');
const { botDraw, botPickVote } = require('./bots');

const TURN_MS = 10_000;        // 10 seconds per drawing turn (spec)
const BOT_TURN_LEAD_MS = 2_000; // 2 second "thinking" delay before bot starts
const IMPOSTOR_GUESS_MS = 15_000;
const WIN_SCORE = 6;

// `io` is the Socket.io server instance, captured once on init.
let io = null;
function init(socketIoServer) {
  io = socketIoServer;
}

function emitRoom(room, event, payload) {
  if (!io) return;
  io.to(room.code).emit(event, payload);
}

function broadcastSnapshot(room) {
  emitRoom(room, 'room:update', publicSnapshot(room));
}

// ---------- Game start ----------

function startGame(room) {
  const everyone = allParticipants(room);
  if (everyone.length < 3) return { error: 'need_three_players' };
  if (room.state !== 'lobby') return { error: 'already_started' };

  room.categoryKey = pickCategory(room.category);
  room.word = pickWord(room.categoryKey, room.lang);

  // Pick impostor at random from everyone (bots may be impostors).
  room.impostorId = everyone[Math.floor(Math.random() * everyone.length)].id;

  // Reset round/turn tracking.
  room.currentRound = 1;
  room.turnIndex = 0;
  room.canvasOps = [];
  room.votes = {};
  room.impostorGuess = null;

  // Stable turn order: humans-then-bots. Each player draws once per round;
  // total of 3 rounds (totalRounds=3) means each player draws 3 times.
  room.turnOrder = everyone.map((p) => p.id);

  room.state = 'drawing';

  // Send private role assignments. Word is only sent to non-impostors.
  for (const player of room.players) {
    const isImpostor = player.id === room.impostorId;
    io.to(player.id).emit('role:assigned', {
      role: isImpostor ? 'impostor' : 'player',
      category: room.categoryKey,
      word: isImpostor ? null : room.word,
    });
  }
  // (Bots get nothing — they don't have sockets.)

  broadcastSnapshot(room);
  startNextTurn(room);
  return { ok: true };
}

// ---------- Drawing turns ----------

function startNextTurn(room) {
  if (room.state !== 'drawing') return;

  // Did we finish the current round?
  if (room.turnIndex >= room.turnOrder.length) {
    room.currentRound += 1;
    room.turnIndex = 0;
    // Did we finish all rounds?
    if (room.currentRound > room.totalRounds) {
      enterVoting(room);
      return;
    }
  }

  const currentPlayerId = room.turnOrder[room.turnIndex];
  const participant = allParticipants(room).find((p) => p.id === currentPlayerId);

  // Skip disconnected humans (their slot is still in turnOrder but they can't draw).
  if (!participant || (!participant.isBot && participant.connected === false)) {
    room.turnIndex += 1;
    startNextTurn(room);
    return;
  }

  room.turnDeadline = Date.now() + TURN_MS;
  emitRoom(room, 'turn:start', {
    playerId: currentPlayerId,
    playerName: participant.name,
    round: room.currentRound,
    totalRounds: room.totalRounds,
    deadline: room.turnDeadline,
    durationMs: TURN_MS,
  });
  broadcastSnapshot(room);

  // Hard turn cap (server-authoritative).
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    endTurn(room, currentPlayerId);
  }, TURN_MS);

  // If it's a bot's turn, simulate drawing.
  if (participant.isBot) {
    setTimeout(() => {
      // Guard: room/turn might have ended already.
      if (room.state !== 'drawing' || room.turnOrder[room.turnIndex] !== currentPlayerId) return;
      botDraw(
        (stroke) => {
          if (room.state !== 'drawing' || room.turnOrder[room.turnIndex] !== currentPlayerId) return;
          const enriched = { ...stroke, playerId: currentPlayerId };
          room.canvasOps.push(enriched);
          emitRoom(room, 'draw:stroke', enriched);
        },
        () => {
          if (room.state !== 'drawing' || room.turnOrder[room.turnIndex] !== currentPlayerId) return;
          endTurn(room, currentPlayerId);
        }
      );
    }, BOT_TURN_LEAD_MS);
  }
}

function endTurn(room, expectedPlayerId) {
  if (room.state !== 'drawing') return;
  if (expectedPlayerId && room.turnOrder[room.turnIndex] !== expectedPlayerId) return;
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnIndex += 1;
  emitRoom(room, 'turn:end', {});
  // Small breather so clients can show "turn ended" UI before next turn starts.
  setTimeout(() => startNextTurn(room), 400);
}

function handleStroke(room, playerId, stroke) {
  // Anti-cheat: only the active drawer may emit strokes.
  if (room.state !== 'drawing') return;
  if (room.turnOrder[room.turnIndex] !== playerId) return;

  const enriched = {
    points: Array.isArray(stroke.points) ? stroke.points.slice(0, 200) : [],
    color: typeof stroke.color === 'string' ? stroke.color.slice(0, 16) : '#222',
    width: Number.isFinite(stroke.width) ? Math.min(20, Math.max(1, stroke.width)) : 3,
    playerId,
  };
  if (enriched.points.length === 0) return;

  room.canvasOps.push(enriched);
  // Broadcast to everyone in the room (including drawer — they'll dedupe locally).
  emitRoom(room, 'draw:stroke', enriched);
}

function handleStrokeEnd(room, playerId) {
  // Drawer lifted finger — end turn early per spec ("short sketch constraint").
  if (room.state !== 'drawing') return;
  if (room.turnOrder[room.turnIndex] !== playerId) return;
  endTurn(room, playerId);
}

// ---------- Voting ----------

function enterVoting(room) {
  room.state = 'voting';
  room.votes = {};
  emitRoom(room, 'vote:begin', {
    candidates: allParticipants(room).map(({ id, name, isBot }) => ({ id, name, isBot })),
  });
  broadcastSnapshot(room);

  // Bots vote after a small delay.
  for (const bot of room.bots) {
    setTimeout(() => {
      if (room.state !== 'voting') return;
      const target = botPickVote(bot, allParticipants(room));
      if (target) castVote(room, bot.id, target);
    }, 1500 + Math.random() * 1500);
  }
}

function castVote(room, voterId, targetId) {
  if (room.state !== 'voting') return;
  if (!(voterId in room.scores)) return;
  if (!(targetId in room.scores)) return;
  room.votes[voterId] = targetId;
  emitRoom(room, 'vote:tally', { voted: Object.keys(room.votes).length, total: allParticipants(room).length });

  // All votes in?
  if (Object.keys(room.votes).length >= allParticipants(room).length) {
    resolveVotes(room);
  }
}

function resolveVotes(room) {
  const counts = {};
  for (const target of Object.values(room.votes)) {
    counts[target] = (counts[target] || 0) + 1;
  }
  // Highest vote count wins; ties broken randomly.
  let maxVotes = 0;
  let topIds = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > maxVotes) {
      maxVotes = n;
      topIds = [id];
    } else if (n === maxVotes) {
      topIds.push(id);
    }
  }
  const accused = topIds[Math.floor(Math.random() * topIds.length)];

  room.voteCounts = counts;
  room.accusedId = accused;
  room.impostorCaught = accused === room.impostorId;

  emitRoom(room, 'vote:complete', {
    counts,
    votes: room.votes,
    accusedId: accused,
  });

  enterImpostorGuess(room);
}

// ---------- Impostor word guess ----------

function enterImpostorGuess(room) {
  room.state = 'impostor_guess';
  const impostor = allParticipants(room).find((p) => p.id === room.impostorId);

  // Impostor (human or bot) always gets a chance.
  emitRoom(room, 'guess:begin', {
    impostorId: room.impostorId,
    impostorName: impostor ? impostor.name : 'Impostor',
    durationMs: IMPOSTOR_GUESS_MS,
    deadline: Date.now() + IMPOSTOR_GUESS_MS,
  });

  if (impostor && impostor.isBot) {
    // Bot impostor "guesses" wrong (random other word in same category and lang).
    setTimeout(() => {
      if (room.state !== 'impostor_guess') return;
      const wrong = pickWrongWord(room.categoryKey, room.lang, room.word);
      submitImpostorGuess(room, room.impostorId, wrong);
    }, 1500 + Math.random() * 2000);
  } else {
    // Auto-resolve if the human impostor doesn't submit in time.
    room.impostorGuessTimer = setTimeout(() => {
      if (room.state !== 'impostor_guess') return;
      submitImpostorGuess(room, room.impostorId, '');
    }, IMPOSTOR_GUESS_MS);
  }
}

function submitImpostorGuess(room, playerId, guess) {
  if (room.state !== 'impostor_guess') return;
  if (playerId !== room.impostorId) return;
  if (room.impostorGuess !== null) return; // already submitted

  if (room.impostorGuessTimer) {
    clearTimeout(room.impostorGuessTimer);
    room.impostorGuessTimer = null;
  }

  room.impostorGuess = (guess || '').trim();
  const correct = normalizeWord(room.impostorGuess) === normalizeWord(room.word);
  room.impostorGuessCorrect = correct;

  applyScoring(room);
  emitRoundResults(room);
}

function normalizeWord(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .normalize('NFC')
    .trim();
}

// ---------- Scoring ----------

function applyScoring(room) {
  // Impostor hid (not caught) -> +3 impostor.
  // Impostor caught -> +1 each non-impostor.
  // Impostor guessed word correctly -> +1 impostor (independent).
  if (room.impostorCaught) {
    for (const p of allParticipants(room)) {
      if (p.id !== room.impostorId) {
        room.scores[p.id] = (room.scores[p.id] || 0) + 1;
      }
    }
  } else {
    room.scores[room.impostorId] = (room.scores[room.impostorId] || 0) + 3;
  }
  if (room.impostorGuessCorrect) {
    room.scores[room.impostorId] = (room.scores[room.impostorId] || 0) + 1;
  }
}

function emitRoundResults(room) {
  // Did anyone hit the win threshold?
  const winnerEntry = Object.entries(room.scores).find(([, s]) => s >= WIN_SCORE);
  if (winnerEntry) {
    room.state = 'match_end';
    emitRoom(room, 'round:result', {
      scores: room.scores,
      impostorId: room.impostorId,
      word: room.word,
      category: room.categoryKey,
      impostorCaught: room.impostorCaught,
      impostorGuess: room.impostorGuess,
      impostorGuessCorrect: room.impostorGuessCorrect,
      voteCounts: room.voteCounts,
      matchOver: true,
      winnerId: winnerEntry[0],
    });
    broadcastSnapshot(room);
    return;
  }

  room.state = 'round_results';
  emitRoom(room, 'round:result', {
    scores: room.scores,
    impostorId: room.impostorId,
    word: room.word,
    category: room.categoryKey,
    impostorCaught: room.impostorCaught,
    impostorGuess: room.impostorGuess,
    impostorGuessCorrect: room.impostorGuessCorrect,
    voteCounts: room.voteCounts,
    matchOver: false,
  });
  broadcastSnapshot(room);
}

// ---------- Next round / new match ----------

function nextRound(room) {
  if (room.state !== 'round_results') return;
  // Reset per-round state but preserve scores.
  room.impostorId = null;
  room.categoryKey = null;
  room.word = null;
  room.turnOrder = [];
  room.turnIndex = 0;
  room.currentRound = 0;
  room.canvasOps = [];
  room.votes = {};
  room.voteCounts = null;
  room.accusedId = null;
  room.impostorCaught = false;
  room.impostorGuess = null;
  room.impostorGuessCorrect = false;
  room.state = 'lobby'; // briefly, before startGame flips it
  startGame(room);
}

function newMatch(room) {
  if (room.state !== 'match_end' && room.state !== 'round_results') return;
  for (const id of Object.keys(room.scores)) room.scores[id] = 0;
  room.state = 'lobby';
  broadcastSnapshot(room);
  emitRoom(room, 'match:reset', {});
}

module.exports = {
  init,
  startGame,
  handleStroke,
  handleStrokeEnd,
  castVote,
  submitImpostorGuess,
  nextRound,
  newMatch,
  broadcastSnapshot,
  TURN_MS,
};
