const { freshState } = require('./store.cjs');
const { DAY, dayStart, dayKey } = require('./time.cjs');
function demoState(now = Date.now()) {
  const state = freshState();
  const today = dayStart(dayKey(now));
  state.createdAt = today - 83 * DAY;
  for (let i = 83; i >= 0; i--) {
    if (i % 6 === 2 || i % 9 === 4) continue;
    const day = today - i * DAY;
    const start = day + (i === 0 ? 10 : 19) * 3600000 + (i % 4) * 15 * 60000;
    const duration = (48 + ((i * 37 + 79) % 146)) * 60000;
    const end = Math.min(start + duration, now - 60000);
    if (end <= start) continue;
    const id = `demo-${i}`;
    const first = Math.floor((end - start) * 0.56);
    const middle = Math.floor((end - start) * 0.13);
    state.sessions.push({ id, startedAt: start, endedAt: end, lastSeenAt: end, source: 'demo', note: i === 0 ? '界面演示数据' : '', endReason: '游戏退出' });
    state.segments.push({ sessionId: id, start, end: start + first, foreground: true, idle: false }, { sessionId: id, start: start + first, end: start + first + middle, foreground: false, idle: false }, { sessionId: id, start: start + first + middle, end, foreground: true, idle: false });
    state.coverage.push({ start: day + 9 * 3600000, end: Math.max(end, day + 22 * 3600000) });
  }
  return state;
}
module.exports = { demoState };
