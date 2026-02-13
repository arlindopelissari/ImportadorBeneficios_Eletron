function setBusy(isBusy) {
  $('btnPickXlsx').disabled = isBusy;
  $('btnImportXlsx').disabled = isBusy;
  $('dismissMonths').disabled = isBusy;
}

function setEmpProgress(v, status) {
  $('empProg').value = v;
  if (status !== undefined) $('empStatus').textContent = status;
}

async function refreshEmployeesGrid() {
  const preview = await window.api.getEmployeesPreview(500);
  renderTable('empTable', preview);
}

window.addEventListener('DOMContentLoaded', () => {
  $('nav').innerHTML = navHtml('employees.html');

  $('btnPickXlsx').addEventListener('click', async () => {
    const p = await window.api.pickXlsx();
    if (p) $('xlsxPath').value = p;
  });

  $('btnImportXlsx').addEventListener('click', async () => {
    const xlsxPath = $('xlsxPath').value;
    const dismissMonths = Number($('dismissMonths').value || 0);

    if (!xlsxPath) return alert('Selecione um XLSX.');

    setBusy(true);
    setEmpProgress(5, 'Validando e importando XLSX...');
    try {
      const res = await window.api.importXlsx({ xlsxPath, dismissMonths });

      if (!res?.ok) {
        setEmpProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao importar XLSX.');
      }

      setEmpProgress(80, 'Atualizando prévia...');
      await refreshEmployeesGrid();

      setEmpProgress(100, `OK. Importado: ${res.imported} | Removidos: ${res.removed}`);
      alert(`Importação OK.

Benefícios apagados: ${res.benefitsDeleted}
Removidos (demitidos): ${res.removed}`);
    } catch (e) {
      setEmpProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  refreshEmployeesGrid().catch(() => {});
});
