// UI translations. Server-side game words live in src/words.js — those are
// chosen by the room language. Category labels exist in both languages so the
// UI shows them correctly regardless of room language.

const I18N = {
  en: {
    'meta.title': 'Mr.Scratch',
    'lang.toggle': 'עברית',

    'home.title': 'Mr.Scratch',
    'home.tagline': 'Draw. Spot the impostor. Survive.',
    'home.yourName': 'Your name',
    'home.create': 'Create Private Room',
    'home.join': 'Join Room',
    'home.or': 'or',
    'home.rulesTitle': 'How to play',
    'home.rule1': '3 to 5 players join a room. One is secretly the Impostor.',
    'home.rule2': 'Normal players see the secret word. The Impostor only sees the category.',
    'home.rule3': 'Everyone takes turns drawing on the shared canvas (3 turns each, max 10 seconds per turn). One mouse lift ends the turn.',
    'home.rule4': 'The Impostor sees the canvas the whole time and must bluff their drawings.',
    'home.rule5': 'After 3 rounds, everyone votes on who the Impostor is.',
    'home.rule6': 'Caught Impostor: each other player gets +1 point. Hidden Impostor: +3 points.',
    'home.rule7': 'The Impostor always gets one last chance to guess the word for +1 bonus point.',
    'home.rule8': 'First to 6 points wins the match.',

    'lobby.title': 'Lobby',
    'lobby.roomCode': 'Room code',
    'lobby.copyLink': 'Copy share link',
    'lobby.players': 'Players',
    'lobby.addBot': '+ Add Bot',
    'lobby.removeBot': 'Remove',
    'lobby.kickPlayer': 'Kick',
    'lobby.category': 'Category',
    'lobby.roomLang': 'Room language',
    'lobby.start': 'Start Game',
    'lobby.minPlayers': 'Need at least 3 players (humans + bots).',
    'lobby.waitingHost': 'Waiting for the host to start…',
    'lobby.hostBadge': 'HOST',
    'lobby.botBadge': 'BOT',
    'lobby.changeAvatar': 'Click to change avatar',
    'lobby.avatarTaken': 'Already taken by another player',
    'lobby.readyLabel': "I'm Ready",
    'lobby.readyHelper': 'All players need to be ready for the host to start the game.',
    'lobby.readyBadge': 'Ready',

    'cat.random': 'Random',
    'cat.food': 'Food',
    'cat.animals': 'Animals',
    'cat.transportation': 'Transportation',
    'cat.clothing': 'Clothing',
    'cat.fantasy': 'Fantasy',
    'cat.nature': 'Nature & Weather',
    'cat.places': 'Places & Buildings',
    'cat.objects': 'Objects',

    'game.yourRole': 'Your role',
    'game.role.impostor': 'Impostor',
    'game.role.player': 'Player',
    'game.category': 'Category',
    'game.secretWord': 'Secret word',
    'game.round': 'Round',
    'game.scores': 'Scores',
    'game.yourTurn': 'Your turn — draw!',
    'game.turnOf': "{name}'s turn",
    'game.impostorHint': 'You only see the category. Watch the canvas for clues!',

    'vote.title': "Who's the Impostor?",
    'vote.subtitle': "Pick the player you think doesn't know the word.",
    'vote.you': '(you)',
    'vote.voted': '{n}/{total} voted',

    'guess.title': 'Last chance!',
    'guess.body': 'Impostor, type your guess for the secret word for a bonus point.',
    'guess.submit': 'Submit',
    'guess.waiting': 'Waiting for the impostor to guess…',
    'guess.yourTurnTitle': "It's your bonus shot",

    'results.title': 'Round results',
    'results.matchTitle': 'Match over!',
    'results.impostorWas': 'The impostor was',
    'results.wordWas': 'The word was',
    'results.impostorGuess': 'Impostor guessed',
    'results.votes': 'Votes',
    'results.scores': 'Scores',
    'results.next': 'Next Round',
    'results.newMatch': 'New Match',
    'results.caught': 'Impostor was caught!',
    'results.escaped': 'Impostor escaped!',
    'results.guessCorrect': 'correct! +1 bonus',
    'results.guessWrong': 'wrong',
    'results.winner': '{name} wins the match!',

    'settings.uiLanguage': 'Interface language',
    'settings.gameLanguage': 'Game language',
    'settings.sound': 'Sound',
    'settings.vibration': 'Vibration',
    'settings.on': 'On',
    'settings.off': 'Off',

    'toast.linkCopied': 'Share link copied!',
    'toast.roomNotFound': 'Room not found',
    'toast.roomFull': 'Room is full',
    'toast.gameInProgress': 'Game already in progress',
    'toast.needName': 'Please enter your name first',
    'toast.needCode': 'Please enter a room code',
    'toast.needThree': 'Need at least 3 players to start',
    'toast.notAllReady': 'Not all players are ready yet',
    'toast.connectionLost': 'Connection lost. Trying to reconnect…',
    'toast.youWereKicked': 'You were removed by the host',
    'toast.roomTimeout': 'Room closed due to inactivity',
    'home.leaveConfirm': 'Leave the current game?',
    'home.browsePublic': 'Public Rooms',
    'home.createPublic': 'Create Public Room',
    'home.availableRooms': 'Available rooms',
    'home.noPublicRooms': 'No open rooms right now. Be the first!',
    'lobby.publicBadge': '🌍 Public',

    'home.tipsTitle': 'Quick Tips',
    'home.tip1': 'Draw hints, not spoilers. Clear icons make it easy for the impostor to hide.',
    'home.tip2': 'Use the color palette wisely! Choosing a specific color can reveal whether a player actually knows the secret word or is just guessing.',
    'home.tip3': 'Make it count! You only have 10 seconds and ONE continuous stroke to draw your hint.',
  },

  he: {
    'meta.title': 'מר.סקראץ׳',
    'lang.toggle': 'English',

    'home.title': 'מר.סקראץ׳',
    'home.tagline': 'תצייר. תזהה את המתחזה. תשרוד.',
    'home.yourName': 'השם שלך',
    'home.create': 'צור חדר פרטי',
    'home.join': 'הצטרף לחדר',
    'home.or': 'או',
    'home.rulesTitle': 'איך משחקים',
    'home.rule1': '3 עד 5 שחקנים מצטרפים לחדר. אחד מהם הוא בסתר ה"מתחזה".',
    'home.rule2': 'שחקנים רגילים רואים את המילה הסודית. המתחזה רואה רק את הקטגוריה.',
    'home.rule3': 'כל שחקן מצייר בתורו על לוח משותף (3 תורות לכל אחד, עד 10 שניות בתור). הרמת אצבע אחת מסיימת את התור.',
    'home.rule4': 'המתחזה רואה את הלוח כל הזמן ועליו לבלף את הציורים שלו.',
    'home.rule5': 'אחרי 3 סבבים, כולם מצביעים מי לדעתם המתחזה.',
    'home.rule6': 'אם המתחזה נתפס: כל שחקן אחר מקבל נקודה. אם לא נתפס: המתחזה מקבל 3 נקודות.',
    'home.rule7': 'המתחזה תמיד מקבל הזדמנות אחרונה לנחש את המילה ל-+1 נקודת בונוס.',
    'home.rule8': 'הראשון שמגיע ל-6 נקודות מנצח את המשחק.',

    'lobby.title': 'חדר המתנה',
    'lobby.roomCode': 'קוד חדר',
    'lobby.copyLink': 'העתק קישור שיתוף',
    'lobby.players': 'שחקנים',
    'lobby.addBot': '+ הוסף בוט',
    'lobby.removeBot': 'הסר',
    'lobby.kickPlayer': 'הסר',
    'lobby.category': 'קטגוריה',
    'lobby.roomLang': 'שפת החדר',
    'lobby.start': 'התחל משחק',
    'lobby.minPlayers': 'צריך לפחות 3 שחקנים (אנשים + בוטים).',
    'lobby.waitingHost': 'מחכים שהמארח יתחיל…',
    'lobby.hostBadge': 'מארח',
    'lobby.botBadge': 'בוט',
    'lobby.changeAvatar': 'לחץ לשנות אווטאר',
    'lobby.avatarTaken': 'כבר תפוס על ידי שחקן אחר',
    'lobby.readyLabel': 'אני מוכן',
    'lobby.readyHelper': 'כל השחקנים צריכים להיות מוכנים כדי שהמארח יוכל להתחיל.',
    'lobby.readyBadge': 'מוכן',

    'cat.random': 'אקראי',
    'cat.food': 'אוכל',
    'cat.animals': 'חיות',
    'cat.transportation': 'תחבורה',
    'cat.clothing': 'בגדים',
    'cat.fantasy': 'פנטזיה',
    'cat.nature': 'טבע ומזג אוויר',
    'cat.places': 'מקומות ומבנים',
    'cat.objects': 'חפצים',

    'game.yourRole': 'התפקיד שלך',
    'game.role.impostor': 'מתחזה',
    'game.role.player': 'שחקן',
    'game.category': 'קטגוריה',
    'game.secretWord': 'מילה סודית',
    'game.round': 'סבב',
    'game.scores': 'ניקוד',
    'game.yourTurn': 'התור שלך — צייר!',
    'game.turnOf': 'התור של {name}',
    'game.impostorHint': 'אתה רואה רק את הקטגוריה. עקוב אחרי הלוח לרמזים!',

    'vote.title': 'מי המתחזה?',
    'vote.subtitle': 'בחר את השחקן שלדעתך לא יודע את המילה.',
    'vote.you': '(אתה)',
    'vote.voted': '{n}/{total} הצביעו',

    'guess.title': 'הזדמנות אחרונה!',
    'guess.body': 'מתחזה, נחש את המילה הסודית לנקודת בונוס.',
    'guess.submit': 'שלח',
    'guess.waiting': 'מחכים שהמתחזה ינחש…',
    'guess.yourTurnTitle': 'זה ניחוש הבונוס שלך',

    'results.title': 'תוצאות הסבב',
    'results.matchTitle': 'המשחק נגמר!',
    'results.impostorWas': 'המתחזה היה',
    'results.wordWas': 'המילה הייתה',
    'results.impostorGuess': 'המתחזה ניחש',
    'results.votes': 'הצבעות',
    'results.scores': 'ניקוד',
    'results.next': 'סבב הבא',
    'results.newMatch': 'משחק חדש',
    'results.caught': 'המתחזה נתפס!',
    'results.escaped': 'המתחזה התחמק!',
    'results.guessCorrect': 'נכון! +1 בונוס',
    'results.guessWrong': 'שגוי',
    'results.winner': '{name} ניצח/ה את המשחק!',

    'settings.uiLanguage': 'שפת ממשק',
    'settings.gameLanguage': 'שפת המשחק',
    'settings.sound': 'סאונד',
    'settings.vibration': 'ויברציה',
    'settings.on': 'פועל',
    'settings.off': 'כבוי',

    'toast.linkCopied': 'קישור שיתוף הועתק!',
    'toast.roomNotFound': 'החדר לא נמצא',
    'toast.roomFull': 'החדר מלא',
    'toast.gameInProgress': 'משחק כבר מתנהל',
    'toast.needName': 'נא הזן את שמך תחילה',
    'toast.needCode': 'נא הזן קוד חדר',
    'toast.needThree': 'צריך לפחות 3 שחקנים כדי להתחיל',
    'toast.notAllReady': 'לא כל השחקנים מוכנים עדיין',
    'toast.connectionLost': 'החיבור אבד. מנסה להתחבר מחדש…',
    'toast.youWereKicked': 'הוצאת מהחדר על ידי המנהל',
    'toast.roomTimeout': 'החדר נסגר עקב חוסר פעילות',
    'home.leaveConfirm': 'לעזוב את המשחק הנוכחי?',
    'home.browsePublic': 'חדרים ציבוריים',
    'home.createPublic': 'צור חדר ציבורי',
    'home.availableRooms': 'חדרים פתוחים',
    'home.noPublicRooms': 'אין חדרים פתוחים כרגע. תהיה הראשון!',
    'lobby.publicBadge': '🌍 ציבורי',

    'home.tipsTitle': 'טיפים מהירים',
    'home.tip1': 'צייר רמזים, לא ספוילרים. סמלים ברורים מקלים על המתחזה להסתתר.',
    'home.tip2': 'השתמש בצבע שלך בחוכמה כדי שהחברים יוכלו לזהות את הקווים שלך.',
    'home.tip3': '!תנצל את הזמן. יש לך רק 10 שניות וקו אחד רצוף לצייר את הרמז',
  },
};

// Current language. Default to browser preference if Hebrew, else English.
let currentLang = (navigator.language || 'en').startsWith('he') ? 'he' : 'en';

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
  if (vars) {
    for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  }
  return s;
}

function setLang(lang) {
  if (lang !== 'en' && lang !== 'he') return;
  currentLang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  // Refresh all static labels.
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  // Let app.js know so it re-renders dynamic UI.
  document.dispatchEvent(new CustomEvent('lang:changed', { detail: { lang } }));
}

function getLang() {
  return currentLang;
}

// Apply immediately so initial render uses the chosen language.
window.addEventListener('DOMContentLoaded', () => setLang(currentLang));
