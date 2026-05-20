// Client controller: socket events, screen routing, dynamic UI rendering.

const socket = io();

// Stable identity across reconnects — generated once, persisted in localStorage.
function getClientId() {
  let id = localStorage.getItem('mrscratch.clientId');
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('mrscratch.clientId', id);
  }
  return id;
}
const CLIENT_ID = getClientId();

function setActiveRoom(code) {
  if (code) localStorage.setItem('mrscratch.activeRoom', code);
  else localStorage.removeItem('mrscratch.activeRoom');
}
function getActiveRoom() {
  return localStorage.getItem('mrscratch.activeRoom') || null;
}

const State = {
  myId: null,
  roomCode: null,
  snapshot: null,
  role: null,          // 'impostor' | 'player' | null
  category: null,
  word: null,
  currentTurnPlayerId: null,
  turnDeadline: null,
  guessDeadline: null,
  myVote: null,
  isImpostor: false,
};

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
}

function toast(msg, duration = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), duration);
}

function getMyName() {
  const v = $('#home-name').value.trim();
  if (v) return v;
  const stored = localStorage.getItem('mrscratch.name');
  return stored || '';
}

// Persist name across visits
$('#home-name').addEventListener('input', (e) => {
  localStorage.setItem('mrscratch.name', e.target.value);
});
$('#home-name').value = localStorage.getItem('mrscratch.name') || '';

// ---------- Language toggle ----------
$('#lang-toggle').addEventListener('click', () => {
  const next = getLang() === 'en' ? 'he' : 'en';
  setLang(next);
  // If host, sync room language with server.
  if (State.snapshot && State.snapshot.hostId === State.myId) {
    socket.emit('lobby:setLang', { lang: next });
  }
});

// React to language changes (refresh dynamic UI bits).
document.addEventListener('lang:changed', () => {
  if (State.snapshot) renderLobby();
  if (State.snapshot) renderScoreboard(State.snapshot);
  if (State.role) renderRoleBox();
});

// ---------- Home screen ----------
$('#btn-create').addEventListener('click', () => {
  const name = getMyName();
  if (!name) return toast(t('toast.needName'));
  socket.emit('room:create', { name, lang: getLang(), clientId: CLIENT_ID }, (resp) => {
    if (!resp || !resp.ok) return toast('Could not create room');
    State.myId = resp.you;
    State.roomCode = resp.code;
    State.snapshot = resp.snapshot;
    setActiveRoom(resp.code);
    enterLobby();
  });
});

$('#btn-join').addEventListener('click', () => {
  joinFlow();
});
$('#home-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinFlow();
});

function joinFlow() {
  const name = getMyName();
  const code = $('#home-code').value.trim().toUpperCase();
  if (!name) return toast(t('toast.needName'));
  if (!code) return toast(t('toast.needCode'));
  socket.emit('room:join', { name, code, clientId: CLIENT_ID }, (resp) => {
    if (!resp || !resp.ok) {
      const map = {
        room_not_found: 'toast.roomNotFound',
        room_full: 'toast.roomFull',
        game_in_progress: 'toast.gameInProgress',
      };
      return toast(t(map[resp && resp.error] || 'toast.roomNotFound'));
    }
    State.myId = resp.you;
    State.roomCode = resp.code;
    State.snapshot = resp.snapshot;
    setActiveRoom(resp.code);
    enterLobby();
  });
}

// Auto-fill room code from ?room=XXXX
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
  $('#home-code').value = roomFromUrl.toUpperCase().slice(0, 4);
}

// ---------- Lobby ----------
function enterLobby() {
  showScreen('screen-lobby');
  renderLobby();
}

function renderLobby() {
  if (!State.snapshot) return;
  const snap = State.snapshot;
  $('#lobby-code').textContent = snap.code;

  const list = $('#lobby-players');
  list.innerHTML = '';

  const everyone = [...snap.players, ...snap.bots];
  for (const p of everyone) {
    const li = document.createElement('li');
    if (p.isBot) li.classList.add('is-bot', 'bot-row');
    if (p.connected === false) li.classList.add('disconnected');
    const dot = p.connected === false ? '<span class="dc-dot" title="disconnected">⚠️</span> ' : '';
    li.innerHTML = `<span>${dot}${escapeHtml(p.name)}</span>`;
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('lobby.hostBadge');
      li.appendChild(badge);
    }
    if (p.isBot) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('lobby.botBadge');
      li.appendChild(badge);
      // Host can remove bots
      if (isHost()) {
        const remove = document.createElement('button');
        remove.className = 'remove-bot';
        remove.textContent = '✕';
        remove.title = t('lobby.removeBot');
        remove.style.marginInlineStart = 'auto';
        remove.addEventListener('click', () => {
          socket.emit('lobby:removeBot', { botId: p.id });
        });
        li.appendChild(remove);
      }
    }
    list.appendChild(li);
  }

  const hostCtl = $('#host-controls');
  const waiting = $('#waiting-for-host');
  if (isHost()) {
    hostCtl.hidden = false;
    waiting.hidden = true;
    $('#lobby-category').value = snap.category;
    $('#lobby-lang').value = snap.lang;
    const total = snap.players.length + snap.bots.length;
    $('#btn-start').disabled = total < 3 || total > 5;
  } else {
    hostCtl.hidden = true;
    waiting.hidden = false;
  }
}

