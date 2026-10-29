const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarize } = require('./analytics.cjs');
const { atomicWrite } = require('./store.cjs');
const { TIMEZONE, DAY, dayStart, dayKey, addDays, weekStart, periodRange, previousRange, formatDuration } = require('./time.cjs');
const VERSION = require('../../package.json').version;
function buildPeriodReport(state, type, startKey, generatedAt = Date.now()) {
  const start = dayStart(startKey), range = periodRange(type, start);
  if (range.start !== start) throw new Error(type === 'week' ? '周报必须从周一开始' : '月报必须从每月一日开始');
  const { end } = range, cutoff = Math.max(start, Math.min(end, generatedAt));
  const stats = summarize(state, start, cutoff);
  const dailyMap = new Map(stats.daily.map(d => [d.date, d]));
  const daily = [];
  for (let cursor = start; cursor < end; cursor += DAY) daily.push(dailyMap.get(dayKey(cursor)) || { date: dayKey(cursor), runningMs: 0, foregroundMs: 0, idleMs: 0, sessionCount: 0 });
  const prior = previousRange(type, range);
  const previousEnd = Math.min(prior.end, prior.start + (cutoff - start));
  const previous = summarize(state, prior.start, previousEnd);
  const previousHasCoverage = state.coverage.some(c => c.start < previousEnd && c.end > prior.start);
  const monitoringMs = state.coverage.reduce((sum, c) => sum + Math.max(0, Math.min(c.end, cutoff) - Math.max(c.start, start)), 0);
  const percent = previous.foregroundMs > 0 ? Math.round((stats.foregroundMs / previous.foregroundMs - 1) * 1000) / 10 : null;
  const peakHour = stats.foregroundMs ? stats.hours.indexOf(Math.max(...stats.hours)) : null;
  const busiest = daily.reduce((best, d) => d.foregroundMs > (best?.foregroundMs || 0) ? d : best, null);
  const weekendMs = daily.filter(d => [0, 6].includes(new Date(dayStart(d.date) + 8 * 3600000).getUTCDay())).reduce((sum, d) => sum + d.foregroundMs, 0);
  const complete = generatedAt >= end;
  const label = type === 'week' ? '周' : '月';
  const report = {
    schema: `overwatch-time.${type === 'week' ? 'weekly' : 'monthly'}.v1`, appVersion: VERSION, timezone: TIMEZONE,
    generatedAt: new Date(generatedAt).toISOString(), period: { start: startKey, endInclusive: dayKey(end - DAY), endExclusive: dayKey(end), complete, type },
    game: '守望先锋（国服）', primaryMetric: 'foregroundMs',
    coverage: { collectionStartedAt: new Date(state.createdAt).toISOString(), monitoringMs, previousHasCoverage, note: '仅统计工具正常监测期间。关闭、暂停、锁屏和休眠期间不补算；未记录不代表没有游玩。' },
    totals: { runningMs: stats.runningMs, foregroundMs: stats.foregroundMs, backgroundMs: stats.backgroundMs, idleMs: stats.idleMs, activeEstimateMs: stats.activeEstimateMs, sessionCount: stats.sessionCount, playedDays: stats.playedDays, longestSessionMs: stats.longestSessionMs },
    daily, hourlyForegroundMs: stats.hours,
    previous: { runningMs: previous.runningMs, foregroundMs: previous.foregroundMs },
    comparison: { deltaForegroundMs: stats.foregroundMs - previous.foregroundMs, percent, comparable: previousHasCoverage, basis: complete ? `上一完整${label}` : `上一${label}同期` },
    insights: { peakHour, busiestDate: busiest?.date || null, weekendForegroundMs: weekendMs, weekdayForegroundMs: stats.foregroundMs - weekendMs, averagePlayedDayMs: stats.playedDays ? stats.foregroundMs / stats.playedDays : 0 },
    metricDefinitions: { runningMs: '游戏进程运行时长，含菜单、排队和后台；锁屏、休眠不计。', foregroundMs: '游戏窗口处于前台的时长，含菜单、排队和无操作。', idleMs: '前台且超过当时无操作阈值的时长，不等于挂机。', activeEstimateMs: '前台减疑似无操作，仅供参考。', sessionCount: '连续监测到的游玩段数，不等于对局数。' }
  };
  const { generatedAt: omitted, ...content } = report;
  report.contentHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return report;
}
function buildWeeklyReport(state, startKey, generatedAt) { return buildPeriodReport(state, 'week', startKey, generatedAt); }
function buildMonthlyReport(state, startKey, generatedAt) { return buildPeriodReport(state, 'month', startKey, generatedAt); }
function reportMarkdown(report) {
  const t = report.totals, label = report.period.type === 'month' ? '月' : '周';
  const delta = report.comparison.deltaForegroundMs;
  const compare = report.comparison.comparable ? `${delta >= 0 ? '增加' : '减少'} ${formatDuration(Math.abs(delta))}${report.comparison.percent === null ? '' : `（${report.comparison.percent > 0 ? '+' : ''}${report.comparison.percent}%）`}` : '暂无可比记录';
  return `# 屁股时间 · 游戏${label}报\n\n${report.period.start} — ${report.period.endInclusive} · 北京时间${report.period.complete ? '' : ' · 进行中'}\n\n- 游戏前台：**${formatDuration(t.foregroundMs)}**\n- 游戏运行：${formatDuration(t.runningMs)}\n- 游玩：${t.playedDays} 天 / ${t.sessionCount} 段\n- 最长游玩段：${formatDuration(t.longestSessionMs)}\n- 相比${report.comparison.basis}：${compare}\n- 高峰时段：${report.insights.peakHour === null ? '暂无记录' : `${String(report.insights.peakHour).padStart(2, '0')}:00 — ${String(report.insights.peakHour + 1).padStart(2, '0')}:00`}\n\n| 日期 | 游戏前台 | 游戏运行 | 游玩段数 |\n| --- | --- | --- | --- |\n${report.daily.map(d => `| ${d.date} | ${formatDuration(d.foregroundMs)} | ${formatDuration(d.runningMs)} | ${d.sessionCount} |`).join('\n')}\n\n${report.coverage.note}\n有效监测覆盖：${formatDuration(report.coverage.monitoringMs)}。前台含菜单与排队，不等于实际对局时间。\n\n生成时间：${report.generatedAt}\n协议：${report.schema}\n`;
}
function writePeriodReport(folder, report, updateLatest = true) {
  const type = report.period.type || 'week';
  const stem = `${type}-${report.period.start}`;
  atomicWrite(path.join(folder, `${stem}.json`), JSON.stringify(report, null, 2));
  atomicWrite(path.join(folder, `${stem}.md`), reportMarkdown(report));
  if (updateLatest && report.period.complete) writePointer(folder, type, report);
  return path.join(folder, `${stem}.md`);
}
function writePointer(folder, type, report) {
  atomicWrite(path.join(folder, `latest-${type}.json`), JSON.stringify(report, null, 2));
  atomicWrite(path.join(folder, `latest-${type}.md`), reportMarkdown(report));
}
function autoPeriodReports(state, folder, type, now) {
  const current = periodRange(type, now).start;
  const limit = type === 'week' ? current - 104 * 7 * DAY : (() => { const d = new Date(current + 8 * 3600000); d.setUTCMonth(d.getUTCMonth() - 36); return d.getTime() - 8 * 3600000; })();
  let cursor = Math.max(periodRange(type, state.createdAt).start, limit), latest = null;
  while (cursor < current) {
    const report = buildPeriodReport(state, type, dayKey(cursor), now);
    const file = path.join(folder, `${type}-${report.period.start}.json`);
    let old; try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (old?.contentHash !== report.contentHash) writePeriodReport(folder, report, false);
    latest = old?.contentHash === report.contentHash ? old : report;
    cursor = periodRange(type, cursor).end;
  }
  if (latest) {
    let old; try { old = JSON.parse(fs.readFileSync(path.join(folder, `latest-${type}.json`), 'utf8')); } catch {}
    if (old?.contentHash !== latest.contentHash || old?.period?.start !== latest.period.start) writePointer(folder, type, latest);
  } else {
    for (const extension of ['json', 'md']) { const file = path.join(folder, `latest-${type}.${extension}`); if (fs.existsSync(file)) fs.unlinkSync(file); }
  }
  return latest;
}
function autoReports(state, folder, now = Date.now()) { return autoPeriodReports(state, folder, 'week', now); }
function autoMonthlyReports(state, folder, now = Date.now()) { return autoPeriodReports(state, folder, 'month', now); }
module.exports = { buildWeeklyReport, buildMonthlyReport, weeklyMarkdown: reportMarkdown, reportMarkdown, writeWeeklyReport: writePeriodReport, writePeriodReport, autoReports, autoMonthlyReports };
