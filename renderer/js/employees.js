function setBusy(b) {
  $('btnPickXlsx').disabled = b;
  $('btnImportXlsx').disabled = b;
  $('dismissMonths').disabled = b;
}

function setEmpProgress(v, status) {
  $('empProg').value = v;
  if (status) $('empStatus').textContent = status;
}

async function refreshGrid() {
  const preview = await window.api.getEmployeesPreview(500);
  renderTable('empTable', preview);
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({ activePage: 'employees.html', pageTitle: 'Funcionarios (XLSX)' });

  $('btnPickXlsx').addEventListener('click', async () => {
    const xlsxPath = await window.api.pickXlsx();
    if (xlsxPath) $('xlsxPath').value = xlsxPath;
  });

  $('btnImportXlsx').addEventListener('click', async () => {
    const xlsxPath = $('xlsxPath').value;
    const dismissMonths = Number($('dismissMonths').value || 0);

    if (!xlsxPath) return alert('Selecione um XLSX.');

    setBusy(true);
    setEmpProgress(10, 'Importando...');

    try {
      const res = await window.api.importXlsx({ xlsxPath, dismissMonths });

      if (!res?.ok) throw new Error(res?.error || 'Falha na importacao');

      await refreshGrid();
      setEmpProgress(100, 'Importacao OK');
    } catch (e) {
      setEmpProgress(0, 'Erro');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  refreshGrid().catch((e) => {
    setEmpProgress(0, 'Erro');
    alert(String(e?.message || e));
  });
});
