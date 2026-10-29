const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freshState, validateState, validateSettings, Store } = require('../app/core/store.cjs');
const { Tracker } = require('../app/core/tracker.cjs');
const { summarize, dashboard } = require('../app/core/analytics.cjs');
const { buildWeeklyReport, autoReports, writeWeeklyReport } = require('../app/core/reports.cjs');
const { Reminders } = require('../app/core/reminders.cjs');
const { DAY, dayKey, dayStart, weekStart, periodRange, splitDays } = require('../app/core/time.cjs');
const ms = text => Date.parse(text.includes('+') || text.endsWith('Z') ? text : `${text}+08:00`);
const base = ms('2026-10-28T20:00:00');
const sample = (running=true, foreground=true, idleSeconds=0) => ({ running, foreground, idleSeconds });
function insert(state, start, end, foreground=true, idle=false) {
  const id=`session-${state.sessions.length}`;
  state.sessions.push({id,startedAt:start,lastSeenAt:end,endedAt:end,source:'auto',note:'',endReason:'游戏退出'});
  state.segments.push({sessionId:id,start,end,foreground,idle});
  state.coverage.push({start,end});
  return id;
}
function temp(t) {const folder=fs.mkdtempSync(path.join(os.tmpdir(),'overwatch-time-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;}

test('北京时间跨午夜拆分，且不受运行机器时区影响',()=>{
  const a=ms('2026-10-28T23:59:00'),b=ms('2026-10-29T00:03:00');
  const parts=splitDays(a,b);
  assert.equal(parts.length,2);assert.equal(parts[0].end-parts[0].start,60000);assert.equal(parts[1].end-parts[1].start,180000);
  assert.equal(dayKey(ms('2026-10-28T16:00:00Z')),'2026-10-29');
});
test('周一开始的自然周，在周日和周一正确切换',()=>{
  assert.equal(weekStart(ms('2026-11-01T23:59:59')),'2026-10-26');
  assert.equal(weekStart(ms('2026-11-02T00:00:00')),'2026-11-02');
});
test('闰年、月底和跨年月份长度正确，非法日期被拒绝',()=>{
  const feb=periodRange('month',ms('2028-02-29T12:00:00'));assert.equal((feb.end-feb.start)/DAY,29);
  const dec=periodRange('month',ms('2026-12-28T12:00:00'));assert.equal(dayKey(dec.end),'2027-01-01');
  assert.throws(()=>dayStart('2026-02-30'));assert.throws(()=>dayStart('../data'));
});
test('前台、后台、疑似无操作分别累计，退出后结算',()=>{
  const s=freshState(),t=new Tracker(s);
  t.sample(sample(),base,0);t.sample(sample(true,false),base+2000,2000);t.sample(sample(true,true,500),base+4000,4000);t.sample(sample(false),base+6000,6000);
  const stats=summarize(s,base,base+10000);
  assert.equal(stats.runningMs,6000);assert.equal(stats.foregroundMs,4000);assert.equal(stats.backgroundMs,2000);assert.equal(stats.idleMs,2000);assert.equal(stats.activeEstimateMs,2000);
  assert.equal(s.sessions[0].endedAt,base+6000);validateState(s);
});
test('同一状态采样会合并区间，避免每两秒新增一行',()=>{
  const s=freshState(),t=new Tracker(s);for(let i=0;i<=20;i++)t.sample(sample(),base+i*2000,i*2000);
  assert.equal(s.segments.length,1);assert.equal(s.coverage.length,1);assert.equal(s.segments[0].end-base,40000);
});
test('长时间采样缺口不会被当作游戏时长，也会断开游玩段',()=>{
  const s=freshState(),t=new Tracker(s);t.sample(sample(),base,0);t.sample(sample(),base+2000,2000);t.sample(sample(),base+6*3600000,6*3600000);t.sample(sample(false),base+6*3600000+2000,6*3600000+2000);
  assert.equal(summarize(s,base,base+DAY).runningMs,4000);assert.equal(s.sessions.length,2);assert.equal(s.sessions[0].endReason,'采样中断');validateState(s);
});
test('锁屏、暂停和恢复之间的空白不补计',()=>{
  const s=freshState(),t=new Tracker(s);t.sample(sample(),base,0);t.sample(sample(),base+2000,2000);
  t.sample({...sample(),blocked:true},base+4000,4000);t.sample({...sample(),blocked:true},base+60000,60000);
  t.sample(sample(),base+120000,120000);t.sample(sample(false),base+122000,122000);
  assert.equal(summarize(s,base,base+DAY).runningMs,4000);assert.equal(s.sessions.length,2);
  t.paused=true;t.sample(sample(),base+124000,124000);assert.equal(t.current,null);
});
test('系统时间回拨期间暂停，不能写入重叠时间',()=>{
  const s=freshState(),t=new Tracker(s);t.sample(sample(),base,0);t.sample(sample(),base+2000,2000);
  t.sample(sample(),base-30000,4000);assert.equal(t.clockError,true);assert.equal(t.current,null);
  t.sample(sample(),base+4000,6000);assert.equal(t.clockError,false);t.sample(sample(false),base+6000,8000);validateState(s);
});
test('墙上时间和单调时钟相差过大时丢弃不确定区间',()=>{
  const s=freshState(),t=new Tracker(s);t.sample(sample(),base,0);t.sample(sample(),base+4000,10000);
  assert.equal(s.segments.length,0);assert.equal(s.sessions.length,2);
});
test('没有游戏时仍记录监测覆盖，便于识别数据缺失',()=>{
  const s=freshState(),t=new Tracker(s);t.sample(sample(false),base,0);t.sample(sample(false),base+2000,2000);
  assert.equal(s.sessions.length,0);assert.equal(s.coverage[0].end-s.coverage[0].start,2000);
});
test('同一游玩段跨午夜正确分日，两个日期都有段数',()=>{
  const s=freshState();insert(s,ms('2026-10-28T23:59:00'),ms('2026-10-29T00:03:00'));
  const stats=summarize(s,dayStart('2026-10-28'),dayStart('2026-10-30'));
  assert.equal(stats.runningMs,240000);assert.equal(stats.sessionCount,1);assert.deepEqual(stats.daily.map(d=>d.runningMs),[60000,180000]);assert.deepEqual(stats.daily.map(d=>d.sessionCount),[1,1]);
});
test('当前周的对比只使用上周同期，而不是上一完整周',()=>{
  const s=freshState();s.createdAt=dayStart('2026-10-19');
  insert(s,ms('2026-10-19T20:00:00'),ms('2026-10-19T21:00:00'));
  insert(s,ms('2026-10-24T20:00:00'),ms('2026-10-24T23:00:00'));
  insert(s,ms('2026-10-26T20:00:00'),ms('2026-10-26T22:00:00'));
  const now=ms('2026-10-28T12:00:00'),d=dashboard(s,'week',now,now);
  assert.equal(d.current.foregroundMs,2*3600000);assert.equal(d.previous.foregroundMs,3600000);assert.equal(d.changeMs,3600000);assert.equal(d.comparable,true);
});
test('月份同期按已过时间比较，较短上月正确截断',()=>{
  const s=freshState();insert(s,ms('2026-02-28T20:00:00'),ms('2026-02-28T21:00:00'));insert(s,ms('2026-03-30T20:00:00'),ms('2026-03-30T22:00:00'));
  const now=ms('2026-03-31T23:00:00');const d=dashboard(s,'month',now,now);assert.equal(dayKey(d.previous.end),'2026-03-01');assert.equal(d.previous.foregroundMs,3600000);
});
test('热力图始终从周一开始，十二周共84格',()=>{
  const d=dashboard(freshState(),'week',base,base);assert.equal(d.heatmap.length,84);assert.equal(weekStart(dayStart(d.heatmap[0].date)),d.heatmap[0].date);
});
test('周报区分进行中和完整周，上期为零时百分比为null',()=>{
  const s=freshState();s.createdAt=dayStart('2026-10-19');insert(s,base,base+3600000);
  const report=buildWeeklyReport(s,'2026-10-26',base+2*3600000);assert.equal(report.period.complete,false);assert.equal(report.comparison.percent,null);assert.equal(report.comparison.comparable,false);assert.equal(report.daily.length,7);
  const complete=buildWeeklyReport(s,'2026-10-26',dayStart('2026-11-02'));assert.equal(complete.period.complete,true);assert.equal(complete.totals.foregroundMs,3600000);
  assert.throws(()=>buildWeeklyReport(s,'2026-10-27'));
});
test('下次启动补生成周报，固定入口不会被本周进度覆盖',t=>{
  const folder=temp(t),s=freshState();s.createdAt=dayStart('2026-10-19');insert(s,ms('2026-10-20T19:00:00'),ms('2026-10-20T20:00:00'));
  const now=dayStart('2026-11-03');const latest=autoReports(s,folder,now);assert.equal(latest.period.start,'2026-10-26');assert.equal(latest.period.complete,true);
  writeWeeklyReport(folder,buildWeeklyReport(s,'2026-11-02',now));
  const pointer=JSON.parse(fs.readFileSync(path.join(folder,'latest-week.json'),'utf8'));assert.equal(pointer.period.start,'2026-10-26');assert.ok(fs.existsSync(path.join(folder,'week-2026-10-19.md')));
  const content=fs.readFileSync(path.join(folder,'latest-week.json'),'utf8');autoReports(s,folder,now+60000);assert.equal(fs.readFileSync(path.join(folder,'latest-week.json'),'utf8'),content);
});
test('记录修订后，历史周报内容指纹会变化',()=>{
  const s=freshState();s.createdAt=dayStart('2026-10-19');insert(s,base,base+3600000);const before=buildWeeklyReport(s,'2026-10-26',dayStart('2026-11-02'));
  s.segments=[];s.sessions=[];const after=buildWeeklyReport(s,'2026-10-26',dayStart('2026-11-02'));assert.notEqual(before.contentHash,after.contentHash);assert.equal(after.totals.runningMs,0);
});
test('新安装不生成安装前的空白历史周报',t=>{const s=freshState();s.createdAt=base;assert.equal(autoReports(s,temp(t),base),null);});
test('恢复较晚开始采集的数据后，固定入口不遗留旧数据集的周报',t=>{
  const folder=temp(t),old=freshState();old.createdAt=dayStart('2026-10-19');autoReports(old,folder,base);assert.ok(fs.existsSync(path.join(folder,'latest-week.json')));
  const current=freshState();current.createdAt=base;autoReports(current,folder,base);assert.equal(fs.existsSync(path.join(folder,'latest-week.json')),false);assert.ok(fs.existsSync(path.join(folder,'week-2026-10-19.json')));
});
test('数据保存后重启，未结束记录按最后一次已保存时间结束',t=>{
  const dir=temp(t),store=new Store(dir),track=new Tracker(store.state);track.sample(sample(),base,0);track.sample(sample(),base+2000,2000);store.save();
  const reopened=new Store(dir);assert.equal(reopened.state.sessions[0].endedAt,base+2000);assert.equal(reopened.state.sessions[0].endReason,'上次运行中断');
});
test('数据损坏时保留损坏文件并自动恢复最近可用备份',t=>{
  const dir=temp(t),store=new Store(dir);insert(store.state,base,base+2000);store.save();store.backup('daily-2026-10-28');fs.writeFileSync(store.file,'{"broken":');
  const recovered=new Store(dir);assert.equal(recovered.state.sessions.length,1);assert.ok(recovered.warning);assert.ok(fs.readdirSync(dir).some(n=>n.includes('.damaged-')));
});
test('损坏且没有备份时不崩溃，并保留恢复提示',t=>{
  const dir=temp(t);fs.writeFileSync(path.join(dir,'playtime.json'),'invalid');const store=new Store(dir);assert.equal(store.state.sessions.length,0);assert.ok(store.warning);
});
test('备份导入拒绝重叠区间和超范围设置',()=>{
  const s=freshState();insert(s,base,base+5000);s.segments.push({...s.segments[0],start:base+2000});assert.throws(()=>validateState(s));
  assert.throws(()=>validateSettings({...freshState().settings,idleMinutes:0}));assert.throws(()=>validateSettings({...freshState().settings,processNames:[';Remove-Item']}));
});
test('休息提醒按活跃累计，离开五分钟后重新累计',()=>{
  const s=freshState().settings;s.breakMinutes=15;s.dailyBudgetMinutes=1440;const r=new Reminders();let result=[];
  for(let seconds=0;seconds<=902;seconds+=2)result.push(...r.check(sample(),s,0,base+seconds*1000));assert.equal(result.length,1);
  for(let seconds=904;seconds<=1210;seconds+=2)r.check(sample(true,false),s,0,base+seconds*1000);
  assert.equal(r.focusMs,0);assert.equal(r.nextBreak,1);
});
test('移除时间预算后不再产生预算通知',()=>{
  const settings=freshState().settings,r=new Reminders();assert.equal(r.check(sample(),settings,1440*60000,base).length,0);
});
test('关闭休息提醒后清空活跃累计',()=>{
  const settings=freshState().settings,r=new Reminders();r.focusMs=600000;settings.reminders=false;assert.deepEqual(r.check(sample(),settings,0,base),[]);assert.equal(r.focusMs,0);
});
