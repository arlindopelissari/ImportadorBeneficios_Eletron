function setBusy(isBusy) {
  $('btnPickPdf').disabled = isBusy;
  $('btnImportPdf').disabled = isBusy;
  $('btnClearRelVerbas').disabled = isBusy;
  $('btnExportRelVerbas').disabled = isBusy;
}

function setRelVerbasProgress(value, status) {
  $('relVerbasProg').value = value;
  if (status !== undefined) $('relVerbasStatus').textContent = status;
}

function appendLog(line) {
  const box = $('log');
  box.value += `${line ?? ''}\n`;
  box.scrollTop = box.scrollHeight;
}

async function refreshRelVerbasGrid() {
  const preview = await window.api.getRelVerbasPreview(5000);
  renderTable('relVerbasTable', preview);
}

function renderRubricaOptions(rows) {
  const host = $('relVerbasRubricaList');
  const summary = $('relVerbasRubricaSummary');
  const items = Array.isArray(rows) ? rows : [];

  if (!items.length) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Nenhum CÓD. VERBA disponível para exportação.</div>';
    summary.textContent = 'Nenhum código encontrado.';
    return;
  }

  host.innerHTML = items.map((item, index) => {
    const cod = escapeHtml(item?.cod_verba ?? '');
    const desc = escapeHtml(item?.desc_verba ?? '');
    const total = Number(item?.total_registros ?? 0);
    return `
      <label class="rubrica-item">
        <input type="checkbox" class="relverbas-rubrica-check" value="${cod}" ${index < items.length ? 'checked' : ''} />
        <span>
          <span class="rubrica-item__code">${cod}</span>
          <span class="rubrica-item__desc">${desc || 'Sem descrição'}</span>
          <span class="rubrica-item__count">${total} registro(s)</span>
        </span>
      </label>
    `;
  }).join('');

  summary.textContent = `${items.length} código(s) disponível(is).`;
}

function getSelectedRubricas() {
  return Array.from(document.querySelectorAll('.relverbas-rubrica-check:checked'))
    .map((node) => String(node.value || '').trim())
    .filter(Boolean);
}

function setAllRubricasChecked(checked) {
  document.querySelectorAll('.relverbas-rubrica-check').forEach((node) => {
    node.checked = checked;
  });
}

function closeRubricasModal() {
  $('modalRelVerbasRubricas').style.display = 'none';
}

async function openRubricasModal() {
  const res = await window.api.getRelVerbasRubricas();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar os CÓD. VERBA.');
  if (!res.rows?.length) throw new Error('Não existem registros importados para exportar.');

  renderRubricaOptions(res.rows);
  $('modalRelVerbasRubricas').style.display = 'flex';
}

async function exportSelectedRubricas() {
  const codigos = getSelectedRubricas();
  if (!codigos.length) {
    return alert('Selecione ao menos um CÓD. VERBA para exportar.');
  }

  setBusy(true);
  setRelVerbasProgress(35, 'Exportando Excel...');
  try {
    const res = await window.api.exportRelVerbasXlsx({ codigos });
    if (res?.canceled) {
      setRelVerbasProgress(0, 'Cancelado.');
      return;
    }

    if (!res?.ok) {
      setRelVerbasProgress(0, 'Erro.');
      return alert(res?.error || 'Falha ao exportar Rel. Verbas.');
    }

    closeRubricasModal();
    appendLog(`Exportação concluída: ${res.file}`);
    appendLog(`CÓD. VERBA exportados: ${(res.codigos || []).join(', ')}`);
    setRelVerbasProgress(100, `OK. ${res.exported ?? 0} registro(s) exportado(s).`);
    await handleReportSuccess(res.file);
  } catch (e) {
    setRelVerbasProgress(0, 'Erro.');
    alert(String(e?.message || e));
  } finally {
    setBusy(false);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({
    activePage: 'relverbas.html',
    pageTitle: 'Rel. Verbas (PDF)'
  });

  const reportMenu = $('reportMenuWrap');
  const dependentesMenu = $('depMenuWrap');
  if (reportMenu) reportMenu.style.display = 'none';
  if (dependentesMenu) dependentesMenu.style.display = 'none';

  window.api.onPythonLog((line) => appendLog(line));

  $('btnSelectAllRubricas').addEventListener('click', () => setAllRubricasChecked(true));
  $('btnClearAllRubricas').addEventListener('click', () => setAllRubricasChecked(false));
  $('btnCloseRelVerbasModalTop').addEventListener('click', closeRubricasModal);
  $('btnCloseRelVerbasModalBottom').addEventListener('click', closeRubricasModal);
  $('btnConfirmExportRelVerbas').addEventListener('click', async () => {
    await exportSelectedRubricas();
  });
  $('modalRelVerbasRubricas').addEventListener('click', (evt) => {
    if (evt.target?.id === 'modalRelVerbasRubricas') closeRubricasModal();
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && $('modalRelVerbasRubricas').style.display !== 'none') {
      closeRubricasModal();
    }
  });

  $('btnPickPdf').addEventListener('click', async () => {
    const filePath = await window.api.pickPdf();
    if (filePath) $('pdfPath').value = filePath;
  });

  $('btnImportPdf').addEventListener('click', async () => {
    const pdfPath = $('pdfPath').value;
    if (!pdfPath) return alert('Selecione um PDF.');

    $('log').value = '';
    setBusy(true);
    setRelVerbasProgress(5, 'Rodando Python...');
    try {
      const res = await window.api.importPdf({ source: 'relverbas', pdfPath });
      if (!res?.ok) {
        setRelVerbasProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao importar Rel. Verbas.');
      }

      setRelVerbasProgress(85, 'Atualizando prévia...');
      await refreshRelVerbasGrid();
      appendLog('Prévia atualizada após a importação.');
      setRelVerbasProgress(100, 'OK. Rel. Verbas importado.');
    } catch (e) {
      setRelVerbasProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('btnClearRelVerbas').addEventListener('click', async () => {
    const ok = confirm('Deseja excluir todos os registros de Rel. Verbas?');
    if (!ok) return;

    setBusy(true);
    setRelVerbasProgress(5, 'Excluindo registros...');
    try {
      const res = await window.api.clearRelVerbas();
      if (!res?.ok) {
        setRelVerbasProgress(0, 'Erro.');
        return alert(res?.error || 'Falha ao limpar Rel. Verbas.');
      }

      await refreshRelVerbasGrid();
      appendLog(`Exclusão concluída: ${res.changes ?? 0} registro(s).`);
      setRelVerbasProgress(100, `OK. ${res.changes ?? 0} registro(s) excluído(s).`);
    } catch (e) {
      setRelVerbasProgress(0, 'Erro.');
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  });

  $('btnExportRelVerbas').addEventListener('click', async () => {
    setRelVerbasProgress(10, 'Carregando CÓD. VERBA...');
    try {
      await openRubricasModal();
      setRelVerbasProgress(15, 'Selecione os CÓD. VERBA para exportar.');
    } catch (e) {
      setRelVerbasProgress(0, 'Erro.');
      alert(String(e?.message || e));
    }
  });

  refreshRelVerbasGrid().catch(() => {});
});
