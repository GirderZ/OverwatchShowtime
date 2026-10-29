const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { demoState } = require('../app/core/demo.cjs');
const { dashboard } = require('../app/core/analytics.cjs');
const { dayStart } = require('../app/core/time.cjs');
const { buildWeeklyReport, buildMonthlyReport } = require('../app/core/reports.cjs');
const { freshState, validateSettings } = require('../app/core/store.cjs');
const now = Date.parse('2026-10-29T21:35:00+08:00');
const state = demoState(now), emptyState = freshState();
emptyState.createdAt = now;
let paused = false;
const ui = path.join(__dirname, '..', 'app', 'ui');
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/command') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { json(res, 413, { error: '请求过大' }); return; } }
      const { name, input } = JSON.parse(body);
      if (name === 'pause') { paused = !paused; json(res, 200, { result: paused }); return; }
      if (name === 'settings') { state.settings = validateSettings({ ...state.settings, ...input, launchAtLogin: false, reportFolder: '' }); json(res, 200, { result: true }); return; }
      json(res, 400, { error: '文件操作请在 Windows 应用中使用' }); return;
    }
    if (url.pathname === '/api/state') {
      const period = ['day','week','month'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'day';
      const anchor = url.searchParams.get('anchor') ? dayStart(url.searchParams.get('anchor')) : now;
      const empty = url.searchParams.get('empty') === '1', chosen = empty ? emptyState : state;
      const hourText = url.searchParams.get('hour');
      const hour = hourText === null ? null : Number(hourText);
      chosen.settings = state.settings;
      json(res, 200, { version: require('../package.json').version, isDemo: true, platform: 'win32', settings: chosen.settings, data: dashboard(chosen, period, anchor, now, { hour }), status: { paused, running: false, foreground: false, monitorError: '', diskError: '', reportError: '', warning: '' }, paths: { data: 'C:\\Users\\Player\\AppData\\Roaming\\OverwatchTime\\data', reports: 'C:\\Users\\Player\\Documents\\OverwatchShowtime' }, latestReport: empty ? null : buildWeeklyReport(state, '2026-10-19', now), latestMonthlyReport: empty ? null : buildMonthlyReport(state, '2026-09-01', now), collectedSince: chosen.createdAt, now });
      return;
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html','style.css','renderer.js','chart-model.js'].includes(name)) { res.writeHead(404); res.end(); return; }
    const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[name.split('.').at(-1)] }); res.end(fs.readFileSync(path.join(ui, name)));
  } catch (error) { json(res, 400, { error: error.message }); }
}).listen(4318, '127.0.0.1', () => console.log('界面预览：http://127.0.0.1:4318/?demo=1'));
