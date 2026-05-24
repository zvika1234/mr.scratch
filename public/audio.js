// SoundFX — Web Audio API synthesized sounds + Vibration API haptics.
// All sounds use sine/triangle oscillators for a warm, pleasant tone.

const SoundFX = (() => {
  let ctx = null;

  let _soundOn     = localStorage.getItem('mrscratch.sound')     !== 'off';
  let _vibrationOn = localStorage.getItem('mrscratch.vibration') !== 'off';

  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Smooth sine tone with a soft attack + exponential release.
  // type: 'sine' (warm) | 'triangle' (slightly brighter but still gentle)
  function tone(freq, duration, type = 'sine', vol = 0.15) {
    const c = getCtx();
    if (!c) return;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    // Soft attack (20 ms) then exponential decay — no harsh onset.
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration + 0.05);
  }

  // Two oscillators slightly detuned — creates a gentle "chorus" richness.
  function richTone(freq, duration, vol = 0.12) {
    tone(freq,        duration, 'sine', vol);
    tone(freq * 1.004, duration, 'sine', vol * 0.6); // subtle chorus
  }

  const sounds = {
    // 3 soft rising chimes — C5, E5, G5
    yourTurn() {
      richTone(523, 0.35, 0.14);
      setTimeout(() => richTone(659, 0.35, 0.14), 160);
      setTimeout(() => richTone(784, 0.50, 0.16), 320);
    },

    // Single gentle low note
    theirTurn() {
      tone(330, 0.30, 'sine', 0.08);
    },

    // Soft short ding — per second in last 3s
    tick() {
      tone(880, 0.18, 'sine', 0.09);
    },

    // Gentle mystery chord — C4, E4, G4
    vote() {
      tone(262, 0.55, 'sine', 0.10);
      tone(330, 0.55, 'sine', 0.08);
      tone(392, 0.55, 'sine', 0.06);
    },

    // Tiny soft tap
    click() {
      tone(700, 0.07, 'sine', 0.07);
    },

    // Warm ascending melody — impostor caught
    caught() {
      richTone(523, 0.22, 0.13);
      setTimeout(() => richTone(659, 0.22, 0.13), 170);
      setTimeout(() => richTone(784, 0.22, 0.13), 340);
      setTimeout(() => richTone(1047, 0.50, 0.15), 510);
    },

    // Gentle descending — impostor escaped
    escaped() {
      tone(392, 0.28, 'sine', 0.11);
      setTimeout(() => tone(330, 0.28, 'sine', 0.11), 240);
      setTimeout(() => tone(262, 0.45, 'sine', 0.11), 480);
    },

    // Bright warm fanfare — YOU win!
    win() {
      richTone(523,  0.18, 0.13);
      setTimeout(() => richTone(659,  0.18, 0.13), 140);
      setTimeout(() => richTone(784,  0.18, 0.13), 280);
      setTimeout(() => richTone(1047, 0.18, 0.15), 420);
      setTimeout(() => richTone(1319, 0.65, 0.15), 560);
    },
  };

  return {
    get soundOn()     { return _soundOn; },
    get vibrationOn() { return _vibrationOn; },

    setSoundOn(v) {
      _soundOn = !!v;
      localStorage.setItem('mrscratch.sound', _soundOn ? 'on' : 'off');
    },
    setVibrationOn(v) {
      _vibrationOn = !!v;
      localStorage.setItem('mrscratch.vibration', _vibrationOn ? 'on' : 'off');
    },

    play(name) {
      if (!_soundOn) return;
      if (sounds[name]) sounds[name]();
    },

    vibrate(pattern) {
      if (!_vibrationOn) return;
      if (navigator.vibrate) navigator.vibrate(pattern);
    },

    unlock() { getCtx(); },
  };
})();
