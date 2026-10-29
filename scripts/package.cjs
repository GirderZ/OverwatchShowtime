const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
async function main() {
  const { packager } = await import('@electron/packager');
  const root = path.join(__dirname, '..');
  const offline = path.join(root, '..', 'electron-runtime');
  const archive = path.join(offline, 'electron-v45.1.0-win32-x64.zip');
  const checksums = require('electron/checksums.json');
  if (fs.existsSync(archive)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (actual !== checksums[path.basename(archive)]) throw new Error('Electron 运行时 SHA-256 校验失败');
    console.log('Electron Windows 运行时 SHA-256 校验通过');
  }
  const results = await packager({
    dir: root, out: path.join(root, 'dist'), name: 'OverwatchTime',
    executableName: 'OverwatchTime', platform: 'win32', arch: 'x64', electronVersion: '45.1.0', icon: path.join(root, 'assets', 'icon.ico'),
    win32metadata: { ProductName: '屁股时间', FileDescription: 'Overwatch Showtime', CompanyName: 'Personal Project' },
    overwrite: true, prune: true, appVersion: require('../package.json').version,
    asar: { unpack: '**/windows/**' },
    electronZipDir: fs.existsSync(archive) ? offline : undefined,
    ignore: [/^\/(test|scripts|dist|release|\.github|\.git)(\/|$)/, /^\/.*\.(zip|log)$/],
    download: { cacheRoot: path.join(root, '..', 'electron-cache'), checksums }
  });
  for (const folder of results) {
    fs.copyFileSync(path.join(root, 'README.md'), path.join(folder, '使用说明.md'));
    fs.writeFileSync(path.join(folder, '打开屁股时间.bat'), '@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0OverwatchTime.exe"\r\n', 'utf8');
    fs.writeFileSync(path.join(folder, '查看界面演示.bat'), '@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0OverwatchTime.exe" --demo\r\n', 'utf8');
    console.log(`Windows 应用已生成：${folder}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