function isHost() {
  return State.snapshot && State.snapshot.hostId === State.myId;
}

$('#btn-add-bot').addEventListener('click', () => socket.emit('lobby:addBot'));
$('#lobby-category').addEventListener('change', (e) =>
  socket.emit('lobby:setCategory', { category: e.target.value })
);
$('#lobby-lang').addEventListener('change', (e) => {
  setLang(e.target.value);
  socket.emit('lobby:setLang', { lang: e.target.value });
});
$('#btn-copy-link').addEventListener('click', () => {
  const url = `${window.location.origin}${window.location.pathname}?room=${State.roomCode}`;
  navigator.clipboard.writeText(url).then(() => toast(t('toast.linkCopied')));
});
$('#btn-start').addEventListener('click', () => {
  socket.emit('game:start', {}, (resp) => {
    if (!resp || !resp.ok) {
      if (resp && resp.error === 'need_three_players') toast(t('toast.needThree'));
    }
  });
});

// ---------- Server -> client: room updates ----------
socket.on('room:update', (snap) => {
  State.snapshot = snap;
  if (snap.state === 'lobby') {
    // Only auto-navigate to lobby if we're not already on a more advanced screen
    // (e.g. results), to avoid yanking the user away.
    if (!document.querySelector('#screen-results.active') &&
        !document.querySelector('#screen-vote.active') &&
        !document.querySelector('#screen-guess.active')) {
      showScreen('screen-lobby');
    }
    renderLobby();
  } else {
    // Keep the lobby player list fresh too in case anyone reconnects.
    renderLobby();
  }
  renderScoreboard(snap);
  if (typeof updateHomeButtonVisibility === 'function') updateHomeButtonVisibility();
});

// ---------- Role assigned (game start) ----------
socket.on('role:assigned', ({ role, category, word }) => {
  State.role = role;
  State.category = category;
  State.word = word;
  State.isImpostor = role === 'impostor';
  showScreen('screen-game');
  renderRoleBox();
  Board.clear();
  Board.setHandlers({
    onStroke: (s) => socket.emit('draw:stroke', s),
    onStrokeEnd: () => socket.emit('draw:end'),
  });
});

function renderRoleBox() {
  const isImp = State.isImpostor;
  const box = $('#role-box');
  box.classList.toggle('is-impostor', isImp);
  $('#role-value').textContent = isImp ? t('game.role.impostor') : t('game.role.player');
  // Category translations
  $('#role-category').textContent = State.category ? t(`cat.${State.category}`) : '—';
  // Word row only for non-impostor.
  $('#word-row').hidden = isImp;
  $('#role-word').textContent = State.word || '—';
}

// ---------- Turn flow ----------
socket.on('turn:start', ({ playerId, playerName, round, totalRounds, deadline, durationMs }) => {
  showScreen('screen-game');
  State.currentTurnPlayerId = playerId;
  State.turnDeadline = deadline;
  $('#round-display').textContent = round;
  $('#round-total').textContent = totalRounds;
  const isMyTurn = playerId === State.myId;
  $('#turn-name').textContent = isMyTurn
    ? t('game.yourTurn')
    : t('game.turnOf', { name: playerName });
  Board.setEnabled(isMyTurn);
  startTimerBar('#timer-fill', deadline, durationMs);
});

socket.on('turn:end', () => {
  Board.setEnabled(false);
  stopTimerBar('#timer-fill');
});

// ---------- Stroke broadcast ----------
socket.on('draw:stroke', (stroke) => {
  // We've already rendered our own strokes locally; ignore the echo.
  if (stroke.playerId === State.myId) return;
  Board.renderStroke(stroke);
});

