// Builds a self-contained folder with ChicolvenVitrina.exe (Node "single executable application").
// On Windows: `npm run empaquetar`. From Linux/macOS, `npm run empaquetar -- --windows` builds the
// Windows .exe too (downloads node.exe and the Windows builds of the native modules).
// Native modules (better-sqlite3, sharp) cannot live inside the executable, so they are copied
// next to it in node_modules/ and loaded from there.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32' || process.argv.includes('--windows');
const CROSS = WIN && process.platform !== 'win32';
const CACHE = path.join(ROOT, 'release', '.cache');
const NAME = 'ChicolvenVitrina';
const OUT = path.join(ROOT, 'release', NAME);
const WORK = path.join(ROOT, 'release', '.build');
const EXE = path.join(OUT, NAME + (WIN ? '.exe' : ''));
const NATIVE = ['better-sqlite3', 'sharp'];
// Install-time helpers that are not needed to run.
const SKIP_PACKAGES = new Set(['prebuild-install', 'node-gyp', 'node-addon-api']);
// Sources/build leftovers inside native packages.
const SKIP_DIRS = new Set(['deps', 'src', 'test', 'tests', 'docs', 'benchmark', '.github']);

const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('Se necesita Node.js 20 o superior para crear el ejecutable.');
  process.exit(1);
}

step('Compilando el panel');
run('npm run build -w @chicolven/admin');

