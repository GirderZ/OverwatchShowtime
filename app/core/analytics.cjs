const { DAY, OFFSET, dayKey, dayStart, addDays, weekStart, periodRange, previousRange, splitDays } = require('./time.cjs');
function summarize(state, start, end) {
  const daily = new Map();
  for (let date = dayKey(start); dayStart(date) < end; date = addDays(date, 1)) daily.set(date, { date, runningMs: 0, foregroundMs: 0, idleMs: 0, sessions: new Set() });
  const hours = Array(24).fill(0), runningHours = Array(24).fill(0), sessionIds = new Set(), sessionTimes = new Map();
  let runningMs = 0, foregroundMs = 0, idleMs = 0;
  for (const part of state.segments) {
    const a = Math.max(start, part.start), b = Math.min(end, part.end);
    if (b <= a) continue;
    const duration = b - a;
    runningMs += duration;
    if (part.foreground) foregroundMs += duration;
    if (part.foreground && part.idle) idleMs += duration;
    sessionIds.add(part.sessionId);
    sessionTimes.set(part.sessionId, (sessionTimes.get(part.sessionId) || 0) + duration);
    for (const block of splitDays(a, b)) {
      const d = daily.get(block.key), ms = block.end - block.start;
      d.runningMs += ms;
      if (part.foreground) d.foregroundMs += ms;
      if (part.foreground && part.idle) d.idleMs += ms;
      d.sessions.add(part.sessionId);
    }
    {
      let cursor = a;
      while (cursor < b) {
        const hour = new Date(cursor + OFFSET).getUTCHours();
        const next = Math.min(b, Math.floor((cursor + OFFSET) / 3600000) * 3600000 + 3600000 - OFFSET);
        runningHours[hour] += next - cursor;
        if (part.foreground) hours[hour] += next - cursor;
        cursor = next;
      }
    }
  }
  const days = [...daily.values()].map(d => ({ ...d, sessionCount: d.sessions.size, sessions: undefined }));
  const playedDays = days.filter(d => d.runningMs > 0).length;
  let longestSessionMs = 0;
  for (const ms of sessionTimes.values()) longestSessionMs = Math.max(longestSessionMs, ms);
  return { start, end, runningMs, foregroundMs, idleMs, activeEstimateMs: foregroundMs - idleMs, backgroundMs: runningMs - foregroundMs, sessionCount: sessionIds.size, playedDays, longestSessionMs, daily: days, hours, runningHours };
}
function dashboard(state, period = 'day', anchor = Date.now(), now = Date.now(), filter = {}) {
  const range = periodRange(period, anchor);
  const cutoff = Math.min(range.end, now);
  const current = summarize(state, range.start, Math.max(range.start, cutoff));
  // Keep the full date axis, while comparing only the same elapsed part of a prior period.
  current.daily = summarize(state, range.start, range.end).daily;
  const previous = previousRange(period, range);
  const previousEnd = Math.min(previous.end, previous.start + Math.max(0, cutoff - range.start));
  const baseline = summarize(state, previous.start, previousEnd);
  const heatmapStart = dayStart(addDays(weekStart(now), -77));
  const heatmap = summarize(state, heatmapStart, heatmapStart + 84 * DAY).daily;
  const hour = period === 'day' && Number.isInteger(filter.hour) && filter.hour >= 0 && filter.hour < 24 ? filter.hour : null;
  const selectionRange = hour === null ? { start: range.start, end: cutoff } : { start: range.start + hour * 3600000, end: Math.min(cutoff, range.start + (hour + 1) * 3600000) };
  const focus = hour === null ? current : summarize(state, selectionRange.start, Math.max(selectionRange.start, selectionRange.end));
  const sessionTotals = new Map();
  for (const p of state.segments) {
    const ms = Math.max(0, Math.min(selectionRange.end, p.end) - Math.max(selectionRange.start, p.start));
    if (!ms) continue;
    const total = sessionTotals.get(p.sessionId) || { runningMs: 0, foregroundMs: 0, idleMs: 0 };
    total.runningMs += ms;
    if (p.foreground) total.foregroundMs += ms;
    if (p.foreground && p.idle) total.idleMs += ms;
    sessionTotals.set(p.sessionId, total);
  }
  const rows = state.sessions.filter(s => s.startedAt < selectionRange.end && s.lastSeenAt > selectionRange.start).map(s => {
    const data = sessionTotals.get(s.id) || { runningMs: 0, foregroundMs: 0, idleMs: 0 };
    return { ...s, ...data };
  }).filter(s => s.runningMs > 0).sort((a, b) => b.startedAt - a.startedAt);
  const comparable = (state.coverage || []).some(c => c.start < previousEnd && c.end > previous.start);
  return { period, range, current, focus, selectionRange, hour, previous: baseline, comparable, changeMs: current.foregroundMs - baseline.foregroundMs, heatmap, sessions: rows.slice(0, 100), sessionTotal: rows.length };
}
module.exports = { summarize, dashboard };
