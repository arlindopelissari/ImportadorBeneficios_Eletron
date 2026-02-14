function setBusy(b) {
  $('btnPickXlsx').disabled = b;
  $('dismissMonths').disabled = b;
  updateImportButtonState();
}

function setEmpProgress(v, status) {
  $('empProg').value = v;
  if (status) $('empStatus').textContent = status;
}

async function refreshGrid() {
  const preview = await window.api.getEmployeesPreview(5000);
  renderTable('empTable', preview);
}

function clearPreview() {
  const host = $('empTable');
  if (!host) return;
  host.innerHTML = '<div class="muted" style="padding:10px;">Prévia limpa. Aguardando atualização...</div>';
}

function updateImportButtonState() {
  const isBusy = $('btnPickXlsx').disabled;
  const hasDismissRule = String($('dismissMonths').value || '').trim() !== '';
  $('btnImportXlsx').disabled = isBusy || !hasDismissRule;
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({ activePage: 'employees.html', pageTitle: 'Funcionários (XLSX)' });

  $('btnPickXlsx').addEventListener('click', async () => {
    const xlsxPath = await window.api.pickXlsx();
    if (xlsxPath) $('xlsxPath').value = xlsxPath;
  });

  $('btnImportXlsx').addEventListener('click', async () => {
    const xlsxPath = $('xlsxPath').value;
    const dismissMonths = String($('dismissMonths').value || '').trim();

    if (!xlsxPath) return alert('Selecione um XLSX.');
    if (!dismissMonths) return alert('Preencha Demitidos (meses).');

    setBusy(true);
    clearPreview();
    setEmpProgress(10, 'Importando...');

    try {
      const res = await window.api.importXlsx({ xlsxPath, dismissMonths });

      if (!res?.ok) throw new Error(res?.error || 'Falha na importação');

      alert('Importação concluída com sucesso.');
      await refreshGrid();
      setEmpProgress(100, 'Importação OK');
    } catch (e) {
      setEmpProgress(0, 'Erro');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('dismissMonths').addEventListener('change', updateImportButtonState);
  updateImportButtonState();

  refreshGrid().catch((e) => {
    setEmpProgress(0, 'Erro');
    alert(String(e?.message || e));
  });
});