// ---------- Voting ----------
socket.on('vote:begin', ({ candidates }) => {
  showScreen('screen-vote');
  State.myVote = null;
  const list = $('#vote-list');
  list.innerHTML = '';
  $('#vote-status').textContent = '';
  for (const c of candidates) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = c.name + (c.id === State.myId ? ' ' + t('vote.you') : '');
    btn.addEventListener('click', () => {
      if (c.id === State.myId) return; // can't vote for self
      State.myVote = c.id;
      list.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      socket.emit('vote:cast', { targetId: c.id });
    });
    if (c.id === State.myId) btn.disabled = true;
    li.appendChild(btn);
    list.appendChild(li);
  }
});
socket.on('vote:tally', ({ voted, total }) => {
  $('#vote-status').textContent = t('vote.voted', { n: voted, total });
});
socket.on('vote:complete', () => {
  // Server transitions to impostor_guess automatically; we just freeze the UI.
  $$('#vote-list button').forEach((b) => (b.disabled = true));
});

// ---------- Impostor guess ----------
socket.on('guess:begin', ({ impostorId, durationMs, deadline }) => {
  showScreen('screen-guess');
  State.guessDeadline = deadline;
  const iAmImpostor = State.myId === impostorId;
  $('#guess-form').hidden = !iAmImpostor;
  $('#guess-waiting').hidden = iAmImpostor;
  $('#guess-input').value = '';
  if (iAmImpostor) $('#guess-input').focus();
  startTimerBar('#guess-timer-fill', deadline, durationMs);
});

$('#btn-submit-guess').addEventListener('click', submitGuess);
$('#guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitGuess();
});
function submitGuess() {
  const guess = $('#guess-input').value.trim();
  socket.emit('impostor:guess', { guess });
  $('#guess-form').hidden = true;
  $('#guess-waiting').hidden = false;
}

// ---------- Results ----------
socket.on('round:result', (data) => {
  showScreen('screen-results');
  stopTimerBar('#guess-timer-fill');

  const everyone = [...State.snapshot.players, ...State.snapshot.bots];
  const findName = (id) => {
    const p = everyone.find((x) => x.id === id);
    return p ? p.name : '???';
  };

  // Winner banner (match over)
  const banner = $('#winner-banner');
  if (data.matchOver && data.winnerId) {
    banner.hidden = false;
    banner.textContent = '🏆 ' + t('results.winner', { name: findName(data.winnerId) });
  } else {
    banner.hidden = true;
  }

  $('#results-title').textContent = data.matchOver ? t('results.matchTitle') : t('results.title');
  $('#result-impostor').textContent =
    `${findName(data.impostorId)} — ${data.impostorCaught ? t('results.caught') : t('results.escaped')}`;
  $('#result-word').textContent = data.word;
  if (data.impostorGuess && data.impostorGuess.length > 0) {
    $('#result-guess-line').hidden = false;
    const guessEl = $('#result-guess');
    guessEl.textContent =
      `"${data.impostorGuess}" — ${data.impostorGuessCorrect ? t('results.guessCorrect') : t('results.guessWrong')}`;
    guessEl.className = data.impostorGuessCorrect ? 'good' : '';
  } else {
    $('#result-guess-line').hidden = true;
  }

  const ul = $('#result-scores');
  ul.innerHTML = '';
  const sorted = Object.entries(data.scores).sort((a, b) => b[1] - a[1]);
  for (const [id, score] of sorted) {
    const li = document.createElement('li');
    if (id === State.myId) li.classList.add('me');
    li.innerHTML = `<span>${escapeHtml(findName(id))}</span><span class="score">${score}</span>`;
    ul.appendChild(li);
  }

  // Host action buttons
  const nextBtn = $('#btn-next-round');
  const newBtn = $('#btn-new-match');
  nextBtn.hidden = true;
  newBtn.hidden = true;
  if (isHost()) {
    if (data.matchOver) {
      newBtn.hidden = false;
    } else {
      nextBtn.hidden = false;
    }
  }
});

$('#btn-next-round').addEventListener('click', () => socket.emit('round:next'));
$('#btn-new-match').addEventListener('click', () => socket.emit('match:new'));

socket.on('match:reset', () => {
  showScreen('screen-lobby');
});

// ---------- Scoreboard (during game) ----------
function renderScoreboard(snap) {
  const ul = $('#scoreboard');
  if (!ul) return;
  ul.innerHTML = '';
  const everyone = [...snap.players, ...snap.bots];
  for (const p of everyone) {
    const li = document.createElement('li');
    if (p.id === State.myId) li.classList.add('me');
    const score = snap.scores[p.id] ?? 0;
    const dot = p.connected === false ? '<span class="dc-dot" title="disconnected">⚠️</span>' : '';
    li.innerHTML = `<span>${dot}${escapeHtml(p.name)}</span><span>${score}</span>`;
    if (p.connected === false) li.classList.add('disconnected');
    ul.appendChild(li);
  }
}

