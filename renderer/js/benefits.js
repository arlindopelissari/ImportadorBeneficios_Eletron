function setBusy(isBusy) {
  $('btnPickPdf').disabled = isBusy;
  $('btnImportPdf').disabled = isBusy;
  $('btnDeletePlan').disabled = isBusy;
  $('planSource').disabled = isBusy;
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

async function refreshPlansGrid() {
  const source = $('planSource').value;
  const preview = await window.api.getBenefitsPreview(source, 5000);
  renderTable('planTable', preview);
}

async function generateUnimedReportFromMenu() {
  setBusy(true);
  setPlanProgress(5, 'Gerando relatório...');
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
      const reason = buildReportFailureMessage(res);

      if (preview && preview.rows?.length) {
        openPendenciasPopup(preview, reason);
        setPlanProgress(0, 'Pendências encontradas.');
        return;
      }

      setPlanProgress(0, 'Erro.');
      return alert(reason);
    }

    setPlanProgress(100, 'OK. Relatório gerado.');
    appendLog(`Relatório gerado: ${res.file}`);
    await handleReportSuccess(res.file);
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

  $('btnPickPdf').addEventListener('click', async () => {
    const p = await window.api.pickPdf();
    if (p) $('pdfPath').value = p;
  });

  $('planSource').addEventListener('change', async () => {
    $('log').value = '';
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

      setPlanProgress(75, 'Atualizando prévia...');
      await refreshPlansGrid();

      setPlanProgress(100, 'OK. PDF importado.');
    } catch (e) {
      setPlanProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('btnDeletePlan').addEventListener('click', async () => {
    const source = $('planSource').value;
    const sourceLabel = String(source || '').trim() || 'plano selecionado';

    const ok = confirm(`Deseja excluir todos os registros de ${sourceLabel}?`);
    if (!ok) return;

    setBusy(true);
    setPlanProgress(5, 'Excluindo registros...');
    try {
      const res = await window.api.deleteBenefitsBySource(source);
      if (!res?.ok) {
        setPlanProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao excluir registros do plano.');
      }

      await refreshPlansGrid();
      setPlanProgress(100, `OK. ${res.changes ?? 0} registro(s) excluído(s).`);
      appendLog(`Exclusão concluída em ${sourceLabel}: ${res.changes ?? 0} registro(s).`);
    } catch (e) {
      setPlanProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  refreshPlansGrid().catch(() => {});
});
