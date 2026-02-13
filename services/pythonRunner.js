// services/pythonRunner.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function resolveDbPath() {
  // sempre no userData (sem admin)
  return path.join(app.getPath('userData'), 'sys.db');
}

function resolvePythonRuntimeDir() {
  // ✅ Instalado: extraResources -> process.resourcesPath
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python-runtime');
  }

  // ✅ DEV: pega a raiz do app (bem mais confiável que __dirname)
  // Se seu main.js estiver em /app/main.js, app.getAppPath() tende a apontar pra /app
  // Ajuste se seu projeto for diferente.
  const appPath = app.getAppPath();
  return path.join(appPath, 'python-runtime');
}

function runPythonImport({ source, pdfPath, onLine }) {
  return new Promise((resolve, reject) => {
    const src = String(source || '').toLowerCase();

    const scriptMap = {
      unimed: 'planounimed_cli.py',
      odontoprev: 'planoodonto_cli.py',
      uphealth: 'planoup_cli.py',
      up: 'planoup_cli.py'
    };

    const scriptName = scriptMap[src];
    if (!scriptName) return reject(new Error(`Fonte não suportada: ${source}`));

    const basePython = resolvePythonRuntimeDir();
    const pythonExe = path.join(basePython, 'python.exe');
    const scriptPath = path.join(basePython, scriptName);

    if (!fs.existsSync(basePython)) {
      return reject(new Error(`Pasta python-runtime não encontrada: ${basePython}`));
    }
    if (!fs.existsSync(pythonExe)) {
      return reject(new Error(`Python embutido não encontrado: ${pythonExe}`));
    }
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script Python não encontrado: ${scriptPath}`));
    }

    const pdfAbs = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(pdfPath);
    if (!fs.existsSync(pdfAbs)) {
      return reject(new Error(`PDF não encontrado: ${pdfAbs}`));
    }

    const dbPath = resolveDbPath();

    // -u: stdout/stderr sem buffer (pra log em tempo real)
    const args = ['-u', scriptPath, '--pdf', pdfAbs, '--db', dbPath];

    let stderrAll = '';

    // ✅ AQUI era o bug: tem que ser spawn(...)
    const py = spawn(pythonExe, args, {
      cwd: basePython,
      windowsHide: true
    });

    py.stdout.on('data', (data) => {
      const txt = data.toString();
      txt.split(/\r?\n/).forEach((line) => line.trim() && onLine?.(line));
    });

    py.stderr.on('data', (data) => {
      const txt = data.toString();
      stderrAll += txt;
      txt.split(/\r?\n/).forEach((line) => line.trim() && onLine?.(`ERRO: ${line}`));
    });

    py.on('error', (err) => {
      reject(new Error(`Falha ao iniciar Python: ${err?.message || err}`));
    });

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `Python finalizou com código ${code} (${scriptName})\n\n` +
              `PythonDir: ${basePython}\n` +
              `PythonExe: ${pythonExe}\n` +
              `Script: ${scriptPath}\n` +
              `DB: ${dbPath}\n` +
              `PDF: ${pdfAbs}\n\n` +
              `STDERR:\n${stderrAll || '(vazio)'}`
          )
        );
      }
      resolve({ ok: true, script: scriptName });
    });
  });
}

module.exports = { runPythonImport };
