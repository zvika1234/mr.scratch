// Bot behaviors: drawing random scribbles and voting randomly.

function randomScribbleStrokes() {
  // Generate 3-6 strokes, each a wandering path of 8-20 normalized points.
  const strokes = [];
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b56bff', '#ff9ff3', '#ffa15c', '#222'];
  const strokeCount = 3 + Math.floor(Math.random() * 4);
  for (let s = 0; s < strokeCount; s++) {
    let x = 0.2 + Math.random() * 0.6;
    let y = 0.2 + Math.random() * 0.6;
    const points = [{ x, y }];
    const len = 8 + Math.floor(Math.random() * 13);
    for (let i = 0; i < len; i++) {
      x = Math.min(0.95, Math.max(0.05, x + (Math.random() - 0.5) * 0.08));
      y = Math.min(0.95, Math.max(0.05, y + (Math.random() - 0.5) * 0.08));
      points.push({ x, y });
    }
    strokes.push({
      points,
      color: colors[Math.floor(Math.random() * colors.length)],
      width: 3 + Math.floor(Math.random() * 3),
    });
  }
  return strokes;
}

// Drip-feed strokes to the room so it looks like live drawing.
// Calls onStroke(stroke) for each batch, then onDone() when finished.
function botDraw(onStroke, onDone) {
  const strokes = randomScribbleStrokes();
  let i = 0;
  // Initial "thinking" delay before the bot starts drawing.
  const initialDelay = 600 + Math.random() * 700;
  const step = () => {
    if (i >= strokes.length) {
      onDone();
      return;
    }
    onStroke(strokes[i]);
    i += 1;
    // 700-1200ms between strokes; never exceeds the 10s turn cap.
    setTimeout(step, 700 + Math.random() * 500);
  };
  setTimeout(step, initialDelay);
}

// Pick a vote target for a bot. Avoid voting for self; favor humans slightly
// to make games feel a bit more meaningful, but still essentially random.
function botPickVote(bot, allParticipants) {
  const candidates = allParticipants.filter((p) => p.id !== bot.id);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

module.exports = {
  botDraw,
  botPickVote,
  randomScribbleStrokes,
};
