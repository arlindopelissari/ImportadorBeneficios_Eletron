// main.js (CommonJS 100% — recomendado pra Electron com require)

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const XLSX = require('xlsx');

const {
  openDb,
  ensureSchema,
  clearBenefits,
  clearValeFaltas,
  clearGfip,
  clearRelVerbas,
  deleteBenefitsBySource,
  getEmployeesPreview,
  getBenefitsPreview,
  getDependentesPreview,
  getGfipPreview,
  getRelVerbasPreview,
  getRelVerbasRubricas,
  getRelVerbasExportRows,
  getGfipExportRows,
  getDependentesUnimedForExport,
  getValesAlimentacao,
  saveValeAlimentacao,
  deleteValeAlimentacao,
  getCentrosCusto,
  getValeCcustoVinculos,
  saveValeCcustoVinculo,
  deleteValeCcustoVinculo,
  getFuncionariosParaApontamento,
  getValeApontamentos,
  saveValeApontamento,
  deleteValeApontamento,
  getValeFaltas,
  saveValeFalta,
  deleteValeFalta,
  deleteDemitidos,
  repairPlanounimedIfNeeded,
  populateUnimedDependentesFromPlano,
  deleteDependenteById,
  updateCpfResponsavelById,
  importDependentesUnimedRows
} = require('./services/db');

const { importEmployeesXlsx } = require('./services/xlsxImporter');
const { runPythonImport } = require('./services/pythonRunner');
const { generateUnimedReport } = require('./services/unimedReport');
const { generateValeReport } = require('./services/valeReport');
const { createGfipWorkbook } = require('./services/gfipExport');
const { createRelVerbasWorkbook } = require('./services/relVerbasExport');
const { buildDefaultOutputNames } = require('./services/valeProcessor');

let mainWindow;
let faltasWindow;
let ajustesWindow;
let lastXlsxDir = null;
let lastPdfDir = null;
let lastDependentesDir = null;
let lastValeExportDir = null;
let lastGfipExportDir = null;
let lastRelVerbasExportDir = null;

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

  //mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'employees.html'));
}

function openFaltasWindow() {
  if (faltasWindow && !faltasWindow.isDestroyed()) {
    if (faltasWindow.isMinimized()) faltasWindow.restore();
    faltasWindow.focus();
    return;
  }

  faltasWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  faltasWindow.loadFile(path.join(__dirname, 'renderer', 'faltas.html'));
  faltasWindow.on('closed', () => {
    faltasWindow = null;
  });
}

function openValeAjustesWindow() {
  if (ajustesWindow && !ajustesWindow.isDestroyed()) {
    if (ajustesWindow.isMinimized()) ajustesWindow.restore();
    ajustesWindow.focus();
    return;
  }

  ajustesWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  ajustesWindow.loadFile(path.join(__dirname, 'renderer', 'ajustes.html'));
  ajustesWindow.on('closed', () => {
    ajustesWindow = null;
  });
}

// ============================
// App lifecycle
// ============================
app.whenReady().then(() => {
  debugPaths();
  lastXlsxDir = app.getPath('documents');
  lastPdfDir = app.getPath('documents');
  lastDependentesDir = app.getPath('documents');
  lastValeExportDir = app.getPath('documents');
  lastGfipExportDir = app.getPath('documents');
  lastRelVerbasExportDir = app.getPath('documents');

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
    title: 'Selecione a planilha de funcionários',
    defaultPath: lastXlsxDir || app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  lastXlsxDir = path.dirname(res.filePaths[0]);
  return res.filePaths[0];
});

ipcMain.handle('pick-pdf', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o arquivo PDF',
    defaultPath: lastPdfDir || app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  lastPdfDir = path.dirname(res.filePaths[0]);
  return res.filePaths[0];
});

// ============================
// Preview
// ============================
ipcMain.handle('get-employees-preview', async (_evt, maxRows = 5000) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getEmployeesPreview(db, maxRows);
  } finally {
    db.close(); 
  }
});

