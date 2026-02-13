// main.js (CommonJS 100% — recomendado pra Electron com require)

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const {
  openDb,
  ensureSchema,
  clearBenefits,
  getEmployeesPreview,
  getBenefitsPreview,
  getDependentesPreview,
  deleteDemitidos,
  repairPlanounimedIfNeeded,
  populateUnimedDependentesFromPlano,
  deleteDependenteById,
  updateCpfResponsavelById
} = require('./services/db');

const { importEmployeesXlsx } = require('./services/xlsxImporter');
const { runPythonImport } = require('./services/pythonRunner');
const { generateUnimedReport } = require('./services/unimedReport');

let mainWindow;

// ============================
// Paths (DEV vs PACKAGED)
// ============================
//
// Quando empacotado, tudo que você coloca em "extraResources"
// cai em: process.resourcesPath + "/<to>"
// Ex: process.resourcesPath + "/python-runtime"
//
function getAppBasePath() {
  // dev: .../app (ajuste conforme sua estrutura)
  // packaged: .../resources
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function getPythonRuntimeDir() {
  return path.join(getAppBasePath(), 'python-runtime');
}

// Exporta pra quem precisar (ex: pythonRunner pode importar main? não recomendo)
// Melhor: replique esse resolver dentro do pythonRunner.
// Mantendo aqui só pra debug rápido:
function debugPaths() {
  const base = getAppBasePath();
  const pyDir = getPythonRuntimeDir();
  console.log('[paths] isPackaged:', app.isPackaged);
  console.log('[paths] base:', base);
  console.log('[paths] python-runtime:', pyDir);
}

// ============================
// Window
// ============================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ============================
// App lifecycle
// ============================
app.whenReady().then(() => {
  debugPaths();

  const db = openDb();
  ensureSchema(db);
  db.close();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================
// Dialogs
// ============================
ipcMain.handle('pick-xlsx', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o XLSX de funcionários',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('pick-pdf', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o PDF de planos',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// ============================
// Preview
// ============================
ipcMain.handle('get-employees-preview', async (_evt, maxRows = 500) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getEmployeesPreview(db, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-benefits-preview', async (_evt, source, maxRows = 500) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getBenefitsPreview(db, source, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-dependentes-preview', async (_evt, maxRows = 500) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getDependentesPreview(db, maxRows);
  } finally {
    db.close();
  }
});

// ============================
// Dependentes - Manutenção
// ============================
ipcMain.handle('dependente-delete', async (_evt, id) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteDependenteById(db, id);
    return { ok: true, changes };
  } catch (e) {
    console.error('[dependente-delete] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('dependente-update-cpfresp', async (_evt, payload) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const { id, cpfresponsavel } = payload || {};
    const changes = updateCpfResponsavelById(db, id, cpfresponsavel);
    return { ok: true, changes };
  } catch (e) {
    console.error('[dependente-update-cpfresp] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

// ============================
// Import XLSX
// ============================
ipcMain.handle('import-xlsx', async (_evt, payload) => {
  const { xlsxPath, dismissMonths } = payload || {};

  const db = openDb();
  try {
    ensureSchema(db);

    const result = importEmployeesXlsx(db, xlsxPath);
    const benefitsDeleted = clearBenefits(db);
    const removed = deleteDemitidos(db, Number(dismissMonths || 0));

    return {
      ok: true,
      imported: result.importedRows,
      removed,
      benefitsDeleted
    };
  } catch (e) {
    console.error('[import-xlsx] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

// ============================
// Import PDF (Python)
// ============================
ipcMain.handle('import-pdf', async (evt, payload) => {
  const { source, pdfPath } = payload || {};

  const sendLog = (line) => {
    try {
      evt.sender.send('python-log', line);
    } catch {}
  };

  const src = String(source || '').toLowerCase();

  try {
    if (src === 'unimed') {
      const db = openDb();
      try {
        ensureSchema(db);
        repairPlanounimedIfNeeded(db);
      } finally {
        db.close();
      }
    }

    // Dica: se quiser, passe o pythonRuntimeDir aqui pra dentro do runner
    // ex: runPythonImport({ source, pdfPath, pythonRuntimeDir: getPythonRuntimeDir(), onLine: sendLog })
    const out = await runPythonImport({ source, pdfPath, onLine: sendLog });

    if (src === 'unimed') {
      const db = openDb();
      try {
        ensureSchema(db);
        const changes = populateUnimedDependentesFromPlano(db);
        sendLog(`Dependentes adicionados: ${changes}`);
      } finally {
        db.close();
      }
    }

    return { ok: true, result: out };
  } catch (e) {
    console.error('[import-pdf] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

// ============================
// Relatório Unimed (XLSX)
// ============================
ipcMain.handle('generate-unimed-report', async () => {
  let db;
  try {
    const defaultPath = path.join(
      app.getPath('documents'),
      `Relatorio_Unimed_CCusto_${new Date().toISOString().replace(/:/g, '').slice(0, 19)}.xlsx`
    );

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar relatório Unimed',
      defaultPath,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (res.canceled || !res.filePath) {
      return { ok: false, canceled: true };
    }

    db = openDb();
    ensureSchema(db);

    const hasPlano = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='planounimed'`)
      .get();

    if (!hasPlano) {
      return { ok: false, error: 'Tabela planounimed não existe. Importe o PDF da Unimed antes.' };
    }

    const out = await generateUnimedReport(db, res.filePath);
    return out;
  } catch (e) {
    console.error('[generate-unimed-report] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});