step('Empaquetando el servidor');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
// Inside the executable `require` only knows Node built-ins: native modules are loaded from the
// node_modules folder next to the .exe.
const nativeFromDisk = {
  name: 'native-from-disk',
  setup(b) {
    b.onResolve({ filter: new RegExp(`^(${NATIVE.join('|')})$`) }, (args) => ({ path: args.path, namespace: 'native' }));
    b.onLoad({ filter: /.*/, namespace: 'native' }, (args) => ({
      contents: `const path = require('path');
const { createRequire } = require('module');
module.exports = createRequire(path.join(path.dirname(process.execPath), 'node_modules', '_'))(${JSON.stringify(args.path)});`,
      loader: 'js',
    }));
  },
};
const serverJs = path.join(WORK, 'server.cjs');
await build({
  entryPoints: [path.join(ROOT, 'apps/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: `node${major}`,
  format: 'cjs',
  outfile: serverJs,
  plugins: [nativeFromDisk],
  // Runs before anything else in the executable: catches errors while loading the native modules
  // (which happen before main() starts) and the classic mistake of running it inside the ZIP.
  banner: { js: fs.readFileSync(path.join(ROOT, 'scripts', 'sea-preamble.cjs'), 'utf8') },
  // config.ts only uses import.meta.url when CHICOLVEN_ROOT is missing (never in the package).
  define: { 'import.meta.url': '"file:///chicolven"' },
  logLevel: 'warning',
});

step('Creando el ejecutable');
const seaConfig = path.join(WORK, 'sea-config.json');
const blob = path.join(WORK, 'sea.blob');
fs.writeFileSync(seaConfig, JSON.stringify({ main: serverJs, output: blob, disableExperimentalSEAWarning: true }, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
fs.copyFileSync(CROSS ? await download(`https://nodejs.org/dist/${process.version}/win-x64/node.exe`, 'node.exe') : process.execPath, EXE);
// node.exe is signed by the Node.js project. Injecting the app breaks that signature and Windows
// (SmartScreen / Defender) blocks executables with a corrupted signature, so remove it first.
if (WIN) stripAuthenticode(EXE);
const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(
  process.execPath,
  [postject, EXE, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'],
  { stdio: 'inherit' },
);

step('Copiando páginas web');
fs.cpSync(path.join(ROOT, 'apps/player/public'), path.join(OUT, 'web/player'), { recursive: true });
fs.cpSync(path.join(ROOT, 'apps/admin/dist'), path.join(OUT, 'web/admin'), { recursive: true });

step('Copiando módulos nativos (SQLite, imágenes)');
const copied = new Set();
// Platform-specific sharp builds: only the target's (cross builds add the Windows one below).
const otherPlatform = (name) => CROSS && /^@img\/sharp-(libvips-)?/.test(name);
function copyPackage(name, fromDir) {
  if (copied.has(name) || SKIP_PACKAGES.has(name) || otherPlatform(name)) return;
  // Resolve like Node: nested node_modules first, then the root one.
  const candidates = [path.join(fromDir, 'node_modules', name), path.join(ROOT, 'node_modules', name)];
  const src = candidates.find((c) => fs.existsSync(path.join(c, 'package.json')));
  if (!src) return; // optional dependency for another platform
  copied.add(name);
  fs.cpSync(src, path.join(OUT, 'node_modules', name), {
    recursive: true,
    filter: (p) => !SKIP_DIRS.has(path.basename(p)) || path.dirname(p) !== src,
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copyPackage(dep, src);
}
for (const name of NATIVE) copyPackage(name, ROOT);
if (CROSS) {
  // better-sqlite3: replace the compiled addon with the official Windows build for this Node ABI.
  const bsq = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/better-sqlite3/package.json'), 'utf8')).version;
  const abi = process.versions.modules;
  const tgz = await download(
    `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsq}/better-sqlite3-v${bsq}-node-v${abi}-win32-x64.tar.gz`,
    `better-sqlite3-${bsq}-${abi}-win.tar.gz`,
  );
  const dest = path.join(OUT, 'node_modules/better-sqlite3');
  fs.rmSync(path.join(dest, 'build'), { recursive: true, force: true });
  execFileSync('tar', ['-xzf', tgz, '-C', dest]);
  // sharp: the Windows package (libvips DLLs included), same version sharp expects.
  const sharpPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/sharp/package.json'), 'utf8'));
  const winPkg = '@img/sharp-win32-x64';
  const ver = sharpPkg.optionalDependencies[winPkg];
  execSync(`npm pack ${winPkg}@${ver} --pack-destination "${CACHE}"`, { cwd: CACHE, stdio: 'ignore' });
  const winTgz = path.join(CACHE, `img-sharp-win32-x64-${ver}.tgz`);
  const winDest = path.join(OUT, 'node_modules', winPkg);
  fs.mkdirSync(winDest, { recursive: true });
  execFileSync('tar', ['-xzf', winTgz, '-C', winDest, '--strip-components=1']);
  copied.add(`${winPkg} (Windows)`);
}
console.log(`  ${[...copied].join(', ')}`);

step('Agregando lanzadores y configuración');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n'); // Windows line endings for .bat/.ini
const files = {
  'config.ini': `# Configuración de Chicolven Vitrina. Reinicie el programa después de cambiarla.

# Puerto web. Con 80 las direcciones no llevan ":3000" (solo si ningún otro programa,
# como Laragon/Apache o IIS, usa el puerto 80 en este PC).
PORT=3000

# Nombre en la red local: los televisores abren http://chicolven.local:3000
NOMBRE=chicolven

# Abrir el panel en el navegador al iniciar (si/no)
ABRIR_PANEL=si

# Carpeta de datos (base de datos, imágenes, respaldos). Relativa a esta carpeta.
DATA=data
`,
  'Iniciar Chicolven.bat': `@echo off
REM Inicia Chicolven Vitrina y lo vuelve a abrir si se cierra por un error.
REM "Iniciar Chicolven.bat /auto" (usado al encender el PC) no abre el panel en el navegador.
cd /d "%~dp0"
title Chicolven Vitrina
if /i "%~1"=="/auto" set CHICOLVEN_NO_BROWSER=1
:loop
"%~dp0${NAME}.exe"
echo.
echo El programa se detuvo. Se reiniciara en 5 segundos (cierre esta ventana para salir)...
set CHICOLVEN_NO_BROWSER=1
timeout /t 5 /nobreak >nul
goto loop
`,
  'Abrir TV en este PC.bat': `@echo off
REM Abre una pantalla en modo kiosko (pantalla completa) en un monitor o TV conectado por HDMI.
REM Uso: "Abrir TV en este PC.bat" 1        -> TV 1 en el monitor principal
REM      "Abrir TV en este PC.bat" 2 1920   -> TV 2 en el segundo monitor (a la derecha)
setlocal
cd /d "%~dp0"
set SCREEN=%1
if "%SCREEN%"=="" set /p SCREEN=Numero de pantalla a abrir (1, 2, 3...):
if "%SCREEN%"=="" set SCREEN=1
set POSX=%2
if "%POSX%"=="" set POSX=0
set PORT=3000
for /f "tokens=2 delims==" %%a in ('findstr /b /i "PORT=" config.ini') do set PORT=%%a
set BROWSER="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
if not exist %BROWSER% set BROWSER="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
start "" %BROWSER% --kiosk "http://localhost:%PORT%/tv/%SCREEN%" --edge-kiosk-type=fullscreen ^
  --user-data-dir="%LOCALAPPDATA%\\ChicolvenKiosko\\tv%SCREEN%" --window-position=%POSX%,0 ^
  --no-first-run --disable-extensions --disable-translate --autoplay-policy=no-user-gesture-required ^
  --ignore-gpu-blocklist --enable-gpu-rasterization --noerrdialogs --disable-session-crashed-bubble
`,
  'Instalar inicio automatico.bat': `@echo off
REM Hace que Chicolven Vitrina arranque solo (minimizado) al encender el PC.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell; $p = [Environment]::GetFolderPath('Startup');" ^
  "$s = $w.CreateShortcut($p + '\\Chicolven Vitrina.lnk'); $s.TargetPath = '%~dp0Iniciar Chicolven.bat'; $s.Arguments = '/auto';" ^
  "$s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.IconLocation = '%~dp0${NAME}.exe,0'; $s.Save()"
echo.
set /p TV=Este PC tiene un televisor por HDMI? Escriba el numero de pantalla para abrirla al iniciar (o Enter para omitir):
if "%TV%"=="" goto done
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell; $p = [Environment]::GetFolderPath('Startup');" ^
  "$s = $w.CreateShortcut($p + '\\Chicolven TV %TV%.lnk'); $s.TargetPath = '%~dp0Abrir TV en este PC.bat'; $s.Arguments = '%TV%';" ^
  "$s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Save()"
:done
echo.
echo Listo. Chicolven Vitrina se abrira solo al encender el PC.
pause
`,
  'Quitar inicio automatico.bat': `@echo off
powershell -NoProfile -Command "Get-ChildItem ([Environment]::GetFolderPath('Startup')) -Filter 'Chicolven*.lnk' | Remove-Item"
echo Listo: Chicolven Vitrina ya no arranca solo.
pause
`,
  'LEEME.txt': `CHICOLVEN VITRINA
=================

1. Doble clic en "Iniciar Chicolven.bat" (o en ${NAME}.exe).
   La primera vez Windows pregunta por el Firewall: marque "Redes privadas" y "Permitir acceso",
   si no, los televisores no podran conectarse.
2. Se abre el panel: http://localhost:3000/admin/  (PIN inicial: 1234, cambielo en Sistema).
3. En el navegador de cada televisor abra:
       http://chicolven.local:3000/1     (pantalla 1; /2 para la 2, etc.)
   o solo http://chicolven.local:3000 para elegir la pantalla con el control.
   Si un televisor no abre "chicolven.local", use la IP de este PC (aparece en la ventana negra
   y en el panel > Sistema), por ejemplo http://192.168.1.20:3000/1
4. Para que arranque solo al encender el PC: doble clic en "Instalar inicio automatico.bat".
5. Televisor conectado por HDMI a este PC: "Abrir TV en este PC.bat".

- No cierre la ventana negra: es el programa. Se puede minimizar.
- Los datos (productos, precios, imagenes, respaldos) estan en la carpeta "data".
  Para actualizar el programa, reemplace todo MENOS la carpeta "data" y config.ini.
- Configuracion (puerto, nombre en la red): config.ini
`,
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), crlf(content));

fs.rmSync(WORK, { recursive: true, force: true });
if (!WIN) for (const f of Object.keys(files)) if (f.endsWith('.bat')) fs.rmSync(path.join(OUT, f));
const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`\n✔ Listo: ${OUT}  (${(size(OUT) / 1048576).toFixed(0)} MB)`);
console.log('  Copie esa carpeta completa al PC de la tienda (sin la carpeta "data" de pruebas).');

/** Downloads a file once into release/.cache (re-used on the next build). */
async function download(url, name) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return file;
  console.log(`  descargando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Removes the Authenticode signature from a PE file (same as `signtool remove /s`): the
 * certificate table sits at the end of the file and is referenced by the "security" data
 * directory. Without it the .exe is simply unsigned instead of "tampered".
 */
function stripAuthenticode(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error(`${file} no es un ejecutable de Windows`);
  const opt = pe + 24;
  const isPE32Plus = buf.readUInt16LE(opt) === 0x20b;
  const securityDir = opt + (isPE32Plus ? 112 : 96) + 4 * 8;
  const offset = buf.readUInt32LE(securityDir);
  const size = buf.readUInt32LE(securityDir + 4);
  if (!offset || !size) return;
  if (offset + size !== buf.length) throw new Error('La firma no está al final del ejecutable; no se puede quitar');
  buf.writeUInt32LE(0, securityDir);
  buf.writeUInt32LE(0, securityDir + 4);
  buf.writeUInt32LE(0, opt + 64); // PE checksum: not required for .exe files
  fs.writeFileSync(file, buf.subarray(0, offset));
  console.log('  firma original de node.exe quitada (el programa queda sin firmar)');
}