ipcMain.handle('get-benefits-preview', async (_evt, source, maxRows = 5000) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getBenefitsPreview(db, source, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-dependentes-preview', async (_evt, maxRows = 5000) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getDependentesPreview(db, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-gfip-preview', async (_evt, source, maxRows = 5000) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getGfipPreview(db, source, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-rel-verbas-preview', async (_evt, maxRows = 5000) => {
  const db = openDb();
  try {
    ensureSchema(db);
    return getRelVerbasPreview(db, maxRows);
  } finally {
    db.close();
  }
});

ipcMain.handle('get-rel-verbas-rubricas', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getRelVerbasRubricas(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
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
    const faltasDeleted = clearValeFaltas(db);
    const removed = deleteDemitidos(db, dismissMonths);

    return {
      ok: true,
      imported: result.importedRows,
      removed,
      benefitsDeleted,
      faltasDeleted
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
      `Relatório_Planos_${new Date().toISOString().replace(/:/g, '').slice(0, 19)}.xlsx`
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

ipcMain.handle('generate-vale-report', async (_evt, payload) => {
  let db;
  try {
    const mesReferencia = String(payload?.mesReferencia || '').trim();
    const valorTicket = Number(payload?.valorTicket);
    const valorComprocard = Number(payload?.valorComprocard);

    if (!mesReferencia) return { ok: false, error: 'Informe o mês de referência.' };
    if (!Number.isFinite(valorTicket) || valorTicket < 0) {
      return { ok: false, error: 'Valor Ticket inválido.' };
    }
    if (!Number.isFinite(valorComprocard) || valorComprocard < 0) {
      return { ok: false, error: 'Valor Comprocard inválido.' };
    }

    const folderPick = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a pasta de saída do Vale Alimentação',
      defaultPath: lastValeExportDir || app.getPath('documents'),
      properties: ['openDirectory']
    });

    if (folderPick.canceled || !folderPick.filePaths?.length) {
      return { ok: false, canceled: true };
    }

    const outputDir = folderPick.filePaths[0];
    lastValeExportDir = outputDir;
    const outFiles = buildDefaultOutputNames(outputDir, mesReferencia);

    db = openDb();
    ensureSchema(db);
    const result = await generateValeReport(db, {
      mesReferencia,
      valorTicket,
      valorComprocard,
      outComprocardPath: outFiles.comprocard,
      outTicketPath: outFiles.ticket
    });

    if (!result?.ok) return result;

    return {
      ...result,
      outputDir
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});

ipcMain.handle('delete-benefits-by-source', async (_evt, source) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteBenefitsBySource(db, source);
    return { ok: true, changes };
  } catch (e) {
    console.error('[delete-benefits-by-source] ERRO:', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('clear-gfip', async (_evt, source) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = clearGfip(db, source);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('clear-rel-verbas', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = clearRelVerbas(db);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('export-gfip-xlsx', async () => {
  let db;
  try {
    db = openDb();
    ensureSchema(db);

    const rowsAnterior = getGfipExportRows(db, 'gfip_anterior');
    const rowsAtual = getGfipExportRows(db, 'gfip_atual');
    if (!rowsAnterior.length && !rowsAtual.length) {
      return { ok: false, error: 'Não existem registros em GFIP_ANTERIOR ou GFIP_ATUAL para exportar.' };
    }

    const defaultPath = path.join(
      lastGfipExportDir || app.getPath('documents'),
      `GFIP_ANTERIOR_E_ATUAL_${new Date().toISOString().replace(/:/g, '').slice(0, 19)}.xlsx`
    );

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar GFIP_ANTERIOR + GFIP_ATUAL',
      defaultPath,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const { workbook, summary } = createGfipWorkbook({
      gfipAnteriorRows: rowsAnterior,
      gfipAtualRows: rowsAtual
    });
    XLSX.writeFile(workbook, res.filePath);

    lastGfipExportDir = path.dirname(res.filePath);
    return {
      ok: true,
      file: res.filePath,
      exportedAnterior: summary.GFIP_ANTERIOR.rowCount,
      exportedAtual: summary.GFIP_ATUAL.rowCount,
      summary
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});

ipcMain.handle('export-rel-verbas-xlsx', async (_evt, payload) => {
  let db;
  try {
    const codigos = Array.isArray(payload?.codigos) ? payload.codigos : [];

    db = openDb();
    ensureSchema(db);

    const rows = getRelVerbasExportRows(db, codigos);
    if (!rows.length) {
      return { ok: false, error: 'Não existem registros para os CÓD. VERBA selecionados.' };
    }

    const defaultPath = path.join(
      lastRelVerbasExportDir || app.getPath('documents'),
      `Relatorio_Verbas_${new Date().toISOString().replace(/:/g, '').slice(0, 19)}.xlsx`
    );

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Rel. Verbas',
      defaultPath,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const { workbook, exported } = createRelVerbasWorkbook(rows);
    XLSX.writeFile(workbook, res.filePath);

    lastRelVerbasExportDir = path.dirname(res.filePath);
    return {
      ok: true,
      file: res.filePath,
      exported,
      codigos: Array.from(new Set(codigos.map((code) => String(code || '').trim()).filter(Boolean)))
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});

ipcMain.handle('get-vales-alimentacao', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getValesAlimentacao(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('save-vale-alimentacao', async (_evt, payload) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = saveValeAlimentacao(db, payload);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('delete-vale-alimentacao', async (_evt, idVale) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteValeAlimentacao(db, idVale);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('get-centros-custo', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getCentrosCusto(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('get-vale-ccusto-vinculos', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getValeCcustoVinculos(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('save-vale-ccusto-vinculo', async (_evt, payload) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = saveValeCcustoVinculo(db, payload);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('delete-vale-ccusto-vinculo', async (_evt, ccusto) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteValeCcustoVinculo(db, ccusto);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('get-funcionarios-apontamento', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getFuncionariosParaApontamento(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('get-vale-apontamentos', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getValeApontamentos(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('save-vale-apontamento', async (_evt, payload) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = saveValeApontamento(db, payload);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('delete-vale-apontamento', async (_evt, cpf) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteValeApontamento(db, cpf);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('get-vale-faltas', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    return { ok: true, rows: getValeFaltas(db) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('clear-vale-faltas', async () => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = clearValeFaltas(db);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('save-vale-falta', async (_evt, payload) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = saveValeFalta(db, payload);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('open-faltas-window', async () => {
  try {
    openFaltasWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('open-vale-ajustes-window', async () => {
  try {
    openValeAjustesWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('delete-vale-falta', async (_evt, cpf) => {
  const db = openDb();
  try {
    ensureSchema(db);
    const changes = deleteValeFalta(db, cpf);
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    db.close();
  }
});

ipcMain.handle('post-report-actions', async (_evt, filePath) => {
  const target = String(filePath || '').trim();
  if (!target) return { ok: false, error: 'Arquivo do relatório inválido.' };

  const res = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Abrir arquivo', 'Abrir pasta', 'Fechar'],
    defaultId: 0,
    cancelId: 2,
    title: 'Relatório gerado',
    message: 'O que deseja fazer agora?',
    detail: target
  });

  try {
    if (res.response === 0) {
      const err = await shell.openPath(target);
      if (err) return { ok: false, error: err };
      return { ok: true, action: 'open-file' };
    }

    if (res.response === 1) {
      shell.showItemInFolder(target);
      return { ok: true, action: 'open-folder' };
    }

    return { ok: true, action: 'close' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('open-report-file', async (_evt, filePath) => {
  const target = String(filePath || '').trim();
  if (!target) return { ok: false, error: 'Arquivo do relatório inválido.' };

  try {
    const err = await shell.openPath(target);
    if (err) return { ok: false, error: err };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('open-report-folder', async (_evt, filePath) => {
  const target = String(filePath || '').trim();
  if (!target) return { ok: false, error: 'Arquivo do relatório inválido.' };

  try {
    shell.showItemInFolder(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

function normalizeImportHeader(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

ipcMain.handle('export-dependentes-unimed', async () => {
  let db;
  try {
    db = openDb();
    ensureSchema(db);
    const rows = getDependentesUnimedForExport(db);

    if (!rows.length) {
      return { ok: false, error: 'Não existem dependentes com cpfresponsável preenchido para exportar.' };
    }

    const defaultPath = path.join(
      lastDependentesDir || app.getPath('documents'),
      `Dependentes_Unimed_${new Date().toISOString().replace(/:/g, '').slice(0, 19)}.xlsx`
    );

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar dependentes Unimed',
      defaultPath,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'DependentesUnimed');
    XLSX.writeFile(wb, res.filePath);

    lastDependentesDir = path.dirname(res.filePath);
    return { ok: true, file: res.filePath, exported: rows.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});

ipcMain.handle('import-dependentes-unimed', async () => {
  let db;
  try {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar dependentes Unimed',
      defaultPath: lastDependentesDir || app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }]
    });

    if (pick.canceled || !pick.filePaths?.length) return { ok: false, canceled: true };

    const filePath = pick.filePaths[0];
    lastDependentesDir = path.dirname(filePath);

    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return { ok: false, error: 'Arquivo sem planilha.' };

    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });

    const normalizedRows = rawRows.map((r) => {
      const mapped = {};
      for (const [k, v] of Object.entries(r || {})) {
        mapped[normalizeImportHeader(k)] = String(v ?? '').trim();
      }
      return {
        beneficiario: mapped.beneficiario || mapped.nome || '',
        cpf: mapped.cpf || '',
        cpfresponsavel: mapped.cpfresponsavel || ''
      };
    });

    db = openDb();
    ensureSchema(db);

    const stats = importDependentesUnimedRows(db, normalizedRows);
    return { ok: true, ...stats, file: filePath };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { if (db) db.close(); } catch {}
  }
});

