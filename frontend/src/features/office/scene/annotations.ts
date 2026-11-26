export type Action = 'cueClaim' | 'cueWork' | 'cueReview' | 'cuePass' | 'cueReceive' | 'cueDeliver' | 'cueRest';
export interface TimedAction { action: Action; start: number; end: number }
export interface Speaker { messages?: TimedAction[] }

// A claim and a start can arrive in the same poll. Give each a readable turn.
export function announce(speaker: Speaker, action: Action, now: number) {
  const pending = (speaker.messages ?? []).filter(message => message.end > now);
  if (pending.some(message => message.action === action)) return;
  const start = pending.at(-1)?.end ?? now;
  speaker.messages = [...pending, { action, start, end: start + 4 }];
}

export function currentAction(speaker: Speaker, now: number) {
  return speaker.messages?.find(message => message.start <= now && now < message.end)?.action;
}

export interface LabelBox { x: number; y: number; w: number; h: number }

// Positions and obstacles use CSS pixels in the viewport, independent of WebGL density.
export function placeLabel(x: number, bottom: number, w: number, h: number,
  width: number, height: number, obstacles: LabelBox[]): LabelBox | undefined {
  const margin = 3;
  if (w + margin * 2 > width || h + margin * 2 > height) return;
  for (const row of [0, 1, 2, 3, 4, -1, -2]) {
    const y = Math.min(height - h - margin, bottom - h - row * (h + margin));
    if (y < margin) continue;
    for (const offset of [0, -.4, .4, -.78, .78]) {
      const left = Math.max(margin, Math.min(width - w - margin, x - w / 2 + offset * w));
      if (obstacles.every(box => left + w + margin <= box.x || left >= box.x + box.w + margin ||
        y + h + margin <= box.y || y >= box.y + box.h + margin)) return { x: left, y, w, h };
    }
  }
}
