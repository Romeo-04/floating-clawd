// Which pose Clawd shows. 'blink' is an animation frame, not a mood.
export function pickMood({ open, done, hour, panelOpen, offline, idleMinutes, justCompleted }) {
  if (offline) return 'offline';
  if (justCompleted) return 'happy';
  if (open + done > 0 && open === 0) return 'celebrate';
  if (panelOpen) return 'typing';
  if (hour >= 23 || hour < 5 || idleMinutes >= 30) return 'sleepy';
  if (hour >= 5 && hour < 12 && done === 0 && open > 0) return 'coffee';
  return 'idle';
}
