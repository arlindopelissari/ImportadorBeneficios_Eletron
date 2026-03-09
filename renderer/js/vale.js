function setValeStatus(s) { $('valeStatus').textContent = s; }
function setVinculoStatus(s) { $('vinculoStatus').textContent = s; }
function setProcessamentoStatus(s) {
  const el = $('processamentoValeStatus');
  if (el) el.textContent = s;
}

function parseMoney(v) {
  const raw = String(v || '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function renderValeTable(rows) {
  const host = $('valeTable');
  if (!Array.isArray(rows) || rows.length === 0) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Id_Vale</th>
          <th>Nome</th>
          <th>Valor</th>
          <th>Dias Trabalhados</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of rows) {
    html += `
      <tr data-id="${escapeHtml(r.Id_Vale)}" data-nome="${escapeHtml(r.Nome)}">
        <td>${escapeHtml(r.Id_Vale)}</td>
        <td><input class="vale-nome" type="text" value="${escapeHtml(r.Nome)}" disabled style="min-width:220px;" /></td>
        <td><input class="vale-valor" type="text" value="${escapeHtml(r.Valor)}" disabled style="min-width:120px;" /></td>
        <td><input class="vale-dias" type="number" min="0" step="1" value="${escapeHtml(r.dias_trabalhados)}" disabled style="min-width:110px;" /></td>
        <td>
          <button class="btn act-edit-vale">Editar</button>
          <button class="btn act-save-vale" disabled>Salvar</button>
          <button class="btn act-del-vale">Excluir</button>
        </td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  host.innerHTML = html;
}

function renderVinculoTable(rows) {
  const host = $('vinculoTable');
  if (!Array.isArray(rows) || rows.length === 0) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  const preview = {
    columns: ['CCusto', 'CCustoDescricao', 'Id_Vale', 'NomeVale', 'ValorVale'],
    rows: rows.map((r) => [r.CCusto, r.CCustoDescricao, r.Id_Vale, r.NomeVale, r.ValorVale])
  };
  renderTable('vinculoTable', preview);

  const table = host.querySelector('table');
  const headRow = table.querySelector('thead tr');
  headRow.insertAdjacentHTML('beforeend', '<th>Ações</th>');
  const bodyRows = table.querySelectorAll('tbody tr');
  bodyRows.forEach((tr, i) => {
    const ccusto = rows[i].CCusto;
    tr.insertAdjacentHTML('beforeend', `<td><button class="btn act-del-vinc" data-ccusto="${escapeHtml(ccusto)}">Excluir</button></td>`);
  });
}


async function loadVales() {
  const res = await window.api.getValesAlimentacao();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar vales.');
  renderValeTable(res.rows || []);

  const valeSel = $('valeSelect');
  valeSel.innerHTML = '<option value="">Selecione...</option>';
  for (const r of res.rows || []) {
    const text = `${r.Id_Vale} - ${r.Nome} (${r.Valor})`;
    valeSel.insertAdjacentHTML('beforeend', `<option value="${r.Id_Vale}">${escapeHtml(text)}</option>`);
  }
}

async function loadCentrosCusto() {
  const res = await window.api.getCentrosCusto();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar centros de custo.');

  const ccSel = $('ccustoSelect');
  ccSel.innerHTML = '<option value="">Selecione...</option>';
  for (const r of res.rows || []) {
    const text = `${r.CCusto} - ${r.CCustoDescricao || ''}`;
    ccSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r.CCusto)}">${escapeHtml(text)}</option>`);
  }
}

async function loadVinculos() {
  const res = await window.api.getValeCcustoVinculos();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar vínculos.');
  renderVinculoTable(res.rows || []);
}

