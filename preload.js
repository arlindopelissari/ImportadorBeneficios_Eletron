const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickXlsx: () => ipcRenderer.invoke('pick-xlsx'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),

  getEmployeesPreview: (maxRows) => ipcRenderer.invoke('get-employees-preview', maxRows),
  getBenefitsPreview: (source, maxRows) => ipcRenderer.invoke('get-benefits-preview', source, maxRows),
  getDependentesPreview: (maxRows) => ipcRenderer.invoke('get-dependentes-preview', maxRows),

  importXlsx: (payload) => ipcRenderer.invoke('import-xlsx', payload),
  importPdf: (payload) => ipcRenderer.invoke('import-pdf', payload),

  dependenteDelete: (id) => ipcRenderer.invoke('dependente-delete', id),
  dependenteUpdateCpfResp: (payload) => ipcRenderer.invoke('dependente-update-cpfresp', payload),

  generateUnimedReport: () => ipcRenderer.invoke('generate-unimed-report'),

  onPythonLog: (cb) => {
    ipcRenderer.removeAllListeners('python-log');
    ipcRenderer.on('python-log', (_evt, line) => cb(line));
  }
});
