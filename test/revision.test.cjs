const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { freshState, validateSettings, validateState } = require('../app/core/store.cjs');
const { dashboard } = require('../app/core/analytics.cjs');
const { periodRange, dayStart, DAY } = require('../app/core/time.cjs');
const { buildMonthlyReport, autoMonthlyReports, autoReports, writePeriodReport } = require('../app/core/reports.cjs');
const { chartPoints } = require('../app/ui/chart-model.js');
const ms = value => Date.parse(`${value}+08:00`);
function fixture() {
  const state = freshState(); state.createdAt = dayStart('2026-08-01');
  const start = ms('2026-10-29T10:30:00'), end = ms('2026-10-29T12:30:00');
  state.sessions.push({ id:'fixture',startedAt:start,lastSeenAt:end,endedAt:end,source:'auto',note:'legacy note',endReason:'游戏退出' });
  state.segments.push({ sessionId:'fixture',start,end:start+3600000,foreground:true,idle:false },{ sessionId:'fixture',start:start+3600000,end,foreground:false,idle:false });
  state.coverage.push({ start, end });
  return state;
}
test('日度默认值与24小时轴，前后台分别按小时切分', () => {
  const now = ms('2026-10-29T22:00:00');
  const stats = dashboard(fixture(), undefined, now, now);
  assert.equal(stats.period,'day');
  const points = chartPoints(stats.current,'day',stats.range.start);
  assert.equal(points.length,24);assert.equal(points[0].label,'00:00');assert.equal(points[23].label,'23:00');
  assert.equal(points[10].foregroundMs,1800000);assert.equal(points[11].foregroundMs,1800000);assert.equal(points[11].backgroundMs,1800000);assert.equal(points[12].backgroundMs,1800000);
});
test('周度横轴完整显示星期一至星期日', () => {
  const now = ms('2026-10-29T22:00:00'), data = dashboard(fixture(),'week',now,now);
  assert.deepEqual(chartPoints(data.current,'week',data.range.start).map(p=>p.label),['星期一','星期二','星期三','星期四','星期五','星期六','星期日']);
});
test('月度横轴按28、29、30、31天自动变化', () => {
  for (const [date,days] of [['2026-02-15',28],['2028-02-15',29],['2026-04-15',30],['2026-10-15',31]]) {
    const now = dayStart(date), data = dashboard(freshState(),'month',now,now);
    const points = chartPoints(data.current,'month',data.range.start);
    assert.equal(points.length,days);assert.equal(points[0].label,'01');assert.equal(points.at(-1).label,String(days));
  }
});
test('点击小时后，摘要与记录同时只统计该小时，完整日图保持不变', () => {
  const now = ms('2026-10-29T22:00:00'), data = dashboard(fixture(),'day',now,now,{hour:11});
  assert.equal(data.current.runningMs,7200000);assert.equal(data.focus.runningMs,3600000);assert.equal(data.focus.foregroundMs,1800000);
  assert.equal(data.sessions.length,1);assert.equal(data.sessions[0].runningMs,3600000);assert.equal(data.sessions[0].foregroundMs,1800000);
  assert.equal(data.selectionRange.start,ms('2026-10-29T11:00:00'));
});
test('空小时筛选不会保留不匹配的记录，周月不接受小时筛选', () => {
  const now = ms('2026-10-29T22:00:00');
  const empty = dashboard(fixture(),'day',now,now,{hour:8});assert.equal(empty.sessions.length,0);assert.equal(empty.focus.runningMs,0);
  const weekly = dashboard(fixture(),'week',now,now,{hour:8});assert.equal(weekly.hour,null);assert.equal(weekly.sessions.length,1);
});
test('旧备份缺少主题时自动补浅色，深色可保存，非法主题被拒绝', () => {
  const old = fixture();delete old.settings.theme;assert.equal(validateState(old).settings.theme,'light');
  assert.equal(validateSettings({...freshState().settings,theme:'dark'}).theme,'dark');
  assert.throws(()=>validateSettings({...freshState().settings,theme:'external-url'}));
});
test('月报使用自然月，闰年有29条每日明细，包含时间观察', () => {
  const state = freshState();state.createdAt=dayStart('2028-02-01');
  const report=buildMonthlyReport(state,'2028-02-01',dayStart('2028-03-01'));
  assert.equal(report.schema,'overwatch-time.monthly.v1');assert.equal(report.daily.length,29);assert.equal(report.period.endExclusive,'2028-03-01');assert.equal(report.period.complete,true);assert.equal(report.insights.peakHour,null);
  assert.throws(()=>buildMonthlyReport(state,'2028-02-02'));
});
test('进行中的月报与上月同期比较，短月截断且保留完整月份日期轴', () => {
  const state=fixture(),now=ms('2026-10-29T22:00:00'),report=buildMonthlyReport(state,'2026-10-01',now);
  assert.equal(report.period.complete,false);assert.equal(report.daily.length,31);assert.equal(report.totals.runningMs,7200000);assert.equal(report.insights.peakHour,10);assert.equal(report.insights.busiestDate,'2026-10-29');assert.equal(report.comparison.percent,null);
});
test('完整月报补生成，与周报固定入口独立，本月进度不覆盖完整月报', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'showtime-monthly-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const state=fixture(),now=dayStart('2026-11-03');autoReports(state,folder,now);autoMonthlyReports(state,folder,now);
  const weekly=JSON.parse(fs.readFileSync(path.join(folder,'latest-week.json'),'utf8'));
  const monthly=JSON.parse(fs.readFileSync(path.join(folder,'latest-month.json'),'utf8'));
  assert.equal(monthly.period.start,'2026-10-01');assert.equal(weekly.period.start,'2026-10-26');
  writePeriodReport(folder,buildMonthlyReport(state,'2026-11-01',now));
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'latest-month.json'),'utf8')).period.start,'2026-10-01');
  const before=fs.readFileSync(path.join(folder,'latest-month.json'),'utf8');autoMonthlyReports(state,folder,now+60000);assert.equal(fs.readFileSync(path.join(folder,'latest-month.json'),'utf8'),before);
});