async function refreshAll() {
  await loadVales();
  await loadCentrosCusto();
  await loadVinculos();
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

  setupGlobalHeader({
    activePage: 'vale.html',
    pageTitle: 'Vale Alimentação',
    onGenerateReport: generateValeFiles
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  $('dataBaseVale').value = `${y}-${m}-${d}`;
  $('mesReferenciaVale').value = `${y}-${m}`;

  $('btnGerarArquivosVale').addEventListener('click', async () => {
    try {
      await generateValeFiles();
    } catch (e) {
      setProcessamentoStatus('Erro');
      alert(String(e?.message || e));
    }
  });

  $('btnSalvarVale').addEventListener('click', async () => {
    const idText = String($('idVale').value || '').trim();
    const id = Number(idText);
    const nome = $('nomeVale').value.trim();
    const valor = parseMoney($('valorVale').value);
    const dias = Number($('diasTrabalhadosVale').value || 0);

    if (!nome) return alert('Informe o nome.');
    if (!Number.isFinite(valor) || valor < 0) return alert('Informe um valor válido.');
    if (!Number.isFinite(dias) || dias < 0) return alert('Informe dias trabalhados válido.');

    setValeStatus('Salvando...');
    const payload = { Nome: nome, Valor: valor, dias_trabalhados: dias };
    if (Number.isFinite(id) && id > 0) payload.Id_Vale = id;

    const res = await window.api.saveValeAlimentacao(payload);
    if (!res?.ok) {
      setValeStatus('Erro');
      return alert(res?.error || 'Falha ao salvar vale.');
    }

    setValeStatus('OK');
    await refreshAll();
  });

  // garante campos de cadastro sempre liberados
  $('nomeVale').disabled = false;
  $('nomeVale').readOnly = false;
  $('valorVale').disabled = false;
  $('valorVale').readOnly = false;

  $('btnLimparVale').addEventListener('click', () => {
    $('idVale').value = '';
    $('nomeVale').value = '';
    $('valorVale').value = '';
    $('diasTrabalhadosVale').value = '';
  });

  $('valeTable').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = Number(tr.getAttribute('data-id'));
    const inpNome = tr.querySelector('.vale-nome');
    const nomeAtual = String(tr.getAttribute('data-nome') || '').trim();
    const inpValor = tr.querySelector('.vale-valor');
    const inpDias = tr.querySelector('.vale-dias');
    const btnEdit = tr.querySelector('.act-edit-vale');
    const btnSave = tr.querySelector('.act-save-vale');

    if (e.target.closest('.act-edit-vale')) {
      inpNome.disabled = false;
      inpValor.disabled = false;
      inpDias.disabled = false;
      btnSave.disabled = false;
      btnEdit.disabled = true;
      inpNome.focus();
      return;
    }

    if (e.target.closest('.act-save-vale')) {
      const nome = String(inpNome.value || '').trim();
      const valor = parseMoney(inpValor.value);
      const dias = Number(inpDias.value || 0);
      if (!nome) return alert('Informe o nome.');
      if (!Number.isFinite(valor) || valor < 0) return alert('Informe um valor válido.');
      if (!Number.isFinite(dias) || dias < 0) return alert('Informe dias trabalhados válido.');

      setValeStatus('Salvando...');
      const res = await window.api.saveValeAlimentacao({
        Id_Vale: id,
        Nome: nome,
        Valor: valor,
        dias_trabalhados: dias
      });
      if (!res?.ok) {
        setValeStatus('Erro');
        return alert(res?.error || 'Falha ao salvar vale.');
      }
      setValeStatus('OK');
      await loadVales();
      return;
    }

    if (e.target.closest('.act-del-vale')) {
      if (!confirm(`Excluir vale ${id}?`)) return;
      setValeStatus('Excluindo...');
      const res = await window.api.deleteValeAlimentacao(id);
      if (!res?.ok) {
        setValeStatus('Erro');
        return alert(res?.error || 'Falha ao excluir vale.');
      }
      setValeStatus('OK');
      await refreshAll();
      return;
    }
  });

  $('btnSalvarVinculo').addEventListener('click', async () => {
    const ccusto = $('ccustoSelect').value;
    const idVale = Number($('valeSelect').value);
    if (!ccusto) return alert('Selecione o centro de custo.');
    if (!Number.isFinite(idVale) || idVale <= 0) return alert('Selecione o vale.');

    setVinculoStatus('Salvando...');
    const res = await window.api.saveValeCcustoVinculo({ CCusto: ccusto, Id_Vale: idVale });
    if (!res?.ok) {
      setVinculoStatus('Erro');
      return alert(res?.error || 'Falha ao salvar vínculo.');
    }
    setVinculoStatus('OK');
    await loadVinculos();
  });

  $('vinculoTable').addEventListener('click', async (e) => {
    const btn = e.target.closest('.act-del-vinc');
    if (!btn) return;
    const ccusto = btn.getAttribute('data-ccusto');
    if (!confirm(`Excluir vínculo do centro de custo ${ccusto}?`)) return;

    setVinculoStatus('Excluindo...');
    const res = await window.api.deleteValeCcustoVinculo(ccusto);
    if (!res?.ok) {
      setVinculoStatus('Erro');
      return alert(res?.error || 'Falha ao excluir vínculo.');
    }
    setVinculoStatus('OK');
    await loadVinculos();
  });

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

  $('btnAbrirFaltas').addEventListener('click', async () => {
    await openFaltas();
  });

  $('btnAbrirFaltasProcesso').addEventListener('click', async () => {
    await openFaltas();
  });

  $('btnAbrirAjustes').addEventListener('click', async () => {
    await openAjustes();
  });

  refreshAll().catch((e) => alert(String(e?.message || e)));
});
