function setBusy(isBusy) {
  $('btnPickPdf').disabled = isBusy;
  $('btnImportPdf').disabled = isBusy;
  $('planSource').disabled = isBusy;
  if (isBusy) setReportMenuEnabled(false);
}

function setPlanProgress(v, status) {
  $('planProg').value = v;
  if (status !== undefined) $('planStatus').textContent = status;
}

function appendLog(line) {
  const box = $('log');
  box.value += (line ?? '') + '\n';
  box.scrollTop = box.scrollHeight;
}

function rowsToPreviewLocal(rows) {
  if (!rows || rows.length === 0) return { columns: [], rows: [] };

  const preferred = ['beneficiario', 'cpf', 'cpf_func', 'total_valor'];
  const keys = Object.keys(rows[0]);

  const columns = [
    ...preferred.filter(c => keys.includes(c)),
    ...keys.filter(c => !preferred.includes(c)),
  ];

  return {
    columns,
    rows: rows.map(r => columns.map(c => (r?.[c] ?? '')))
  };
}

function openPendenciasModal(preview) {
  $('modalPendencias').style.display = 'flex';
  renderTable('modalPendenciasTable', preview);
}

function closePendenciasModal() {
  $('modalPendencias').style.display = 'none';
  $('modalPendenciasTable').innerHTML = '';
}

async function refreshPlansGrid() {
  const source = $('planSource').value;
  const preview = await window.api.getBenefitsPreview(source, 500);
  renderTable('planTable', preview);

  const hasRows = !!(preview && preview.rows && preview.rows.length > 0);
  const isUnimed = String(source || '').toLowerCase() === 'unimed';
  setReportMenuEnabled(isUnimed && hasRows);
}

async function generateUnimedReportFromMenu() {
  const source = $('planSource').value;
  if (String(source || '').toLowerCase() !== 'unimed') {
    return alert('Relatorio disponivel somente para Unimed (por enquanto).');
  }

  setBusy(true);
  setPlanProgress(5, 'Gerando relatorio...');
  try {
    const res = await window.api.generateUnimedReport();

    if (res?.canceled) {
      setPlanProgress(0, 'Cancelado.');
      return;
    }

    if (!res?.ok) {
      const preview =
        (res?.pendenciasPreview && res.pendenciasPreview.rows?.length) ? res.pendenciasPreview :
        (Array.isArray(res?.pendencias) && res.pendencias.length) ? rowsToPreviewLocal(res.pendencias) :
        null;

      if (preview && preview.rows?.length) {
        openPendenciasModal(preview);
        setPlanProgress(0, 'Pendencias encontradas.');
        return;
      }

      setPlanProgress(0, 'Erro.');
      return alert(res?.error || 'Falha ao gerar relatorio.');
    }

    setPlanProgress(100, 'OK. Relatorio gerado.');
    appendLog(`Relatorio gerado: ${res.file}`);
    alert(`Relatorio gerado:\n${res.file}`);
  } catch (e) {
    setPlanProgress(0, 'Erro.');
    alert(String(e?.message || e));
  } finally {
    setBusy(false);
    refreshPlansGrid().catch(() => {});
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({
    activePage: 'benefits.html',
    pageTitle: 'Planos (PDF)',
    onGenerateReport: generateUnimedReportFromMenu
  });

  window.api.onPythonLog((line) => appendLog(line));

  $('btnClosePendencias').addEventListener('click', closePendenciasModal);
  $('btnFecharPendencias').addEventListener('click', closePendenciasModal);

  $('modalPendencias').addEventListener('click', (e) => {
    if (e.target && e.target.id === 'modalPendencias') closePendenciasModal();
  });

  $('btnPickPdf').addEventListener('click', async () => {
    const p = await window.api.pickPdf();
    if (p) $('pdfPath').value = p;
  });

  $('planSource').addEventListener('change', async () => {
    try { await refreshPlansGrid(); } catch {}
  });

  $('btnImportPdf').addEventListener('click', async () => {
    const source = $('planSource').value;
    const pdfPath = $('pdfPath').value;

    if (!pdfPath) return alert('Selecione um PDF.');

    $('log').value = '';
    setBusy(true);
    setPlanProgress(5, 'Rodando Python...');
    try {
      const res = await window.api.importPdf({ source, pdfPath });

      if (!res?.ok) {
        setPlanProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao importar PDF.');
      }

      setPlanProgress(75, 'Atualizando previa...');
      await refreshPlansGrid();

      setPlanProgress(100, 'OK. PDF importado.');
    } catch (e) {
      setPlanProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  refreshPlansGrid().catch(() => {});
});
