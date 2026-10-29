class Reminders {
  constructor(state = null) { this.state = state; this.lastAt = null; this.focusMs = 0; this.awaySince = null; this.nextBreak = 1;  }
  reset() { this.lastAt = null; this.focusMs = 0; this.nextBreak = 1; this.awaySince = null; }
  check(sample, settings, todayMs, now = Date.now()) {
    const results = [];
    if (!settings.reminders) { this.reset(); return results; }
    const active = sample.running && sample.foreground && sample.idleSeconds < settings.idleMinutes * 60;
    if (!active) {
      this.awaySince ??= now;
      if (now - this.awaySince >= 5 * 60000 || !sample.running) this.reset();
      this.lastAt = now;
    } else {
      const elapsed = this.lastAt === null ? 0 : now - this.lastAt;
      if (elapsed > 6500 || elapsed < 0) this.reset();
      else if (this.awaySince === null) this.focusMs += elapsed;
      this.awaySince = null;
      this.lastAt = now;
      if (this.focusMs >= settings.breakMinutes * 60000 * this.nextBreak) { results.push({ title: '休息一下，再继续守望', body: `已累计活跃游玩约 ${Math.floor(this.focusMs / 60000)} 分钟，起身活动一下吧。` }); this.nextBreak++; }
    }
    return results;
  }
}
module.exports = { Reminders };
