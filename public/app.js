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
  // Leaving the game screen always tears down the canvas overlays + timer.
  if (id !== 'screen-game') {
    if (typeof hideTurnAnnouncement === 'function') hideTurnAnnouncement(true);
    if (typeof stopCanvasClock === 'function') stopCanvasClock();
    const clock = document.getElementById('canvas-clock');
    const round = document.getElementById('canvas-round');
    if (clock) clock.hidden = true;
    if (round) round.hidden = true;
  }
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

function renderSettingsPanel() {
  const curUi = getLang();
  $$('[data-ui-lang]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.uiLang === curUi);
  });
  $$('[data-sound]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sound === (SoundFX.soundOn ? 'on' : 'off'));
  });
  $$('[data-vibration]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.vibration === (SoundFX.vibrationOn ? 'on' : 'off'));
  });
  // Hide vibration row on iOS / browsers without Vibration API support.
  const vibRow = $('#vibration-row');
  if (vibRow) vibRow.hidden = !navigator.vibrate;
}

// ---------- Settings panel ----------
const settingsBtn = $('#settings-btn');
const settingsPanel = $('#settings-panel');
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !settingsPanel.hidden;
  settingsPanel.hidden = isOpen;
  if (!isOpen) renderSettingsPanel();
});
// Close panel when clicking anywhere outside.
document.addEventListener('click', (e) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
    settingsPanel.hidden = true;
  }
});
// Initialise button states on load.
renderSettingsPanel();

// ---------- UI language (via settings panel) ----------
$$('[data-ui-lang]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setLang(btn.dataset.uiLang);
    renderSettingsPanel();
  });
});

// ---------- Sound & Vibration toggles ----------
$$('[data-sound]').forEach((btn) => {
  btn.addEventListener('click', () => {
    SoundFX.setSoundOn(btn.dataset.sound === 'on');
    SoundFX.unlock(); // pre-warm AudioContext on this gesture
    renderSettingsPanel();
  });
});
$$('[data-vibration]').forEach((btn) => {
  btn.addEventListener('click', () => {
    SoundFX.setVibrationOn(btn.dataset.vibration === 'on');
    renderSettingsPanel();
  });
});

// React to language changes (refresh dynamic UI bits).
document.addEventListener('lang:changed', () => {
  if (State.snapshot) renderLobby();
  if (State.snapshot) renderScoreboard(State.snapshot);
  if (State.role) renderRoleBox();
  renderSettingsPanel(); // keep panel buttons in sync
});

// ---------- Home screen ----------
function handleJoinResponse(resp) {
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
  socket.emit('public:unbrowse'); // leave the broadcast channel
  enterLobby();
}

