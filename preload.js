const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickXlsx: () => ipcRenderer.invoke('pick-xlsx'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
 
  getEmployeesPreview: (maxRows) => ipcRenderer.invoke('get-employees-preview', maxRows),
  getBenefitsPreview: (source, maxRows) => ipcRenderer.invoke('get-benefits-preview', source, maxRows),
  getDependentesPreview: (maxRows) => ipcRenderer.invoke('get-dependentes-preview', maxRows),
  getGfipPreview: (source, maxRows) => ipcRenderer.invoke('get-gfip-preview', source, maxRows),
  getValesAlimentacao: () => ipcRenderer.invoke('get-vales-alimentacao'),
  saveValeAlimentacao: (payload) => ipcRenderer.invoke('save-vale-alimentacao', payload),
  deleteValeAlimentacao: (idVale) => ipcRenderer.invoke('delete-vale-alimentacao', idVale),
  getCentrosCusto: () => ipcRenderer.invoke('get-centros-custo'),
  getValeCcustoVinculos: () => ipcRenderer.invoke('get-vale-ccusto-vinculos'),
  saveValeCcustoVinculo: (payload) => ipcRenderer.invoke('save-vale-ccusto-vinculo', payload),
  deleteValeCcustoVinculo: (ccusto) => ipcRenderer.invoke('delete-vale-ccusto-vinculo', ccusto),
  getFuncionariosApontamento: () => ipcRenderer.invoke('get-funcionarios-apontamento'),
  getValeApontamentos: () => ipcRenderer.invoke('get-vale-apontamentos'),
  saveValeApontamento: (payload) => ipcRenderer.invoke('save-vale-apontamento', payload),
  deleteValeApontamento: (cpf) => ipcRenderer.invoke('delete-vale-apontamento', cpf),
  getValeFaltas: () => ipcRenderer.invoke('get-vale-faltas'),
  clearValeFaltas: () => ipcRenderer.invoke('clear-vale-faltas'),
  saveValeFalta: (payload) => ipcRenderer.invoke('save-vale-falta', payload),
  deleteValeFalta: (cpf) => ipcRenderer.invoke('delete-vale-falta', cpf),
  openFaltasWindow: () => ipcRenderer.invoke('open-faltas-window'),
  openValeAjustesWindow: () => ipcRenderer.invoke('open-vale-ajustes-window'),

  importXlsx: (payload) => ipcRenderer.invoke('import-xlsx', payload),
  importPdf: (payload) => ipcRenderer.invoke('import-pdf', payload),
  deleteBenefitsBySource: (source) => ipcRenderer.invoke('delete-benefits-by-source', source),
  clearGfip: (source) => ipcRenderer.invoke('clear-gfip', source),
  exportGfipXlsx: (payload) => ipcRenderer.invoke('export-gfip-xlsx', payload),
  exportDependentesUnimed: () => ipcRenderer.invoke('export-dependentes-unimed'),
  importDependentesUnimed: () => ipcRenderer.invoke('import-dependentes-unimed'),

  dependenteDelete: (id) => ipcRenderer.invoke('dependente-delete', id),
  dependenteUpdateCpfResp: (payload) => ipcRenderer.invoke('dependente-update-cpfresp', payload),

  generateUnimedReport: () => ipcRenderer.invoke('generate-unimed-report'),
  generateValeReport: (payload) => ipcRenderer.invoke('generate-vale-report', payload),
  postReportActions: (filePath) => ipcRenderer.invoke('post-report-actions', filePath),
  openReportFile: (filePath) => ipcRenderer.invoke('open-report-file', filePath),
  openReportFolder: (filePath) => ipcRenderer.invoke('open-report-folder', filePath),

  onPythonLog: (cb) => {
    ipcRenderer.removeAllListeners('python-log');
    ipcRenderer.on('python-log', (_evt, line) => cb(line));
  }
});
