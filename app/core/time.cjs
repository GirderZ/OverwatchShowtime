const DAY = 86400000;
const OFFSET = 8 * 3600000;
const TIMEZONE = 'Asia/Shanghai';
function dayKey(ms) { return new Date(ms + OFFSET).toISOString().slice(0, 10); }
function dayStart(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('日期格式不正确');
  const value = Date.parse(`${key}T00:00:00+08:00`);
  if (!Number.isFinite(value) || dayKey(value) !== key) throw new Error('日期不存在');
  return value;
}
function addDays(key, count) { return dayKey(dayStart(key) + count * DAY); }
function weekStart(ms) {
  const key = dayKey(ms);
  const weekday = new Date(dayStart(key) + OFFSET).getUTCDay();
  return addDays(key, -(weekday + 6) % 7);
}
function periodRange(period, anchor = Date.now()) {
  const key = dayKey(anchor);
  if (period === 'day') return { start: dayStart(key), end: dayStart(addDays(key, 1)), key };
  if (period === 'week') {
    const first = weekStart(anchor);
    return { start: dayStart(first), end: dayStart(addDays(first, 7)), key: first };
  }
  if (period === 'month') {
    const first = `${key.slice(0, 7)}-01`;
    const date = new Date(dayStart(first) + OFFSET);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return { start: dayStart(first), end: date.getTime() - OFFSET, key: first };
  }
  throw new Error('未知统计周期');
}
function previousRange(period, range) { return periodRange(period, range.start - 1); }
function splitDays(start, end) {
  const output = [];
  let cursor = start;
  while (cursor < end) {
    const key = dayKey(cursor);
    const next = Math.min(end, dayStart(addDays(key, 1)));
    output.push({ key, start: cursor, end: next });
    cursor = next;
  }
  return output;
}
function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
module.exports = { DAY, OFFSET, TIMEZONE, dayKey, dayStart, addDays, weekStart, periodRange, previousRange, splitDays, formatDuration };
