const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, Notification, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store, validateSettings, validateState, atomicWrite } = require('./core/store.cjs');
const { Tracker } = require('./core/tracker.cjs');
const { Monitor } = require('./monitor.cjs');
const { Reminders } = require('./core/reminders.cjs');
const { dashboard } = require('./core/analytics.cjs');
const { dayKey, dayStart, addDays, weekStart, periodRange } = require('./core/time.cjs');
const { buildWeeklyReport, buildMonthlyReport, writePeriodReport, autoReports, autoMonthlyReports } = require('./core/reports.cjs');
const { demoState } = require('./core/demo.cjs');

const isDemo = process.argv.includes('--demo');
app.setName('屁股时间');
// Reuse the original profile and lock so renaming never creates a second recorder.
app.setPath('userData', path.join(app.getPath('appData'), '守望时记'));
const APP_ID = 'local.overwatch-time.desktop';
const TOAST_CLSID = '{A7D521A8-EA13-40FA-AE6E-8F759237CB67}';
if (process.platform === 'win32') { app.setAppUserModelId(APP_ID); app.setToastActivatorCLSID(TOAST_CLSID); }
if (!app.requestSingleInstanceLock({ isDemo })) app.exit(0);
let win, tray, store, tracker, monitor, reminders, quitting = false;
let monitorError = '', diskError = '', reportError = '', blocked = false, suspended = false, latestReport = null;
let notificationWarning = '';
let latestMonthlyReport = null;
let saveTimer, maintenanceTimer, updateTimer;
function state() { return store.state; }
function reportFolder() { return state().settings.reportFolder || path.join(store.directory, 'reports'); }
function notify(title, body) {
  const fallback = () => { if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.displayBalloon({ title, content: body, iconType: 'info', respectQuietTime: true }); };
  if (Notification.isSupported()) {
    try {
    const notification = new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'icon.png') });
    notification.on('failed', fallback);
    notification.on('click', showWindow); notification.show();
    } catch { fallback(); }
  } else fallback();
}
function registerNotificationShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged || isDemo) return;
  try {
    const folder = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, '屁股时间.lnk');
    if (!shell.writeShortcutLink(file, 'create', { target: process.execPath, cwd: path.dirname(process.execPath), description: '守望先锋游戏时间记录与周报', icon: process.execPath, iconIndex: 0, appUserModelId: APP_ID, toastActivatorClsid: TOAST_CLSID })) throw new Error('shortcut');
  } catch { notificationWarning = 'Windows 通知注册未完成。请使用“测试通知”检查提醒；自动计时仍可使用。'; }
}
function changed() { if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('playtime:changed'); }
function persist() { try { store.save(); diskError = ''; } catch { diskError = '无法写入本地数据，请检查磁盘空间和文件夹权限。当前新记录尚未可靠保存。'; } }
function showWindow() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({ width: 1400, height: 960, minWidth: 1120, minHeight: 780, title: '屁股时间', backgroundColor: state().settings.theme === 'dark' ? '#151c28' : '#f1f3f6', icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (!quitting && state().settings.closeToTray) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; if (!state().settings.closeToTray && !quitting) app.quit(); });
}
function setTray() {
  if (!tray) { tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'))); tray.on('double-click', showWindow); tray.on('click', showWindow); }
  tray.setToolTip(`屁股时间 · ${tracker.paused ? '已暂停记录' : '自动记录中'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开仪表盘', click: showWindow },
    { label: tracker.paused ? '恢复自动记录' : '暂停自动记录', click: () => togglePause() },
    { label: '打开报表目录', click: () => openFolder(reportFolder()) },
    { type: 'separator' }, { label: '退出屁股时间', click: () => app.quit() }
  ]));
}
function togglePause() { tracker.reset(); tracker.paused = !tracker.paused; reminders.reset(); persist(); setTray(); changed(); return tracker.paused; }
function openFolder(folder) { fs.mkdirSync(folder, { recursive: true }); return shell.openPath(folder); }
function startMonitor() {
  monitor?.stop(); tracker.reset('监测组件重启');
  if (isDemo) { monitorError = ''; return; }
  if (process.platform !== 'win32') { monitorError = '自动计时需要 Windows；当前环境只可查看界面。'; return; }
  monitorError = '正在连接 Windows 游戏监测组件…';
  monitor = new Monitor(state().settings.processNames);
  monitor.on('fault', message => { monitorError = message; tracker.reset('监测中断'); reminders.reset(); persist(); changed(); });
  monitor.on('sample', sample => {
    monitorError = '';
    tracker.sample({ ...sample, blocked: blocked || suspended });
    if (!blocked && !suspended && !tracker.paused && !tracker.clockError) {
      for (const message of reminders.check(sample, state().settings, 0)) notify(message.title, message.body);
    }
    changed();
  });
  monitor.start();
}
function maintenance() {
  if (isDemo) return;
  try { persist(); store.backup(`daily-${dayKey(Date.now())}`); } catch { diskError = '自动备份失败，请检查磁盘空间或导出备份。'; }
  if (state().settings.autoReports) {
    try { latestReport = autoReports(state(), reportFolder()); latestMonthlyReport = autoMonthlyReports(state(), reportFolder()); reportError = ''; }
    catch { reportError = '周报写入失败，请在设置中检查周报目录。'; }
  }
}
function safeSender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('非法调用来源');
}
function viewInput(input = {}) {
  const period = ['day', 'week', 'month'].includes(input.period) ? input.period : 'day';
  const anchor = typeof input.anchor === 'string' ? dayStart(input.anchor) + 12 * 3600000 : Date.now();
  if (anchor < dayStart('2000-01-01') || anchor > Date.now() + 370 * 86400000) throw new Error('日期超出范围');
  const hour = period === 'day' && Number.isInteger(input.hour) && input.hour >= 0 && input.hour < 24 ? input.hour : null;
  return { period, anchor, hour };
}
function snapshot(input) {
  const { period, anchor, hour } = viewInput(input);
  return { version: app.getVersion(), isDemo, platform: process.platform, settings: state().settings, data: dashboard(state(), period, anchor, Date.now(), { hour }),
    status: { paused: tracker.paused, monitoring: !monitorError && !isDemo, running: !!tracker.lastSample?.running && !tracker.paused && !blocked && !suspended, foreground: !!tracker.lastSample?.foreground, blocked: blocked || suspended, monitorError, diskError, reportError, warning: [store.warning, notificationWarning].filter(Boolean).join(' '), clockError: tracker.clockError, sessionStartedAt: tracker.current?.startedAt || null, lastSampleAt: tracker.lastSample?.at || null },
    paths: { data: store.directory, reports: reportFolder() }, latestReport, latestMonthlyReport, collectedSince: state().createdAt, now: Date.now() };
}
function csvCell(value) { const text = String(value ?? ''); return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'; }
async function executeCommand(name, input) {
  if (name === 'pause') return togglePause();
  if (name === 'settings') {
    const previous = state().settings;
    const candidate = validateSettings({ ...previous, ...input, reportFolder: previous.reportFolder });
    if (candidate.launchAtLogin !== previous.launchAtLogin) {
      if (isDemo || process.platform !== 'win32' || !app.isPackaged) throw new Error('开机自启动需要在 Windows 正式应用中设置');
      app.setLoginItemSettings({ openAtLogin: candidate.launchAtLogin, path: process.execPath, args: ['--hidden'] });
      if (app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin !== candidate.launchAtLogin) throw new Error('Windows 未能保存开机启动设置');
    }
    if (previous.idleMinutes !== candidate.idleMinutes || JSON.stringify(previous.processNames) !== JSON.stringify(candidate.processNames)) tracker.reset('计时设置更新');
    if (previous.breakMinutes !== candidate.breakMinutes || previous.reminders !== candidate.reminders) reminders.reset();
    state().settings = candidate;
    nativeTheme.themeSource = candidate.theme;
    win?.setBackgroundColor(candidate.theme === 'dark' ? '#151c28' : '#f1f3f6');
    persist();
    if (JSON.stringify(previous.processNames) !== JSON.stringify(candidate.processNames)) startMonitor();
    setTray(); maintenance(); changed(); return true;
  }
  if (name === 'choose-report-folder') {
    const selected = await dialog.showOpenDialog(win, { title: '选择周报目录（可选已同步的文件夹）', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled) return null;
    const folder = selected.filePaths[0];
    // Prove write access before changing the saved folder.
    const probe = path.join(folder, `.playtime-write-test-${process.pid}`); atomicWrite(probe, 'ok'); fs.unlinkSync(probe);
    state().settings.reportFolder = folder; persist(); maintenance(); changed(); return folder;
  }
  if (name === 'open-data') return openFolder(store.directory);
  if (name === 'open-reports') return openFolder(reportFolder());
  if (name === 'export-week' || name === 'export-report') {
    if (isDemo) throw new Error('演示模式不能生成真实周报，请退出后运行正式模式');
    const type = input?.period === 'month' ? 'month' : 'week';
    const start = typeof input?.start === 'string' ? input.start : periodRange(type).key;
    dayStart(start);
    const report = type === 'month' ? buildMonthlyReport(state(), start) : buildWeeklyReport(state(), start);
    const file = writePeriodReport(reportFolder(), report, false);
    // Recompute the automation pointer so exporting an older week never replaces the latest one.
    latestReport = autoReports(state(), reportFolder());
    latestMonthlyReport = autoMonthlyReports(state(), reportFolder());
    shell.showItemInFolder(file); changed(); return file;
  }
  if (name === 'export-csv') {
    if (isDemo) throw new Error('演示数据不能导出为真实时间明细');
    const { period, anchor, hour } = viewInput(input);
    const range = periodRange(period, anchor);
    if (hour !== null) { range.start += hour * 3600000; range.end = range.start + 3600000; }
    const selected = await dialog.showSaveDialog(win, { title: '导出本周期的时间明细', defaultPath: `屁股时间-${range.key}.csv`, filters: [{ name: 'CSV 时间明细', extensions: ['csv'] }] });
    if (selected.canceled) return null;
    const rows = [['开始时间（北京时间）', '结束时间（北京时间）', '运行秒数', '前台秒数', '疑似无操作秒数', '记录编号']];
    const local = ms => new Date(ms + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    for (const part of state().segments) {
      const a = Math.max(range.start, part.start), b = Math.min(range.end, part.end);
      if (b <= a) continue;
      rows.push([local(a), local(b), (b-a)/1000, part.foreground ? (b-a)/1000 : 0, part.foreground && part.idle ? (b-a)/1000 : 0, part.sessionId]);
    }
    atomicWrite(selected.filePath, '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
    return selected.filePath;
  }
  if (name === 'backup') {
    if (isDemo) throw new Error('演示数据不能导出为真实备份');
    persist();
    const selected = await dialog.showSaveDialog(win, { title: '导出完整备份', defaultPath: `屁股时间-备份-${dayKey(Date.now())}.json`, filters: [{ name: '屁股时间备份', extensions: ['json'] }] });
    if (selected.canceled) return null;
    atomicWrite(selected.filePath, JSON.stringify(state(), null, 2)); return selected.filePath;
  }
  if (name === 'restore') {
    if (isDemo) throw new Error('请先退出演示模式');
    const selected = await dialog.showOpenDialog(win, { title: '选择屁股时间完整备份', filters: [{ name: '屁股时间备份', extensions: ['json'] }], properties: ['openFile'] });
    if (selected.canceled) return null;
    if (fs.statSync(selected.filePaths[0]).size > 150 * 1024 * 1024) throw new Error('备份文件过大');
    const restored = validateState(JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf8')));
    const confirmation = await dialog.showMessageBox(win, { type: 'question', title: '恢复备份', message: `将用备份中的 ${restored.sessions.length} 段游玩记录替换当前记录。`, detail: '当前数据会先保存为恢复前备份；周报目录和开机启动选项会保留当前设置。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    tracker.reset('恢复备份'); store.backup(`before-restore-${Date.now()}`);
    restored.settings.reportFolder = state().settings.reportFolder; restored.settings.launchAtLogin = state().settings.launchAtLogin;
    for (const s of restored.sessions) if (s.endedAt === null) { s.endedAt = s.lastSeenAt; s.endReason = '从备份恢复'; }
    monitor?.stop(); store.state = restored; tracker = new Tracker(state()); reminders = new Reminders(state());
    persist(); startMonitor(); setTray(); maintenance(); changed(); return true;
  }
  if (name === 'session-note') {
    const session = state().sessions.find(s => s.id === input?.id);
    if (!session || typeof input.note !== 'string' || input.note.length > 1000) throw new Error('备注不正确');
    session.note = input.note; persist(); changed(); return true;
  }
  if (name === 'delete-session') {
    const session = state().sessions.find(s => s.id === input?.id);
    if (!session) throw new Error('记录不存在');
    if (tracker.current?.id === session.id) throw new Error('请先暂停记录，再删除当前游玩段');
    const answer = await dialog.showMessageBox(win, { type: 'question', title: '删除游玩记录', message: '删除这段游玩记录及对应的时间统计？', detail: '删除前会自动保存一份本地备份。', buttons: ['取消', '删除记录'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return null;
    store.backup(`before-delete-${Date.now()}`);
    state().sessions = state().sessions.filter(s => s.id !== session.id); state().segments = state().segments.filter(s => s.sessionId !== session.id);
    persist(); maintenance(); changed(); return true;
  }
  if (name === 'test-notification') { notify('屁股时间 · 提醒已就绪', '休息提醒通过 Windows 通知显示。'); return true; }
  throw new Error('未知操作');
}

app.on('second-instance', () => showWindow());
app.whenReady().then(() => {
  const folder = path.join(app.getPath('appData'), 'OverwatchTime', isDemo ? 'demo' : 'data');
  store = new Store(folder);
  if (isDemo) store.state = demoState();
  nativeTheme.themeSource = state().settings.theme;
  tracker = new Tracker(state()); reminders = new Reminders(state());
  if (process.platform === 'win32' && app.isPackaged && !isDemo) {
    state().settings.launchAtLogin = app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin;
    blocked = powerMonitor.getSystemIdleState(state().settings.idleMinutes * 60) === 'locked';
  }
  ipcMain.handle('playtime:state', (event, input) => { safeSender(event); return snapshot(input); });
  ipcMain.handle('playtime:command', async (event, name, input) => { safeSender(event); return executeCommand(name, input); });
  registerNotificationShortcut(); createWindow(); setTray(); startMonitor(); maintenance();
  if (process.argv.includes('--hidden')) win.hide();
  for (const event of ['lock-screen', 'suspend']) powerMonitor.on(event, () => { if (event === 'suspend') suspended = true; else blocked = true; tracker.reset('锁屏或休眠'); reminders.reset(); persist(); changed(); });
  for (const event of ['unlock-screen', 'resume']) powerMonitor.on(event, () => { if (event === 'resume') suspended = false; else blocked = false; tracker.reset('恢复监测'); maintenance(); changed(); });
  saveTimer = setInterval(() => { if (!isDemo) persist(); }, 10000);
  maintenanceTimer = setInterval(maintenance, 60000);
  updateTimer = setInterval(changed, 10000);
}).catch(error => { dialog.showErrorBox('屁股时间无法启动', `无法初始化本地数据或应用组件。请检查文件夹权限与磁盘空间。\n\n${error.message}`); app.exit(1); });
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true; clearInterval(saveTimer); clearInterval(maintenanceTimer); clearInterval(updateTimer);
  monitor?.stop(); tracker?.reset('退出工具');
  if (store && !isDemo) { persist(); maintenance(); }
  tray?.destroy(); tray = null;
});
