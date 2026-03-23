function setProcessamentoStatus(status) {
  const el = $('processamentoValeStatus');
  if (el) el.textContent = status;
}

function parseMoney(value) {
  const raw = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

window.addEventListener('DOMContentLoaded', () => {
  async function generateValeFiles() {
    const mesReferencia = String($('mesReferenciaVale').value || '').trim();
    const valorTicket = parseMoney($('valorTicketProcessamento').value);
    const valorComprocard = parseMoney($('valorComprocardProcessamento').value);

    if (!mesReferencia) return alert('Informe o mês de referência.');
    if (!Number.isFinite(valorTicket) || valorTicket < 0) return alert('Informe um valor Ticket válido.');
    if (!Number.isFinite(valorComprocard) || valorComprocard < 0) return alert('Informe um valor Comprocard válido.');

    setProcessamentoStatus('Gerando...');
    const res = await window.api.generateValeReport({
      mesReferencia,
      valorTicket,
      valorComprocard
    });

    if (res?.canceled) {
      setProcessamentoStatus('Cancelado');
      return;
    }

    if (!res?.ok) {
      setProcessamentoStatus('Erro');
      return alert(res?.error || 'Falha ao gerar arquivos de vale.');
    }

    setProcessamentoStatus('OK');

    const resumo = res.resumo || {};
    const descartados = Array.isArray(res.resumoDescartados) && res.resumoDescartados.length > 0
      ? '\n\nDescartados:\n' + res.resumoDescartados.map((r) => `${r.total}x ${r.motivo}`).join('\n')
      : '';

    alert(
      'Arquivos gerados com sucesso.\n\n' +
      `COMPROCARD: ${res.comprocardFile || ''}\n` +
      `TICKET: ${res.ticketFile || ''}\n\n` +
      `Ticket: ${resumo.totalTicket || 0} registro(s) | R$ ${(resumo.valorTotalTicket || 0).toFixed(2)}\n` +
      `Comprocard: ${resumo.totalComprocard || 0} registro(s) | R$ ${(resumo.valorTotalComprocard || 0).toFixed(2)}` +
      descartados
    );
  }

  async function openFaltas() {
    const res = await window.api.openFaltasWindow();
    if (!res?.ok) {
      alert(res?.error || 'Falha ao abrir a janela de faltas.');
    }
  }

  async function openAjustes() {
    const res = await window.api.openValeAjustesWindow();
    if (!res?.ok) {
      alert(res?.error || 'Falha ao abrir a janela de ajustes.');
    }
  }

  setupGlobalHeader({
    activePage: 'vale.html',
    pageTitle: 'Vale Alimentação',
    onGenerateReport: generateValeFiles
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  $('mesReferenciaVale').value = `${y}-${m}`;

  $('btnGerarArquivosVale').addEventListener('click', async () => {
    try {
      await generateValeFiles();
    } catch (e) {
      setProcessamentoStatus('Erro');
      alert(String(e?.message || e));
    }
  });

  $('btnAbrirFaltasProcesso').addEventListener('click', async () => {
    await openFaltas();
  });

  $('btnAbrirAjustes').addEventListener('click', async () => {
    await openAjustes();
  });
});
