// services/pythonRunner.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function resolveDbPath() {
  return path.join(app.getPath('userData'), 'sys.db');
}
 
function resolvePythonRuntimeDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python-runtime');
  }
  const appPath = app.getAppPath();
  return path.join(appPath, 'python-runtime');
}

// ✅ NOVO: normaliza caminho vindo do renderer
function normalizeFilePath(v) {
  if (!v) return '';

  if (typeof v === 'string') return v;

  if (typeof v === 'object') {
    const p =
      v.filePath ||
      v.path ||
      (Array.isArray(v.filePaths) ? v.filePaths[0] : null) ||
      (Array.isArray(v.paths) ? v.paths[0] : null) ||
      '';

    return typeof p === 'string' ? p : '';
  }

  return '';
}

function resolveGfipTable(source) {
  const src = String(source || '').toLowerCase();
  if (src === 'gfip_anterior') return 'gfip_anterior';
  if (src === 'gfip_atual' || src === 'gfip') return 'gfip_atual';
  return '';
}

function runPythonImport({ source, pdfPath, onLine }) {
  return new Promise((resolve, reject) => {
    const src = String(source || '').toLowerCase();

    const scriptMap = {
      unimed: 'planounimed_cli.py',
      odontoprev: 'planoodonto_cli.py',
      uphealth: 'planoup_cli.py',
      up: 'planoup_cli.py',
      relverbas: 'relverbas_cli.py',
      rel_verbas: 'relverbas_cli.py',
      verbas: 'relverbas_cli.py',
      gfip: 'gfip_cli.py',
      gfip_atual: 'gfip_cli.py',
      gfip_anterior: 'gfip_cli.py'
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

    // ✅ AQUI: saneia antes de mexer com path
    const pdfNorm = normalizeFilePath(pdfPath);
    if (!pdfNorm) {
      return reject(new Error(`PDF inválido (vazio ou formato errado). Recebido: ${Object.prototype.toString.call(pdfPath)}`));
    }

    const pdfAbs = path.isAbsolute(pdfNorm) ? pdfNorm : path.resolve(pdfNorm);
    if (!fs.existsSync(pdfAbs)) {
      return reject(new Error(`PDF não encontrado: ${pdfAbs}`));
    }

    const dbPath = resolveDbPath();

    const args = ['-u', scriptPath, '--pdf', pdfAbs, '--db', dbPath];
    const gfipTable = resolveGfipTable(src);
    if (gfipTable) args.push('--table', gfipTable);

    let stderrAll = '';

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
