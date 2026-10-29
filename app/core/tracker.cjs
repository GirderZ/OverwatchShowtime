const { randomUUID } = require('node:crypto');
class Tracker {
  constructor(state) { this.state = state; this.previous = null; this.current = null; this.paused = false; this.lastSample = null; this.clockError = false; }
  finish(reason, time) {
    if (this.current) {
      this.current.endedAt = Math.max(this.current.startedAt, time ?? this.current.lastSeenAt);
      this.current.endReason = reason;
    }
    this.current = null;
  }
  reset(reason = '记录暂停') { this.finish(reason); this.previous = null; this.lastSample = null; }
  sample(snapshot, time = Date.now(), monotonic = performance.now()) {
    this.lastSample = { ...snapshot, at: time };
    if (this.paused || snapshot.blocked) { this.reset(snapshot.blocked ? '锁屏或休眠' : '手动暂停'); return; }
    this.clockError = time < Math.max(this.state.segments.at(-1)?.end || 0, this.state.coverage.at(-1)?.end || 0);
    if (this.clockError) { this.finish('系统时间回拨'); this.previous = null; return; }
    if (this.previous) {
      const elapsed = time - this.previous.time;
      const monoElapsed = monotonic - this.previous.monotonic;
      const gap = elapsed <= 0 || elapsed > 6500 || Math.abs(elapsed - monoElapsed) > 2500;
      if (gap) this.finish('采样中断');
      else {
        const lastCoverage = this.state.coverage.at(-1);
        if (lastCoverage && lastCoverage.end === this.previous.time) lastCoverage.end = time;
        else this.state.coverage.push({ start: this.previous.time, end: time });
        if (this.previous.snapshot.running && this.current) {
        const part = { sessionId: this.current.id, start: this.previous.time, end: time, foreground: !!this.previous.snapshot.foreground, idle: this.previous.snapshot.idleSeconds >= this.state.settings.idleMinutes * 60 };
        const last = this.state.segments.at(-1);
        if (last && last.sessionId === part.sessionId && last.end === part.start && last.foreground === part.foreground && last.idle === part.idle) last.end = time;
        else this.state.segments.push(part);
        this.current.lastSeenAt = time;
        }
      }
    }
    if (snapshot.running && !this.current) {
      this.current = { id: randomUUID(), startedAt: time, lastSeenAt: time, endedAt: null, source: 'auto', note: '', endReason: '' };
      this.state.sessions.push(this.current);
    } else if (!snapshot.running) this.finish('游戏退出', time);
    this.previous = { snapshot, time, monotonic };
  }
}
module.exports = { Tracker };
