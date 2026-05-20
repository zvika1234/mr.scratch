// Drawing canvas. Strokes are emitted to the server in normalized 0..1
// coordinates so the same drawing renders correctly on any screen size.
// The active drawer is decided by the server — the canvas just listens to a
// `setEnabled(true|false)` toggle and emits/receives strokes accordingly.

const Board = (() => {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const palette = document.getElementById('palette');

  const COLORS = ['#222222', '#ff6b6b', '#ff9f43', '#ffd93d', '#6bcb77', '#4d96ff', '#b56bff', '#ffffff'];
  let selectedColor = COLORS[0];
  let strokeWidth = 4;

  let enabled = false;
  let drawing = false;
  let currentPoints = [];
  let lastEmit = 0;
  let emitTimer = null;

  let onStroke = null;   // emit partial stroke
  let onStrokeEnd = null; // signal "I lifted my finger"

  // ---- Setup palette buttons ----
  COLORS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.style.background = c;
    if (c === '#ffffff') btn.style.border = '3px solid #ddd';
    btn.dataset.color = c;
    btn.disabled = true;
    if (i === 0) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      if (!enabled) return;
      selectedColor = c;
      palette.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    palette.appendChild(btn);
  });

  function setEnabled(on) {
    enabled = on;
    canvas.classList.toggle('frozen', !on);
    palette.querySelectorAll('button').forEach((b) => (b.disabled = !on));
    // Always reset drawing state when toggling — prevents stuck "drawing=true"
    // from a previous turn causing phantom strokes on pointermove.
    drawing = false;
    currentPoints = [];
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
  }

  function setHandlers(handlers) {
    onStroke = handlers.onStroke;
    onStrokeEnd = handlers.onStrokeEnd;
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ---- Coordinate conversion ----
  function toNormalized(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width;
    const y = (evt.clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  // ---- Render a stroke (received or local) ----
  function renderStroke(stroke) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 1) return;
    ctx.strokeStyle = stroke.color || '#222';
    ctx.lineWidth = (stroke.width || 4);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
    }
    if (stroke.points.length === 1) {
      // Dot
      ctx.arc(first.x * canvas.width, first.y * canvas.height, (stroke.width || 4) / 2, 0, 2 * Math.PI);
      ctx.fillStyle = stroke.color || '#222';
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }

  // ---- Input handling ----
  function flushBatch(final) {
    if (currentPoints.length === 0) return;
    const batch = {
      points: currentPoints.slice(),
      color: selectedColor,
      width: strokeWidth,
    };
    // Local immediate render (drawer sees their line instantly).
    renderStroke(batch);
    if (onStroke) onStroke(batch);
    // Keep last point as the starting point for the next batch so strokes connect.
    const lastPoint = currentPoints[currentPoints.length - 1];
    currentPoints = final ? [] : [lastPoint];
    lastEmit = performance.now();
  }

  function onPointerDown(e) {
    if (!enabled) return;
    e.preventDefault();
    drawing = true;
    currentPoints = [toNormalized(e)];
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!enabled || !drawing) return;
    currentPoints.push(toNormalized(e));
    const now = performance.now();
    if (now - lastEmit > 50) flushBatch(false);
  }

  function onPointerUp() {
    if (!enabled || !drawing) return;
    drawing = false;
    flushBatch(true);
    if (onStrokeEnd) onStrokeEnd();
    // After lifting, drawer can't draw any more (server will end the turn).
    setEnabled(false);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Safety net: if the pointer is released anywhere (e.g. outside the canvas
  // after capture is lost on some mobile browsers), still end the stroke
  // cleanly instead of leaving drawing=true stuck.
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // ---- Responsive resize ----
  // The canvas backing store stays a fixed 800x600 (constant aspect ratio),
  // while CSS scales the visible size. Normalized coordinates render
  // correctly at any display size.
  function resize() {
    // No-op: we keep the internal pixel size fixed. The canvas-wrap has
    // aspect-ratio:4/3 in CSS so it never distorts.
  }
  new ResizeObserver(resize).observe(canvas);

  return {
    setEnabled,
    setHandlers,
    renderStroke,
    clear,
  };
})();
