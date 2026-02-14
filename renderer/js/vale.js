function setValeStatus(s) { $('valeStatus').textContent = s; }
function setVinculoStatus(s) { $('vinculoStatus').textContent = s; }
function setFaltasStatus(s) { $('faltasStatus').textContent = s; }

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

function renderFaltasTable(rows) {
  const host = $('faltasTable');
  if (!Array.isArray(rows) || rows.length === 0) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  const preview = {
    columns: ['CPF', 'Cadastro', 'Nome', 'faltas', 'updated_at'],
    rows: rows.map((r) => [r.CPF, r.Cadastro, r.Nome, r.faltas, r.updated_at])
  };
  renderTable('faltasTable', preview);

  const table = host.querySelector('table');
  const headRow = table.querySelector('thead tr');
  headRow.insertAdjacentHTML('beforeend', '<th>Ações</th>');
  const bodyRows = table.querySelectorAll('tbody tr');
  bodyRows.forEach((tr, i) => {
    const cpf = rows[i].CPF;
    tr.insertAdjacentHTML(
      'beforeend',
      `<td>
        <button class="btn act-edit-falta" data-cpf="${escapeHtml(cpf)}">Editar</button>
        <button class="btn act-del-falta" data-cpf="${escapeHtml(cpf)}">Excluir</button>
      </td>`
    );
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

async function loadFuncionariosFalta() {
  const res = await window.api.getFuncionariosApontamento();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar funcionários.');

  const sel = $('funcionarioFaltaSelect');
  sel.innerHTML = '<option value="">Selecione...</option>';
  for (const r of res.rows || []) {
    const text = `${r.Cadastro} - ${r.Nome} (${r.CPF})`;
    sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r.CPF)}">${escapeHtml(text)}</option>`);
  }
}

async function loadFaltas() {
  const res = await window.api.getValeFaltas();
  if (!res?.ok) throw new Error(res?.error || 'Falha ao carregar faltas.');
  renderFaltasTable(res.rows || []);
}

async function refreshAll() {
  await loadVales();
  await loadCentrosCusto();
  await loadVinculos();
  await loadFuncionariosFalta();
  await loadFaltas();
}

window.addEventListener('DOMContentLoaded', () => {
  async function generateValeReportFromMenu() {
    const dataBase = String($('dataBaseVale').value || '').trim();
    if (!dataBase) return alert('Informe a Data Base para gerar o relatório.');

    const res = await window.api.generateValeReport({ dataBase });
    if (res?.canceled) return;
    if (!res?.ok) return alert(res?.error || 'Falha ao gerar relatório de vale.');
    await handleReportSuccess(res.file);
  }

  setupGlobalHeader({
    activePage: 'vale.html',
    pageTitle: 'Vale Alimentação',
    onGenerateReport: generateValeReportFromMenu
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  $('dataBaseVale').value = `${y}-${m}-${d}`;

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

  const modal = $('modalFaltas');
  const closeFaltas = () => { modal.style.display = 'none'; };

  $('btnAbrirFaltas').addEventListener('click', async () => {
    await loadFaltas();
    modal.style.display = 'flex';
  });
  $('btnFecharFaltasTop').addEventListener('click', closeFaltas);
  $('btnFecharFaltasBottom').addEventListener('click', closeFaltas);
  modal.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'modalFaltas') closeFaltas();
  });

  $('btnSalvarFalta').addEventListener('click', async () => {
    const cpf = $('funcionarioFaltaSelect').value;
    const faltas = Number($('faltasModalInput').value || 0);
    if (!cpf) return alert('Selecione o funcionário.');
    if (!Number.isFinite(faltas) || faltas < 0) return alert('Faltas inválidas.');

    setFaltasStatus('Salvando...');
    const res = await window.api.saveValeFalta({ CPF: cpf, faltas });
    if (!res?.ok) {
      setFaltasStatus('Erro');
      return alert(res?.error || 'Falha ao salvar faltas.');
    }
    setFaltasStatus('OK');
    await loadFaltas();
  });

  $('btnLimparFalta').addEventListener('click', () => {
    $('funcionarioFaltaSelect').value = '';
    $('faltasModalInput').value = '';
  });

  $('faltasTable').addEventListener('click', async (e) => {
    const btnEdit = e.target.closest('.act-edit-falta');
    if (btnEdit) {
      const tr = btnEdit.closest('tr');
      if (!tr) return;
      const tds = tr.querySelectorAll('td');
      $('funcionarioFaltaSelect').value = String(tds[0]?.textContent || '').trim();
      $('faltasModalInput').value = String(tds[3]?.textContent || '').trim();
      setFaltasStatus('Edição carregada');
      return;
    }

    const btnDel = e.target.closest('.act-del-falta');
    if (!btnDel) return;
    const cpf = btnDel.getAttribute('data-cpf');
    if (!confirm(`Excluir faltas do CPF ${cpf}?`)) return;

    setFaltasStatus('Excluindo...');
    const res = await window.api.deleteValeFalta(cpf);
    if (!res?.ok) {
      setFaltasStatus('Erro');
      return alert(res?.error || 'Falha ao excluir faltas.');
    }
    setFaltasStatus('OK');
    await loadFaltas();
  });

  refreshAll().catch((e) => alert(String(e?.message || e)));
});
