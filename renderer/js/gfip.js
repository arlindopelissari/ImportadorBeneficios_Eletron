function setBusy(isBusy) {
  $('btnPickPdf').disabled = isBusy;
  $('btnImportPdf').disabled = isBusy;
  $('btnClearGfip').disabled = isBusy;
  $('btnExportGfip').disabled = isBusy;
  $('gfipSource').disabled = isBusy;
}

function setGfipProgress(value, status) {
  $('gfipProg').value = value;
  if (status !== undefined) $('gfipStatus').textContent = status;
}

function appendLog(line) {
  const box = $('log');
  box.value += `${line ?? ''}\n`;
  box.scrollTop = box.scrollHeight;
}

async function refreshGfipGrid() {
  const source = $('gfipSource').value;
  const preview = await window.api.getGfipPreview(source, 5000);
  renderTable('gfipTable', preview);
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({
    activePage: 'gfip.html',
    pageTitle: 'GFIP (PDF)'
  });

  const reportMenu = $('reportMenuWrap');
  const dependentesMenu = $('depMenuWrap');
  if (reportMenu) reportMenu.style.display = 'none';
  if (dependentesMenu) dependentesMenu.style.display = 'none';

  window.api.onPythonLog((line) => appendLog(line));

  $('btnPickPdf').addEventListener('click', async () => {
    const filePath = await window.api.pickPdf();
    if (filePath) $('pdfPath').value = filePath;
  });

  $('gfipSource').addEventListener('change', async () => {
    setGfipProgress(0, 'Pronto');
    await refreshGfipGrid();
  });

  $('btnImportPdf').addEventListener('click', async () => {
    const pdfPath = $('pdfPath').value;
    const source = $('gfipSource').value;
    if (!pdfPath) return alert('Selecione um PDF.');

    $('log').value = '';
    setBusy(true);
    setGfipProgress(5, 'Rodando Python...');
    try {
      const res = await window.api.importPdf({ source, pdfPath });
      if (!res?.ok) {
        setGfipProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao importar GFIP.');
      }

      setGfipProgress(75, 'Atualizando prévia...');
      await refreshGfipGrid();
      setGfipProgress(100, 'OK. GFIP importada.');
    } catch (e) {
      setGfipProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('btnClearGfip').addEventListener('click', async () => {
    const source = $('gfipSource').value;
    const label = source === 'gfip_anterior' ? 'GFIP_ANTERIOR' : 'GFIP_ATUAL';
    const ok = confirm(`Deseja excluir todos os registros de ${label}?`);
    if (!ok) return;

    setBusy(true);
    setGfipProgress(5, 'Excluindo registros...');
    try {
      const res = await window.api.clearGfip(source);
      if (!res?.ok) {
        setGfipProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao limpar GFIP.');
      }

      await refreshGfipGrid();
      appendLog(`Exclusão concluída: ${res.changes ?? 0} registro(s).`);
      setGfipProgress(100, `OK. ${res.changes ?? 0} registro(s) excluído(s).`);
    } catch (e) {
      setGfipProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('btnExportGfip').addEventListener('click', async () => {
    setBusy(true);
    setGfipProgress(5, 'Exportando XLSX consolidado...');
    try {
      const res = await window.api.exportGfipXlsx();
      if (res?.canceled) {
        setGfipProgress(0, 'Cancelado.');
        return;
      }

      if (!res?.ok) {
        setGfipProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao exportar XLSX.');
      }

      appendLog(`Exportação concluída: ${res.file}`);
      appendLog(
        `GFIP_ANTERIOR: ${res.exportedAnterior ?? 0} registro(s) | ` +
        `GFIP_ATUAL: ${res.exportedAtual ?? 0} registro(s).`
      );
      setGfipProgress(
        100,
        `OK. GFIP_ANTERIOR: ${res.exportedAnterior ?? 0} | GFIP_ATUAL: ${res.exportedAtual ?? 0}.`
      );
      await handleReportSuccess(res.file);
    } catch (e) {
      setGfipProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  refreshGfipGrid().catch(() => {});
});