$('#btn-create').addEventListener('click', () => {
  const name = getMyName();
  if (!name) return toast(t('toast.needName'));
  socket.emit('room:create', { name, lang: 'en', clientId: CLIENT_ID, isPublic: false }, (resp) => {
    if (!resp || !resp.ok) return toast('Could not create room');
    State.myId = resp.you;
    State.roomCode = resp.code;
    State.snapshot = resp.snapshot;
    setActiveRoom(resp.code);
    socket.emit('public:unbrowse');
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
  socket.emit('room:join', { name, code, clientId: CLIENT_ID }, handleJoinResponse);
}

// ---------- Public rooms screen ----------
$('#btn-browse-public').addEventListener('click', () => {
  enterPublicScreen();
});

$('#btn-back-public').addEventListener('click', () => {
  socket.emit('public:unbrowse');
  showScreen('screen-home');
  updateHomeButtonVisibility();
});

$('#btn-back-lobby').addEventListener('click', () => {
  socket.emit('room:leave');
  setActiveRoom(null);
  State.myId = null;
  State.roomCode = null;
  State.snapshot = null;
  showScreen('screen-home');
  updateHomeButtonVisibility();
});

$('#btn-create-public').addEventListener('click', () => {
  const name = getMyName();
  if (!name) {
    // Show name prompt on the public screen context
    showScreen('screen-home');
    toast(t('toast.needName'));
    $('#home-name').focus();
    return;
  }
  socket.emit('room:create', { name, lang: 'en', clientId: CLIENT_ID, isPublic: true }, (resp) => {
    if (!resp || !resp.ok) return toast('Could not create room');
    State.myId = resp.you;
    State.roomCode = resp.code;
    State.snapshot = resp.snapshot;
    setActiveRoom(resp.code);
    socket.emit('public:unbrowse');
    enterLobby();
  });
});

function enterPublicScreen() {
  showScreen('screen-public');
  socket.emit('public:browse');
  updateHomeButtonVisibility();
}

socket.on('public:update', (list) => {
  renderPublicRooms(list);
});

function renderPublicRooms(list) {
  const ul = $('#public-rooms-list');
  const empty = $('#public-rooms-empty');
  if (!ul) return;
  ul.innerHTML = '';
  empty.hidden = list.length > 0;
  for (const r of list) {
    const li = document.createElement('li');
    li.className = 'public-room-card';
    const langFlag = r.lang === 'he' ? '🇮🇱' : '🇺🇸';
    const catLabel = t('cat.' + r.category);
    const countClass = r.playerCount >= 4 ? 'pr-count almost-full' : 'pr-count';
    li.innerHTML =
      `<span class="pr-host">${r.hostAvatar} ${escapeHtml(r.hostName)}</span>` +
      `<span class="${countClass}">${r.playerCount}/5</span>` +
      `<span class="pr-meta">${catLabel} ${langFlag}</span>`;
    const btn = document.createElement('button');
    btn.className = 'primary small';
    btn.textContent = t('home.join');
    btn.addEventListener('click', () => {
      const name = getMyName();
      if (!name) {
        showScreen('screen-home');
        toast(t('toast.needName'));
        $('#home-name').focus();
        return;
      }
      socket.emit('room:join', { code: r.code, name, clientId: CLIENT_ID }, handleJoinResponse);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
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
  // Show/hide the public badge next to the room code.
  let publicBadge = $('#lobby-public-badge');
  if (snap.isPublic) {
    if (!publicBadge) {
      publicBadge = document.createElement('span');
      publicBadge.id = 'lobby-public-badge';
      publicBadge.className = 'badge badge-public';
      publicBadge.textContent = t('lobby.publicBadge');
      $('#lobby-code').insertAdjacentElement('afterend', publicBadge);
    }
    publicBadge.hidden = false;
  } else if (publicBadge) {
    publicBadge.hidden = true;
  }

  const list = $('#lobby-players');
  list.innerHTML = '';

  const everyone = [...snap.players, ...snap.bots];
  for (const p of everyone) {
    const li = document.createElement('li');
    if (p.isBot) li.classList.add('is-bot', 'bot-row');
    if (p.connected === false) li.classList.add('disconnected');
    const dot = p.connected === false ? '<span class="dc-dot" title="disconnected">⚠️</span> ' : '';
    li.innerHTML = `<span>${dot}${p.avatar || ''} ${escapeHtml(p.name)}</span>`;
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('lobby.hostBadge');
      li.appendChild(badge);
    }
    // Host can kick non-host human players from the lobby.
    if (isHost() && !p.isHost && !p.isBot) {
      const kick = document.createElement('button');
      kick.className = 'kick-btn';
      kick.title = t('lobby.kickPlayer');
      kick.textContent = '✕';
      kick.style.marginInlineStart = 'auto';
      kick.addEventListener('click', () => socket.emit('player:kick', { targetId: p.id }));
      li.appendChild(kick);
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
// (lobby-lang selector removed — game language is now set via the ⚙️ settings panel)
$('#btn-copy-link').addEventListener('click', () => {
  const url = `${window.location.origin}${window.location.pathname}?room=${State.roomCode}`;
  navigator.clipboard.writeText(url).then(() => toast(t('toast.linkCopied')));
});
$('#btn-start').addEventListener('click', () => {
  // Send the current dropdown value as a fallback in case a prior setCategory
  // event was lost. The server uses this as the authoritative choice.
  const category = $('#lobby-category').value || 'random';
  socket.emit('game:start', { category }, (resp) => {
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
// Step 1 — Server announces the upcoming turn. We darken the screen and show
// the player's name. The real turn (drawing + timer) starts on `turn:start`
// ~1.8s later. We pre-update round + canvas badges here so they're correct
// the moment the timer appears.
socket.on('turn:announce', ({ playerId, playerName, playerAvatar, round, totalRounds, durationMs }) => {
  showScreen('screen-game');
  $('#round-display').textContent = round;
  $('#round-total').textContent = totalRounds;
  $('#canvas-round').hidden = false;
  // Reset the clock display to the full 10s so the overlay teases it.
  const clockTime = $('#canvas-clock-time');
  if (clockTime) clockTime.textContent = '10';
  $('#canvas-clock').classList.remove('low');
  $('#canvas-clock').hidden = false;

  const isMyTurn = playerId === State.myId;
  // Sound + haptic feedback for turn start.
  SoundFX.play(isMyTurn ? 'yourTurn' : 'theirTurn');
  if (isMyTurn) SoundFX.vibrate([200, 80, 200]);
  // Update the persistent "now drawing" strip (stays visible for the full turn).
  updateDrawingIndicator(playerId, playerName, playerAvatar);
  showTurnAnnouncement({ playerName, playerAvatar, isMyTurn, round, totalRounds, durationMs });
});

socket.on('turn:start', ({ playerId, playerName, round, totalRounds, deadline, durationMs }) => {
  showScreen('screen-game');
  State.currentTurnPlayerId = playerId;
  State.turnDeadline = deadline;
  $('#round-display').textContent = round;
  $('#round-total').textContent = totalRounds;
  $('#canvas-round').hidden = false;
  // Make sure the overlay is gone (defensive — should already be hiding).
  hideTurnAnnouncement(true);

  const isMyTurn = playerId === State.myId;
  Board.setEnabled(isMyTurn);
  startCanvasClock(deadline, durationMs);
  // Refresh scoreboard so the active-drawer highlight appears immediately.
  if (State.snapshot) renderScoreboard(State.snapshot);
});

socket.on('turn:end', () => {
  Board.setEnabled(false);
  stopCanvasClock();
  State.currentTurnPlayerId = null;
  updateDrawingIndicator(null);
  if (State.snapshot) renderScoreboard(State.snapshot);
});

// ---------- Turn announcement overlay ----------
let announceTimer = null;
function showTurnAnnouncement({ playerName, playerAvatar, isMyTurn, round, totalRounds, durationMs }) {
  const overlay = $('#turn-announce');
  if (!overlay) return;
  const nameEl = $('#ta-name');
  const roundEl = $('#ta-round');
  const avatarPrefix = playerAvatar ? playerAvatar + ' ' : '';
  nameEl.textContent = isMyTurn
    ? t('game.yourTurn')
    : avatarPrefix + t('game.turnOf', { name: playerName });
  nameEl.classList.toggle('is-me', isMyTurn);
  roundEl.textContent = `${t('game.round')} ${round} / ${totalRounds}`;
  overlay.classList.remove('out');
  // Use .active class — NOT the hidden attribute — to show/hide the overlay.
  // Using hidden+display:flex causes a CSS specificity conflict where flex wins
  // and the overlay can never be hidden. Class-based toggle avoids this.
  overlay.classList.add('active');
  // Force reflow so the fade-in animation replays on every new turn.
  // eslint-disable-next-line no-unused-expressions
  overlay.offsetHeight;
  // Auto-hide just before the server fires turn:start.
  if (announceTimer) clearTimeout(announceTimer);
  const fadeAt = Math.max(0, (durationMs || 1800) - 350);
  announceTimer = setTimeout(() => hideTurnAnnouncement(false), fadeAt);
}
function hideTurnAnnouncement(immediate) {
  const overlay = $('#turn-announce');
  if (!overlay || !overlay.classList.contains('active')) return;
  if (announceTimer) { clearTimeout(announceTimer); announceTimer = null; }
  if (immediate) {
    overlay.classList.remove('active', 'out');
    return;
  }
  overlay.classList.add('out');
  setTimeout(() => { overlay.classList.remove('active', 'out'); }, 350);
}

// ---------- Stroke broadcast ----------
socket.on('draw:stroke', (stroke) => {
  // We've already rendered our own strokes locally; ignore the echo.
  if (stroke.playerId === State.myId) return;
  Board.renderStroke(stroke);
});

// ---------- Voting ----------
function renderVoteScreen(candidates, durationMs, deadline, voted, total) {
  State.myVote = null;
  const list = $('#vote-list');
  list.innerHTML = '';
  $('#vote-status').textContent = (voted != null && total != null)
    ? t('vote.voted', { n: voted, total }) : '';
  if (deadline && durationMs) startTimerBar('#vote-timer-fill', deadline, durationMs);
  for (const c of candidates) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = (c.avatar ? c.avatar + ' ' : '') + c.name + (c.id === State.myId ? ' ' + t('vote.you') : '');
    btn.addEventListener('click', () => {
      if (c.id === State.myId) return; // can't vote for self
      State.myVote = c.id;
      list.querySelectorAll('.vote-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      SoundFX.play('click');
      SoundFX.vibrate([50]);
      socket.emit('vote:cast', { targetId: c.id });
    });
    if (c.id === State.myId) btn.disabled = true;
    li.appendChild(btn);
    list.appendChild(li);
  }
}

socket.on('vote:begin', ({ candidates, durationMs, deadline }) => {
  showScreen('screen-vote');
  SoundFX.play('vote');
  SoundFX.vibrate([150, 50, 150]);
  renderVoteScreen(candidates, durationMs, deadline);
});
// Live tally: only show "N/total voted" count, NOT per-candidate breakdown
// (that would bias the vote). Per-candidate counts appear on the results screen.
socket.on('vote:tally', ({ voted, total }) => {
  $('#vote-status').textContent = t('vote.voted', { n: voted, total });
});
socket.on('vote:complete', () => {
  // Server transitions to impostor_guess automatically; freeze vote buttons + stop timer.
  $$('#vote-list .vote-btn').forEach((b) => (b.disabled = true));
  stopTimerBar('#vote-timer-fill');
});

// ---------- Impostor guess ----------
function renderGuessScreen(impostorId, durationMs, deadline) {
  State.guessDeadline = deadline;
  const iAmImpostor = State.isImpostor || State.myId === impostorId;
  $('#guess-form').hidden = !iAmImpostor;
  $('#guess-waiting').hidden = iAmImpostor;
  $('#guess-input').value = '';
  $('#guess-input').disabled = false;
  $('#btn-submit-guess').disabled = false;
  if (iAmImpostor) {
    setTimeout(() => $('#guess-input').focus(), 50);
  }
  startTimerBar('#guess-timer-fill', deadline, durationMs);
}

socket.on('guess:begin', ({ impostorId, durationMs, deadline }) => {
  showScreen('screen-guess');
  renderGuessScreen(impostorId, durationMs, deadline);
});

$('#btn-submit-guess').addEventListener('click', submitGuess);
$('#guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitGuess();
});
function submitGuess() {
  const btn = $('#btn-submit-guess');
  if (btn.disabled) return; // already submitted this round
  const guess = $('#guess-input').value.trim();
  socket.emit('impostor:guess', { guess });
  btn.disabled = true;
  $('#guess-input').disabled = true;
  $('#guess-form').hidden = true;
  $('#guess-waiting').hidden = false;
}

// ---------- Results ----------
function renderResultsScreen(data, playSounds) {
  stopTimerBar('#guess-timer-fill');
  if (playSounds) {
    if (data.matchOver && data.winnerId === State.myId) {
      SoundFX.play('win');
      SoundFX.vibrate([300, 100, 300, 100, 600]);
    } else if (data.impostorCaught) {
      SoundFX.play('caught');
      SoundFX.vibrate([200, 100, 200, 100, 400]);
    } else {
      SoundFX.play('escaped');
      SoundFX.vibrate([400, 100, 400]);
    }
  }

  const everyone = State.snapshot ? [...State.snapshot.players, ...State.snapshot.bots] : [];
  const findPlayer = (id) => everyone.find((x) => x.id === id) || { name: '???', avatar: '' };
  const findName   = (id) => findPlayer(id).name;
  const findAvatar = (id) => findPlayer(id).avatar || '';

  // Winner banner (match over)
  const banner = $('#winner-banner');
  if (data.matchOver && data.winnerId) {
    banner.hidden = false;
    banner.textContent = '🏆 ' + findAvatar(data.winnerId) + ' ' + t('results.winner', { name: findName(data.winnerId) });
  } else {
    banner.hidden = true;
  }

  $('#results-title').textContent = data.matchOver ? t('results.matchTitle') : t('results.title');
  $('#result-impostor').textContent =
    `${findAvatar(data.impostorId)} ${findName(data.impostorId)} — ${data.impostorCaught ? t('results.caught') : t('results.escaped')}`;
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

  // Vote breakdown — who got how many votes (with 👤 pips).
  const votesUl = $('#result-votes');
  votesUl.innerHTML = '';
  const voteCounts = data.voteCounts || {};
  const voteRows = everyone
    .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || '', n: voteCounts[p.id] || 0 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  for (const r of voteRows) {
    const li = document.createElement('li');
    if (r.id === State.myId) li.classList.add('me');
    const isImpostorP = r.id === data.impostorId;
    const impostorTag = isImpostorP
      ? `<span class="impostor-tag">🕵️ ${t('game.role.impostor')}</span>`
      : '';
    const pips = r.n > 0 ? '👤'.repeat(r.n) : '—';
    li.innerHTML =
      `<span>${r.avatar} ${escapeHtml(r.name)}${impostorTag}</span>` +
      `<span class="vote-pips">${pips} <small style="opacity:.7">(${r.n})</small></span>`;
    votesUl.appendChild(li);
  }

  const ul = $('#result-scores');
  ul.innerHTML = '';
  const sorted = Object.entries(data.scores).sort((a, b) => b[1] - a[1]);
  for (const [id, score] of sorted) {
    const li = document.createElement('li');
    if (id === State.myId) li.classList.add('me');
    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `${findAvatar(id)} ${escapeHtml(findName(id))}`;
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'score';
    scoreSpan.textContent = score;
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    // Host can kick human players from the results screen.
    const isHumanPlayer = State.snapshot && State.snapshot.players.some((p) => p.id === id);
    if (isHost() && id !== State.myId && isHumanPlayer) {
      const kick = document.createElement('button');
      kick.className = 'kick-btn';
      kick.title = t('lobby.kickPlayer');
      kick.textContent = '✕';
      kick.addEventListener('click', () => socket.emit('player:kick', { targetId: id }));
      li.appendChild(kick);
    }
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
}

socket.on('round:result', (data) => {
  showScreen('screen-results');
  renderResultsScreen(data, /* playSounds */ true);
});

$('#btn-next-round').addEventListener('click', () => socket.emit('round:next'));
$('#btn-new-match').addEventListener('click', () => socket.emit('match:new'));

socket.on('match:reset', () => {
  showScreen('screen-lobby');
});

// Host kicked this player — clear all state and return to Home.
socket.on('you:kicked', () => {
  setActiveRoom(null);
  State.myId = null;
  State.roomCode = null;
  State.snapshot = null;
  State.role = null;
  State.word = null;
  State.category = null;
  State.isImpostor = false;
  if (typeof Board !== 'undefined') Board.clear();
  showScreen('screen-home');
  updateHomeButtonVisibility();
  socket.emit('public:browse'); // re-subscribe to live list
  toast(t('toast.youWereKicked'), 4000);
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
    if (p.connected === false) li.classList.add('disconnected');
    if (p.id === State.currentTurnPlayerId) li.classList.add('drawing');
    const score = snap.scores[p.id] ?? 0;
    const dot = p.connected === false ? '<span class="dc-dot" title="disconnected">⚠️</span>' : '';
    // Name on the left
    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `${dot}${p.avatar || ''} ${escapeHtml(p.name)}`;
    li.appendChild(nameSpan);
    // Score + optional kick button grouped on the right
    const rightGroup = document.createElement('span');
    rightGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';
    rightGroup.textContent = String(score);
    if (isHost() && !p.isBot && p.id !== State.myId && snap.state !== 'lobby') {
      const kick = document.createElement('button');
      kick.className = 'kick-btn';
      kick.title = t('lobby.kickPlayer');
      kick.textContent = '✕';
      kick.addEventListener('click', () => socket.emit('player:kick', { targetId: p.id }));
      rightGroup.appendChild(kick);
    }
    li.appendChild(rightGroup);
    ul.appendChild(li);
  }
}

// ---------- Timer bar (still used by the impostor-guess screen) ----------
let timerHandle = null;
const LOW_TIME_MS = 3000;
function startTimerBar(selector, deadline, total) {
  stopTimerBar(selector);
  const el = $(selector);
  if (!el) return;
  const bar = el.parentElement; // .timer-bar wrapper
  if (bar) bar.classList.remove('low');
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    el.style.width = pct + '%';
    if (bar) bar.classList.toggle('low', remaining > 0 && remaining <= LOW_TIME_MS);
    if (remaining > 0) timerHandle = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimerBar(selector) {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  const el = $(selector);
  if (el) el.style.width = '0%';
  const bar = el && el.parentElement;
  if (bar) bar.classList.remove('low');
}

// ---------- Canvas clock (drawing turn) ----------
let clockHandle = null;
function startCanvasClock(deadline /* ms epoch */, _total) {
  stopCanvasClock();
  const wrap = $('#canvas-clock');
  const timeEl = $('#canvas-clock-time');
  if (!wrap || !timeEl) return;
  wrap.hidden = false;
  wrap.classList.remove('low');

  let lastTickSec = -1; // tracks which second we last beeped on
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    // Show whole seconds (rounded UP), so a fresh turn reads "10" not "9".
    const secs = Math.ceil(remaining / 1000);
    timeEl.textContent = String(secs);
    const isLow = remaining > 0 && remaining <= LOW_TIME_MS;
    wrap.classList.toggle('low', isLow);
    // Beep + vibrate once per second in the last 3 seconds.
    if (isLow && secs !== lastTickSec) {
      lastTickSec = secs;
      SoundFX.play('tick');
      SoundFX.vibrate([80]);
    }
    if (remaining > 0) {
      clockHandle = requestAnimationFrame(tick);
    } else {
      timeEl.textContent = '0';
    }
  };
  tick();
}
function stopCanvasClock() {
  if (clockHandle) { cancelAnimationFrame(clockHandle); clockHandle = null; }
  const wrap = $('#canvas-clock');
  if (wrap) wrap.classList.remove('low');
}

// ---------- Drawing indicator ----------
function getPlayerInfo(id) {
  if (!State.snapshot) return { name: '?', avatar: '' };
  const everyone = [...(State.snapshot.players || []), ...(State.snapshot.bots || [])];
  const p = everyone.find((x) => x.id === id);
  return p ? { name: p.name, avatar: p.avatar || '' } : { name: '?', avatar: '' };
}

function updateDrawingIndicator(playerId, playerName, playerAvatar) {
  const el = $('#drawing-indicator');
  if (!el) return;
  if (!playerId) {
    el.hidden = true;
    el.classList.remove('is-me');
    return;
  }
  const isMe = playerId === State.myId;
  el.hidden = false;
  el.classList.toggle('is-me', isMe);
  const avatarPrefix = playerAvatar ? playerAvatar + ' ' : '';
  el.textContent = isMe
    ? '✏️  ' + t('game.yourTurn')
    : '✏️  ' + avatarPrefix + t('game.turnOf', { name: playerName });
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
  if (code) {
    attemptReconnect(code);
  }
  // If the public screen is currently visible, re-subscribe after reconnect.
  if (document.querySelector('#screen-public.active')) {
    socket.emit('public:browse');
  }
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
          $('#canvas-round').hidden = false;
          $('#canvas-clock').hidden = false;
          const isMyTurn = resp.turn.playerId === State.myId;
          Board.setEnabled(isMyTurn);
          // Reconnect lands mid-turn — skip the announce overlay and just
          // resume the clock at the remaining time.
          hideTurnAnnouncement(true);
          startCanvasClock(resp.turn.deadline, resp.turn.durationMs);
          // Restore the "now drawing" strip without the announce overlay.
          const info = getPlayerInfo(resp.turn.playerId);
          updateDrawingIndicator(resp.turn.playerId, info.name, info.avatar);
        }
        break;
      case 'voting':
        showScreen('screen-vote');
        if (resp.voteResume) {
          renderVoteScreen(
            resp.voteResume.candidates,
            resp.voteResume.durationMs,
            resp.voteResume.deadline,
            resp.voteResume.voted,
            resp.voteResume.total,
          );
        }
        break;
      case 'impostor_guess':
        showScreen('screen-guess');
        if (resp.guessResume) {
          renderGuessScreen(resp.guessResume.impostorId, resp.guessResume.durationMs, resp.guessResume.deadline);
        }
        break;
      case 'round_results':
      case 'match_end':
        showScreen('screen-results');
        if (resp.resultResume) renderResultsScreen(resp.resultResume, /* playSounds */ false);
        break;
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
  // Visible when in a room. Hidden on home screen AND public screen
  // (public screen has its own ← back button).
  const onPublic = !!document.querySelector('#screen-public.active');
  btn.hidden = !State.roomCode || onPublic;
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
  socket.emit('public:browse'); // re-subscribe to live list
});

// Initial sync (e.g. fresh load with no active room).
updateHomeButtonVisibility();
