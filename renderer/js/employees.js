let employeesPreview = { columns: [], rows: [] };

function setBusy(b) {
  $('btnPickXlsx').disabled = b;
  $('dismissMonths').disabled = b;
  updateImportButtonState();
}

function setEmpProgress(v, status) {
  $('empProg').value = v;
  if (status) $('empStatus').textContent = status;
}

function parseBrDateValue(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const dt = new Date(year, month, day);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function compareNullableDates(a, b) {
  if (a && b) return a.getTime() - b.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function sortEmployeesPreview(preview, sortBy) {
  if (!preview?.columns?.length || !Array.isArray(preview.rows)) return preview;

  const rows = [...preview.rows];
  const idxNome = preview.columns.indexOf('Nome');
  const idxAdmissao = preview.columns.indexOf('Admissao');

  if (sortBy === 'admissao' && idxAdmissao >= 0) {
    rows.sort((a, b) => {
      const byDate = compareNullableDates(parseBrDateValue(a[idxAdmissao]), parseBrDateValue(b[idxAdmissao]));
      if (byDate !== 0) return byDate;

      if (idxNome < 0) return 0;
      return String(a[idxNome] || '').localeCompare(String(b[idxNome] || ''), 'pt-BR', { sensitivity: 'base' });
    });
  } else if (idxNome >= 0) {
    rows.sort((a, b) =>
      String(a[idxNome] || '').localeCompare(String(b[idxNome] || ''), 'pt-BR', { sensitivity: 'base' })
    );
  }

  return {
    columns: preview.columns,
    rows
  };
}

function renderEmployeesPreview() {
  const sortBy = String($('empSortBy')?.value || 'nome').trim();
  renderTable('empTable', sortEmployeesPreview(employeesPreview, sortBy));
}

async function refreshGrid() {
  employeesPreview = await window.api.getEmployeesPreview(5000);
  renderEmployeesPreview();
}

function clearPreview() {
  const host = $('empTable');
  employeesPreview = { columns: [], rows: [] };
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
  $('empSortBy').addEventListener('change', renderEmployeesPreview);
  updateImportButtonState();

  refreshGrid().catch((e) => {
    setEmpProgress(0, 'Erro');
    alert(String(e?.message || e));
  });
});
