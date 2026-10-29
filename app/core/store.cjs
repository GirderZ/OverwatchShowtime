const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULTS = Object.freeze({
  processNames: ['Overwatch'], idleMinutes: 5, reminders: true,
  breakMinutes: 90, dailyBudgetMinutes: 120, weeklyBudgetMinutes: 600,
  autoReports: true, reportFolder: '', launchAtLogin: false, closeToTray: true, theme: 'light'
});
function freshState() {
  return { schemaVersion: 1, createdAt: Date.now(), settings: { ...DEFAULTS, processNames: ['Overwatch'] }, sessions: [], segments: [], coverage: [], reminderBudgetDate: '' };
}
function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式不正确');
  const result = { ...DEFAULTS, ...input };
  const allowed = Object.keys(DEFAULTS);
  for (const key of Object.keys(result)) if (!allowed.includes(key)) delete result[key];
  if (!['light', 'dark'].includes(result.theme)) throw new Error('主题必须为浅色或深色');
  for (const key of ['reminders', 'autoReports', 'launchAtLogin', 'closeToTray']) {
    if (typeof result[key] !== 'boolean') throw new Error('设置开关必须为布尔值');
  }
  for (const [key, low, high] of [['idleMinutes', 1, 60], ['breakMinutes', 15, 480], ['dailyBudgetMinutes', 15, 1440], ['weeklyBudgetMinutes', 60, 10080]]) {
    if (!Number.isInteger(result[key]) || result[key] < low || result[key] > high) throw new Error('时间设置超出允许范围');
  }
  if (typeof result.reportFolder !== 'string' || result.reportFolder.length > 1000) throw new Error('周报目录不正确');
  if (!Array.isArray(result.processNames) || !result.processNames.length || result.processNames.length > 10 || result.processNames.some(n => typeof n !== 'string' || !/^[A-Za-z0-9_. -]{1,80}$/.test(n))) throw new Error('游戏进程名称不正确');
  result.processNames = [...new Set(result.processNames.map(n => n.replace(/\.exe$/i, '')))];
  return result;
}
function validateState(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.sessions) || !Array.isArray(data.segments)) throw new Error('不是兼容的屁股时间备份');
  if (data.sessions.length > 200000 || data.segments.length > 3000000) throw new Error('备份记录数量超出限制');
  const sessions = new Map();
  for (const s of data.sessions) {
    if (!s || typeof s.id !== 'string' || s.id.length > 100 || sessions.has(s.id) || !Number.isSafeInteger(s.startedAt) || s.startedAt < 0 || !Number.isSafeInteger(s.lastSeenAt) || s.lastSeenAt < s.startedAt || (s.endedAt !== null && (!Number.isSafeInteger(s.endedAt) || s.endedAt < s.startedAt)) || typeof s.note !== 'string' || s.note.length > 1000 || !['auto', 'manual', 'demo'].includes(s.source)) throw new Error('备份中的游玩记录无效');
    sessions.set(s.id, s);
  }
  let previousEnd = 0;
  for (const part of data.segments) {
    const session = sessions.get(part?.sessionId);
    if (!session || !Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) || part.start < session.startedAt || part.end > session.lastSeenAt || part.end <= part.start || part.start < previousEnd || typeof part.foreground !== 'boolean' || typeof part.idle !== 'boolean') throw new Error('备份中的时间区间无效或重叠');
    previousEnd = part.end;
  }
  const coverage = data.coverage || [];
  if (!Array.isArray(coverage) || coverage.length > 3000000) throw new Error('监测覆盖记录无效');
  previousEnd = 0;
  for (const c of coverage) {
    if (!Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end) || c.start < previousEnd || c.end <= c.start) throw new Error('监测覆盖区间无效');
    previousEnd = c.end;
  }
  return { schemaVersion: 1, createdAt: Number.isSafeInteger(data.createdAt) && data.createdAt >= 0 ? data.createdAt : Date.now(), settings: validateSettings(data.settings), sessions: data.sessions.map(s => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, lastSeenAt: s.lastSeenAt, source: s.source, note: s.note, endReason: String(s.endReason || '').slice(0, 100) })), segments: data.segments.map(s => ({ sessionId: s.sessionId, start: s.start, end: s.end, foreground: s.foreground, idle: s.idle })), coverage: coverage.map(c => ({ start: c.start, end: c.end })), reminderBudgetDate: typeof data.reminderBudgetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.reminderBudgetDate) ? data.reminderBudgetDate : '' };
}
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); }
  catch (error) { try { fs.unlinkSync(temp); } catch {} throw error; }
}
class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'playtime.json');
    this.warning = '';
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(this.file)) this.state = freshState();
    else {
      try { this.state = validateState(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
      catch (error) {
        const preserved = `${this.file}.damaged-${Date.now()}`;
        fs.copyFileSync(this.file, preserved);
        const backupDir = path.join(directory, 'backups');
        const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
        const latest = backups.filter(n => /^daily-.*\.json$/.test(n)).sort().reverse();
        for (const name of latest) {
          try { this.state = validateState(JSON.parse(fs.readFileSync(path.join(directory, 'backups', name), 'utf8'))); break; } catch {}
        }
        if (!this.state) this.state = freshState();
        this.warning = `数据文件异常，已保留原文件。${this.state.sessions.length ? '已恢复最近可用的本地备份。' : '请通过设置页恢复备份。'}`;
      }
    }
    for (const s of this.state.sessions) if (s.endedAt === null) { s.endedAt = s.lastSeenAt; s.endReason = '上次运行中断'; }
    this.save();
  }
  save() { atomicWrite(this.file, JSON.stringify(this.state)); }
  backup(tag) {
    const folder = path.join(this.directory, 'backups');
    const target = path.join(folder, `${tag}.json`);
    atomicWrite(target, JSON.stringify(this.state));
    if (tag.startsWith('daily-')) {
      const names = fs.readdirSync(folder).filter(n => /^daily-.*\.json$/.test(n)).sort().reverse();
      for (const name of names.slice(30)) fs.unlinkSync(path.join(folder, name));
    }
    return target;
  }
}
module.exports = { DEFAULTS, freshState, validateSettings, validateState, atomicWrite, Store };