// ---------- Timer bar ----------
let timerHandle = null;
function startTimerBar(selector, deadline, total) {
  stopTimerBar(selector);
  const el = $(selector);
  if (!el) return;
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    el.style.width = pct + '%';
    if (remaining > 0) timerHandle = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimerBar(selector) {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  const el = $(selector);
  if (el) el.style.width = '0%';
}

// ---------- Utilities ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Disconnect handling ----------
socket.on('disconnect', () => {
  toast(t('toast.connectionLost') || 'Connection lost. Trying to reconnect…');
});

// Socket.io auto-reconnects the transport. When the new socket lands, attempt
// to restore the player in their room using the stable clientId.
socket.on('connect', () => {
  const code = State.roomCode || getActiveRoom();
  if (!code) return;
  attemptReconnect(code);
});

function attemptReconnect(code) {
  socket.emit('room:reconnect', { code, clientId: CLIENT_ID }, (resp) => {
    if (!resp || !resp.ok) {
      // Stale active room. Forget it so the user lands on Home next visit.
      if (resp && (resp.error === 'room_not_found' || resp.error === 'player_not_found')) {
        setActiveRoom(null);
        State.roomCode = null;
        State.myId = null;
        State.snapshot = null;
        showScreen('screen-home');
        updateHomeButtonVisibility();
      }
      return;
    }
    // Restored. Apply the resume payload.
    State.myId = resp.you;
    State.roomCode = resp.code;
    State.snapshot = resp.snapshot;
    setActiveRoom(resp.code);

    // Apply role + canvas history if game is mid-flight.
    if (resp.role) {
      State.role = resp.role.role;
      State.category = resp.role.category;
      State.word = resp.role.word;
      State.isImpostor = State.role === 'impostor';
      renderRoleBox();
      Board.clear();
      Board.setHandlers({
        onStroke: (s) => socket.emit('draw:stroke', s),
        onStrokeEnd: () => socket.emit('draw:end'),
      });
      if (Array.isArray(resp.canvasOps)) {
        for (const s of resp.canvasOps) Board.renderStroke(s);
      }
    }

    // Jump to the right screen.
    switch (resp.state) {
      case 'lobby':         enterLobby(); break;
      case 'drawing':
        showScreen('screen-game');
        if (resp.turn) {
          State.currentTurnPlayerId = resp.turn.playerId;
          State.turnDeadline = resp.turn.deadline;
          $('#round-display').textContent = resp.turn.round;
          $('#round-total').textContent = resp.turn.totalRounds;
          const isMyTurn = resp.turn.playerId === State.myId;
          $('#turn-name').textContent = isMyTurn
            ? t('game.yourTurn')
            : t('game.turnOf', { name: resp.turn.playerName });
          Board.setEnabled(isMyTurn);
          startTimerBar('#timer-fill', resp.turn.deadline, resp.turn.durationMs);
        }
        break;
      case 'voting':        showScreen('screen-vote'); break;
      case 'impostor_guess':showScreen('screen-guess'); break;
      case 'round_results':
      case 'match_end':     showScreen('screen-results'); break;
      default: enterLobby();
    }
    renderScoreboard(resp.snapshot);
    updateHomeButtonVisibility();
  });
}

// On first page load, if we have an active room saved, the 'connect' handler
// above will fire and attempt reconnect automatically.

// ---------- Home button ----------
function updateHomeButtonVisibility() {
  const btn = $('#home-btn');
  if (!btn) return;
  // Visible whenever we're in a room (any state other than home).
  btn.hidden = !State.roomCode;
}
$('#home-btn').addEventListener('click', () => {
  const inGame = State.snapshot && State.snapshot.state && State.snapshot.state !== 'lobby';
  if (inGame) {
    const ok = confirm(t('home.leaveConfirm') || 'Leave the current game?');
    if (!ok) return;
  }
  socket.emit('room:leave');
  setActiveRoom(null);
  State.myId = null;
  State.roomCode = null;
  State.snapshot = null;
  State.role = null;
  State.word = null;
  State.category = null;
  State.isImpostor = false;
  Board.clear();
  showScreen('screen-home');
  updateHomeButtonVisibility();
});

// Initial sync (e.g. fresh load with no active room).
updateHomeButtonVisibility();
