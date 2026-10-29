const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
class Monitor extends EventEmitter {
  constructor(processNames) { super(); this.names = processNames; this.child = null; this.stopped = false; this.restartTimer = null; this.watchdog = null; }
  start() {
    this.stopped = false;
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = path.join(__dirname, 'windows', 'monitor.ps1').replace('app.asar', 'app.asar.unpacked');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OW_TIME_PROCESSES: JSON.stringify(this.names) }
    });
    this.child = child;
    let buffer = '', lastSeen = Date.now(), emittedError = false;
    const fail = message => { if (!emittedError) { emittedError = true; this.emit('fault', message); } };
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) { buffer = ''; fail('监测输出异常，正在重试'); child.kill(); return; }
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary).trim(); buffer = buffer.slice(boundary + 1);
        if (!line) continue;
        try {
          const sample = JSON.parse(line);
          if (sample.error || typeof sample.running !== 'boolean' || typeof sample.foreground !== 'boolean' || !Number.isFinite(sample.idleSeconds) || sample.idleSeconds < 0) { fail('Windows 监测暂不可用，正在重试'); child.kill(); continue; }
          lastSeen = Date.now(); emittedError = false;
          this.emit('sample', sample);
        } catch { fail('无法解析监测结果，正在重试'); child.kill(); }
      }
    });
    child.stderr.on('data', () => fail('无法启动 Windows 监测组件，请检查系统 PowerShell 是否可用'));
    child.on('error', () => fail('Windows 监测组件无法启动'));
    child.on('close', () => {
      clearInterval(this.watchdog);
      if (this.child === child) this.child = null;
      if (!this.stopped) { fail('监测组件已中断，正在重新连接'); this.restartTimer = setTimeout(() => this.start(), 5000); }
    });
    this.watchdog = setInterval(() => { if (Date.now() - lastSeen > 15000) { fail('监测响应超时，正在重新连接'); child.kill(); } }, 5000);
  }
  stop() { this.stopped = true; clearTimeout(this.restartTimer); clearInterval(this.watchdog); this.child?.kill(); this.child = null; }
}
module.exports = { Monitor };
