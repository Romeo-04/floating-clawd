// Floating Clawd: draws the sprite, animates moods, and handles drag, click and Ctrl+wheel.
// Click-through on transparent areas is done by the window's shape (see shapeClawdWindow).
import { spriteSVG, isOpaque } from '../../core/sprite.js';

const api = window.clawd;
const stage = document.getElementById('stage');
const hop = document.getElementById('hop');
const sprite = document.getElementById('sprite');

const RESIZE_STEP = 8;
const CLICK_SLOP = 4;
const BLINK_MOODS = new Set(['idle', 'typing', 'look-left', 'look-right']);

let mood = 'idle';
let size = 104;
let color = 'orange';
let blinking = false;
let drag = null; // { x, y, moved }

function render() {
  sprite.innerHTML = spriteSVG(mood, size, { blink: blinking, color });
  sprite.className = mood;
}

function setMood(next) {
  if (next === mood) return;
  mood = next;
  hop.classList.remove('once', 'loop');
  if (mood === 'happy') {
    void hop.offsetWidth; // restart the animation
    hop.classList.add('once');
  } else if (mood === 'celebrate') {
    hop.classList.add('loop');
  }
  render();
}

hop.addEventListener('animationend', () => hop.classList.remove('once'));

// ---- blink: every 3–6 s for 140 ms ----
function scheduleBlink() {
  setTimeout(() => {
    if (BLINK_MOODS.has(mood) && !drag) {
      blinking = true; render();
      setTimeout(() => { blinking = false; render(); }, 140);
    }
    scheduleBlink();
  }, 3000 + Math.random() * 3000);
}

// ---- pointer ----
function overClawd(e) {
  const r = sprite.getBoundingClientRect();
  return isOpaque(mood, e.clientX - r.left, e.clientY - r.top, size);
}

function endDrag(e) {
  if (!drag) return;
  const moved = drag.moved || Math.hypot(e.screenX - drag.x, e.screenY - drag.y) >= CLICK_SLOP;
  drag = null;
  stage.classList.remove('dragging');
  api.dragEnd();
  if (!moved) api.clawdClick();
}

window.addEventListener('mousemove', e => {
  if (!drag) return;
  if (e.buttons === 0) return endDrag(e); // mouseup was lost outside the window
  if (Math.hypot(e.screenX - drag.x, e.screenY - drag.y) >= CLICK_SLOP) drag.moved = true;
});

window.addEventListener('mousedown', e => {
  if (e.button !== 0 || !overClawd(e)) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  stage.classList.add('dragging');
  api.dragStart();
});

window.addEventListener('mouseup', e => { if (e.button === 0) endDrag(e); });

window.addEventListener('wheel', e => {
  if (!e.ctrlKey || !overClawd(e)) return;
  e.preventDefault();
  api.resizeBy(e.deltaY < 0 ? RESIZE_STEP : -RESIZE_STEP);
}, { passive: false });

// ---- state from main ----
api.onMood(setMood);
api.onSize(px => { size = px; render(); });
api.onColor(c => { color = c; render(); });

render();
scheduleBlink();
api.ready();
