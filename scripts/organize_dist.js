const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function organize() {
  const rootDir = path.resolve('.');
  const releaseDir = path.join(rootDir, 'release');
  const unpackedDir = path.join(releaseDir, 'win-unpacked');
  const targetDir = path.join(releaseDir, 'Поисковик торрентов');
  const appSubDir = path.join(targetDir, 'app');
  const launcherCs = path.join(rootDir, 'scripts', 'Launcher.cs');
  const iconIco = path.join(rootDir, 'build', 'icon.ico');

  if (!fs.existsSync(unpackedDir)) {
    console.log('win-unpacked does not exist, nothing to organize.');
    return;
  }

  // 1. Prepare targetDir
  if (fs.existsSync(targetDir)) {
    console.log('Removing old unpacked directory:', targetDir);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(appSubDir, { recursive: true });

  // 2. Move all files from win-unpacked to appSubDir
  const items = fs.readdirSync(unpackedDir);
  for (const item of items) {
    const src = path.join(unpackedDir, item);
    const dest = path.join(appSubDir, item);
    fs.renameSync(src, dest);
  }
  fs.rmSync(unpackedDir, { recursive: true, force: true });
  console.log('Moved all files into:', appSubDir);

  // 3. Compile Launcher directly in targetDir
  const launcherExe = path.join(targetDir, 'Поисковик торрентов.exe');
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

  console.log('Compiling launcher executable with icon...');
  const compileCmd = `"${cscPath}" /target:winexe /win32icon:"${iconIco}" /out:"${launcherExe}" "${launcherCs}"`;
  execSync(compileCmd, { stdio: 'inherit' });
  console.log('Launcher successfully created:', launcherExe);

  // 4. Remove debug files
  const debugYml = path.join(releaseDir, 'builder-debug.yml');
  if (fs.existsSync(debugYml)) {
    fs.unlinkSync(debugYml);
  }

  console.log('Done! "release/Поисковик торрентов" is structured cleanly.');
}

try {
  organize();
} catch (err) {
  console.error('Error organizing dist:', err);
  process.exit(1);
}
