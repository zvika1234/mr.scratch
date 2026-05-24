// Game state machine: lobby -> drawing -> voting -> impostor_guess -> round_results -> (drawing | match_end)
//
// All authoritative state lives on the server. Clients are dumb renderers that
// receive events and emit user intent.

const { allParticipants, publicSnapshot, deleteRoom, purgePlayer } = require('./rooms');
const { pickCategory, pickWord, pickWrongWord, CATEGORIES } = require('./words');
const { botDraw, botPickVote } = require('./bots');

const TURN_MS = 10_000;        // 10 seconds per drawing turn (spec)
const TURN_ANNOUNCE_MS = 1_800; // overlay shown before the turn timer starts
const BOT_TURN_LEAD_MS = 2_000; // 2 second "thinking" delay before bot starts
const VOTE_MS = 30_000;         // 30 seconds to cast a vote before auto-vote fires
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

// Fisher–Yates shuffle (in-place, but we copy first). Used so the turn order
// is randomized each impostor cycle — no one always draws first.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  // Randomized turn order: shuffle so no one always goes first across cycles.
  // Each player draws once per round; 3 rounds (totalRounds=3) = 3 draws each.
  room.turnOrder = shuffle(everyone.map((p) => p.id));

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

  // Step 1 — Announce phase. Clients darken the screen and show "X's turn"
  // for ~1.8s. No drawing yet, no timer yet.
  emitRoom(room, 'turn:announce', {
    playerId: currentPlayerId,
    playerName: participant.name,
    playerAvatar: participant.avatar || '',
    round: room.currentRound,
    totalRounds: room.totalRounds,
    durationMs: TURN_ANNOUNCE_MS,
  });
  broadcastSnapshot(room);

  if (room.turnTimer) clearTimeout(room.turnTimer);
  // Step 2 — After the announcement fades, kick off the real turn.
  room.turnTimer = setTimeout(() => {
    if (room.state !== 'drawing' || room.turnOrder[room.turnIndex] !== currentPlayerId) return;

    room.turnDeadline = Date.now() + TURN_MS;
    emitRoom(room, 'turn:start', {
      playerId: currentPlayerId,
      playerName: participant.name,
      round: room.currentRound,
      totalRounds: room.totalRounds,
      deadline: room.turnDeadline,
      durationMs: TURN_MS,
    });

    // Hard turn cap (server-authoritative).
    room.turnTimer = setTimeout(() => {
      endTurn(room, currentPlayerId);
    }, TURN_MS);

    // If it's a bot's turn, simulate drawing after a short "thinking" delay.
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
  }, TURN_ANNOUNCE_MS);
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
  room.voteDeadline = Date.now() + VOTE_MS;

  emitRoom(room, 'vote:begin', {
    candidates: allParticipants(room).map(({ id, name, avatar, isBot }) => ({ id, name, avatar: avatar || '', isBot })),
    durationMs: VOTE_MS,
    deadline: room.voteDeadline,
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

  // When time runs out, resolve with whatever votes were cast.
  // Players who didn't vote simply abstain — their vote isn't counted.
  if (room.voteTimer) clearTimeout(room.voteTimer);
  room.voteTimer = setTimeout(() => {
    if (room.state !== 'voting') return;
    resolveVotes(room);
  }, VOTE_MS);
}

function castVote(room, voterId, targetId) {
  if (room.state !== 'voting') return;
  if (!(voterId in room.scores)) return;
  if (!(targetId in room.scores)) return;
  room.votes[voterId] = targetId;
  // Build per-candidate counts to show live 👤 pips on the client.
  const counts = {};
  for (const target of Object.values(room.votes)) {
    counts[target] = (counts[target] || 0) + 1;
  }
  emitRoom(room, 'vote:tally', {
    voted: Object.keys(room.votes).length,
    total: allParticipants(room).length,
    counts,
  });

  // All votes in?
  if (Object.keys(room.votes).length >= allParticipants(room).length) {
    resolveVotes(room);
  }
}

// Cast a random vote on behalf of a disconnected player so the room isn't
// blocked waiting on them. Used by the server-side disconnect handler.
function autoVoteFor(room, voterId) {
  if (room.state !== 'voting') return;
  if (voterId in room.votes) return;
  const candidates = allParticipants(room).filter((p) => p.id !== voterId);
  if (candidates.length === 0) return;
  const target = candidates[Math.floor(Math.random() * candidates.length)].id;
  castVote(room, voterId, target);
}

function resolveVotes(room) {
  // Cancel the auto-vote timer — no longer needed.
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
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
  // No votes cast at all → impostor escapes automatically.
  // Tie → impostor wins (pick a non-impostor as accused → impostorCaught = false).
  let accused;
  if (topIds.length === 0) {
    // Abstention round: pick a non-impostor as accused so impostor escapes.
    const fallback = allParticipants(room).find((p) => p.id !== room.impostorId);
    accused = fallback ? fallback.id : room.impostorId;
  } else if (topIds.length > 1) {
    accused = topIds.find((id) => id !== room.impostorId) || topIds[0];
  } else {
    accused = topIds[0];
  }

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

  // Snapshot the impostor id at the time the timer is set, so a delayed callback
  // can never accidentally submit on behalf of NEXT round's impostor.
  const lockedImpostorId = room.impostorId;

  if (impostor && impostor.isBot) {
    // Bot impostor "guesses" wrong (random other word in same category and lang).
    // Tracked on the room so it can be cancelled if state changes between rounds.
    room.impostorGuessTimer = setTimeout(() => {
      if (room.state !== 'impostor_guess') return;
      if (room.impostorId !== lockedImpostorId) return;
      const wrong = pickWrongWord(room.categoryKey, room.lang, room.word);
      submitImpostorGuess(room, lockedImpostorId, wrong);
    }, 1500 + Math.random() * 2000);
  } else {
    // Auto-resolve if the human impostor doesn't submit in time.
    room.impostorGuessTimer = setTimeout(() => {
      if (room.state !== 'impostor_guess') return;
      if (room.impostorId !== lockedImpostorId) return;
      submitImpostorGuess(room, lockedImpostorId, '');
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
  room.impostorGuessCorrect = isCloseGuess(room.impostorGuess, room.word);

  applyScoring(room);
  emitRoundResults(room);
}

function normalizeWord(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')                       // split combining marks
    .replace(/[̀-ͯ]/g, '')        // strip Latin accents
    .replace(/[֑-ׇ]/g, '')        // strip Hebrew niqqud & cantillation
    .replace(/[^\p{L}\p{N}]+/gu, '')        // keep only letters/numbers
    .trim();
}

// Fuzzy match: accept the guess if it's within a small edit-distance
// of the secret word. We use Damerau-Levenshtein so an adjacent-character
// swap (e.g. "loin" vs "lion") counts as a single typo.
function isCloseGuess(guess, word) {
  const a = normalizeWord(guess);
  const b = normalizeWord(word);
  if (!a || !b) return false;
  if (a === b) return true;

  // Compound-word containment: "icecream" ↔ "ice cream" survives normalize,
  // but very short prefixes shouldn't auto-pass — require >= 5 chars of overlap.
  if (a.length >= 5 && b.includes(a)) return true;
  if (b.length >= 5 && a.includes(b)) return true;

  const distance = damerauLevenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  // Scale: 1 typo for 1–4 chars, 2 typos for 5–8, 3 typos for 9+.
  const threshold = maxLen <= 4 ? 1 : maxLen <= 8 ? 2 : 3;
  return distance <= threshold;
}

// Damerau-Levenshtein distance: like Levenshtein but treats adjacent
// transpositions ("ab" <-> "ba") as a single edit. Word lengths in this
// game stay small, so the O(m*n) table is fine.
function damerauLevenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array(n + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,          // deletion
        dp[i][j - 1] + 1,          // insertion
        dp[i - 1][j - 1] + cost    // substitution
      );
      // Transposition of two adjacent characters.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
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
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
  if (room.impostorGuessTimer) { clearTimeout(room.impostorGuessTimer); room.impostorGuessTimer = null; }
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
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
  if (room.impostorGuessTimer) { clearTimeout(room.impostorGuessTimer); room.impostorGuessTimer = null; }
  for (const id of Object.keys(room.scores)) room.scores[id] = 0;
  room.state = 'lobby';
  broadcastSnapshot(room);
  emitRoom(room, 'match:reset', {});
}

// ---------- Kick player (host only, any phase) ----------

function kickPlayer(room, hostSocketId, targetId) {
  // Only the host may kick.
  if (room.hostId !== hostSocketId) return { error: 'not_host' };
  // Target must be a human player (bots are removed via lobby:removeBot).
  const player = room.players.find((p) => p.id === targetId);
  if (!player) return { error: 'player_not_found' };
  // Host can't kick themselves.
  if (targetId === room.hostId) return { error: 'cant_kick_self' };

  const state = room.state;

  // Capture turn position BEFORE purge so we can fix the index afterward.
  const removedTurnIdx = room.turnOrder.indexOf(targetId);
  const isTheirTurn = state === 'drawing' && room.turnOrder[room.turnIndex] === targetId;

  // Voting cleanup: remove vote they cast and any votes cast FOR them.
  if (state === 'voting') {
    delete room.votes[targetId];
    for (const voter of Object.keys(room.votes)) {
      if (room.votes[voter] === targetId) delete room.votes[voter];
    }
  }

  // Notify the kicked socket before we purge the id reference.
  if (io) io.to(targetId).emit('you:kicked', {});

  // Remove player (handles players[], scores{}, turnOrder[]).
  purgePlayer(room, targetId);

  // Drawing-phase disruption handling.
  if (state === 'drawing') {
    if (isTheirTurn) {
      // Active drawer was kicked — cancel their timer and move to next turn.
      if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
      emitRoom(room, 'turn:end', {});
      broadcastSnapshot(room);
      setTimeout(() => startNextTurn(room), 400);
      return { ok: true };
    } else if (removedTurnIdx !== -1 && removedTurnIdx < room.turnIndex) {
      // Removed player was before the current slot — shift index back so the
      // current drawer's position still lines up correctly.
      room.turnIndex = Math.max(0, room.turnIndex - 1);
    }
  }

  broadcastSnapshot(room);

  // Voting: check if the remaining players have all voted now.
  if (state === 'voting') {
    const total = allParticipants(room).length;
    const voted = Object.keys(room.votes).length;
    if (total > 0 && voted >= total) {
      resolveVotes(room);
    } else {
      // Refresh the live tally with updated participant count.
      const counts = {};
      for (const target of Object.values(room.votes)) {
        counts[target] = (counts[target] || 0) + 1;
      }
      emitRoom(room, 'vote:tally', { voted, total, counts });
    }
  }

  return { ok: true };
}

module.exports = {
  init,
  startGame,
  handleStroke,
  handleStrokeEnd,
  castVote,
  autoVoteFor,
  submitImpostorGuess,
  kickPlayer,
  nextRound,
  newMatch,
  broadcastSnapshot,
  TURN_MS,
};
