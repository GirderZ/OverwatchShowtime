// Integration test of the actual main process, with OS/UI boundaries replaced by fakes.
// This verifies wiring and persistence, not Windows API behavior.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const {validateState}=require('../app/core/store.cjs');
test('桌面主进程：IPC来源检查、监测接线、导出备份、设置与恢复',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'playtime-desktop-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const handlers=new Map(),windows=[],monitors=[],trays=[];
  let login=false,saveFile=path.join(directory,'export.json'),openFile=saveFile;
  let fatal='';
  const app=new EventEmitter();
  Object.assign(app,{isPackaged:true,setName(){},setPath(){},setAppUserModelId(){},setToastActivatorCLSID(){},requestSingleInstanceLock:()=>true,getPath:()=>directory,getVersion:()=> '0.1.0',whenReady:()=>Promise.resolve(),getLoginItemSettings:()=>({openAtLogin:login}),setLoginItemSettings:settings=>{login=settings.openAtLogin;},quit(){this.emit('before-quit');},exit:code=>{fatal=`exit ${code}`;}});
  class FakeWindow extends EventEmitter{
    constructor(options){super();this.options=options;this.visible=true;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send(){},setWindowOpenHandler(){}});windows.push(this);}
    loadFile(){return Promise.resolve();}setBackgroundColor(value){this.background=value;}isDestroyed(){return false;}isVisible(){return this.visible;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}
  }
  class FakeTray extends EventEmitter{constructor(){super();trays.push(this);}setToolTip(){}setContextMenu(menu){this.menu=menu;}isDestroyed(){return false;}destroy(){}displayBalloon(data){this.balloon=data;}}
  class FakeMonitor extends EventEmitter{constructor(){super();monitors.push(this);}start(){this.started=true;}stop(){this.started=false;}}
  class FakeNotification extends EventEmitter{static isSupported(){return true;}show(){this.emit('failed');}}
  const powerMonitor=new EventEmitter();powerMonitor.getSystemIdleState=()=> 'active';
  const electron={app,BrowserWindow:FakeWindow,Tray:FakeTray,Notification:FakeNotification,powerMonitor,nativeTheme:{themeSource:'light'},Menu:{buildFromTemplate:template=>template},nativeImage:{createFromPath:p=>p},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async()=>({canceled:false,filePath:saveFile}),showOpenDialog:async()=>({canceled:false,filePaths:[openFile]}),showMessageBox:async()=>({response:1}),showErrorBox:(title,message)=>{fatal=`${title}: ${message}`;}},shell:{openPath:async()=>'',showItemInFolder(){},writeShortcutLink:()=>true}};
  const filename=path.resolve(__dirname,'../app/main.cjs');
  const localRequire=createRequire(filename);
  const context={require:name=>name==='electron'?electron:name==='./monitor.cjs'?{Monitor:FakeMonitor}:localRequire(name),__dirname:path.dirname(filename),process:{platform:'win32',argv:[],execPath:path.join(directory,'OverwatchTime.exe'),pid:process.pid},console,setInterval:()=>({}),clearInterval(){}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fatal,'');assert.equal(windows.length,1);assert.equal(monitors.length,1);assert.equal(monitors[0].started,true);
  assert.equal(windows[0].options.webPreferences.contextIsolation,true);assert.equal(windows[0].options.webPreferences.sandbox,true);
  const sender={sender:windows[0].webContents,senderFrame:windows[0].webContents.mainFrame};
  const invoke=(name,input)=>handlers.get('playtime:command')(sender,name,input);
  assert.throws(()=>handlers.get('playtime:state')({sender:{},senderFrame:{}},{}),/非法调用/);
  monitors[0].emit('sample',{running:true,foreground:true,idleSeconds:0});
  const liveStart=handlers.get('playtime:state')(sender,{}).status.sessionStartedAt;
  await invoke('settings',{theme:'dark'});
  assert.equal(handlers.get('playtime:state')(sender,{}).status.sessionStartedAt,liveStart);
  assert.equal(handlers.get('playtime:state')(sender,{}).settings.theme,'dark');
  assert.equal(electron.nativeTheme.themeSource,'dark');assert.equal(windows[0].background,'#151c28');
  await new Promise(resolve=>setTimeout(resolve,25));
  monitors[0].emit('sample',{running:false,foreground:false,idleSeconds:0});
  let result=handlers.get('playtime:state')(sender,{});
  assert.equal(result.status.monitorError,'');assert.equal(result.data.current.sessionCount,1);assert.ok(result.data.current.runningMs>0);
  const session=result.data.sessions[0];await invoke('session-note',{id:session.id,note:'integration note'});
  await invoke('backup');
  const saved=validateState(JSON.parse(fs.readFileSync(saveFile,'utf8')));assert.equal(saved.sessions[0].note,'integration note');
  await invoke('settings',{launchAtLogin:true,breakMinutes:60});assert.equal(login,true);
  await invoke('session-note',{id:session.id,note:'modified'});
  await invoke('restore');
  result=handlers.get('playtime:state')(sender,{});assert.equal(result.data.sessions[0].note,'integration note');assert.equal(result.settings.launchAtLogin,true);
  saveFile=path.join(directory,'export.csv');await invoke('export-csv',{});const csv=fs.readFileSync(saveFile,'utf8');assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('运行秒数'));assert.ok(csv.includes(session.id));
  const localHour=new Date(session.startedAt+8*3600000).getUTCHours();
  await invoke('export-csv',{hour:(localHour+2)%24});assert.equal(fs.readFileSync(saveFile,'utf8').includes(session.id),false);
  await invoke('test-notification');assert.ok(trays[0].balloon);assert.equal(trays[0].balloon.title,'屁股时间 · 提醒已就绪');
  await invoke('pause');assert.equal(handlers.get('playtime:state')(sender,{}).status.paused,true);
  app.quit();const state=validateState(JSON.parse(fs.readFileSync(path.join(directory,'OverwatchTime','data','playtime.json'),'utf8')));assert.equal(state.sessions.length,1);assert.equal(fatal,'');
});
