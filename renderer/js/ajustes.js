function setAjusteStatus(s) { $('ajusteStatus').textContent = s; }
let funcionariosMap = new Map();

function renderAjustesTable(rows) {
  const host = $('ajustesTable');
  if (!Array.isArray(rows) || rows.length === 0) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  const preview = {
    columns: ['CPF', 'Cadastro', 'Nome', 'data_afastamento', 'data_retorno', 'updated_at'],
    rows: rows.map((r) => [r.CPF, r.Cadastro, r.Nome, r.data_afastamento, r.data_retorno, r.updated_at])
  };
  renderTable('ajustesTable', preview);

  const table = host.querySelector('table');
  const headRow = table.querySelector('thead tr');
  headRow.insertAdjacentHTML('beforeend', '<th>Ações</th>');
  const bodyRows = table.querySelectorAll('tbody tr');
  bodyRows.forEach((tr, i) => {
    const cpf = rows[i].CPF;
    tr.insertAdjacentHTML(
      'beforeend',
      `<td>
        <button class="btn act-edit-ajuste" data-cpf="${escapeHtml(cpf)}">Editar</button>
        <button class="btn act-del-ajuste" data-cpf="${escapeHtml(cpf)}">Excluir</button>
      </td>`
    );
  });
}

function renderFuncionariosAjuste(funcionarios, ajustesRows) {
  const sel = $('funcionarioAjusteSelect');
  sel.innerHTML = '<option value="">Selecione...</option>';

  const cpfsComAjuste = new Set((ajustesRows || []).map((r) => String(r.CPF || '').trim()));
  funcionariosMap = new Map();

  for (const r of funcionarios || []) {
    const cpf = String(r.CPF || '').trim();
    if (!cpf || cpfsComAjuste.has(cpf)) continue;

    const text = `${r.Cadastro} - ${r.Nome} (${cpf})`;
    funcionariosMap.set(cpf, {
      cadastro: String(r.Cadastro || '').trim(),
      nome: String(r.Nome || '').trim(),
      label: text
    });

    sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(cpf)}">${escapeHtml(text)}</option>`);
  }
}

function ensureFuncionarioOption(cpf, cadastro, nome) {
  const key = String(cpf || '').trim();
  if (!key) return;

  const sel = $('funcionarioAjusteSelect');
  const exists = Array.from(sel.options).some((opt) => opt.value === key);
  if (exists) return;

  const known = funcionariosMap.get(key);
  const label = known?.label || `${String(cadastro || '').trim()} - ${String(nome || '').trim()} (${key})`;
  sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`);
}

async function refreshAll() {
  const [funcRes, ajusteRes] = await Promise.all([
    window.api.getFuncionariosApontamento(),
    window.api.getValeApontamentos()
  ]);

  if (!funcRes?.ok) throw new Error(funcRes?.error || 'Falha ao carregar funcionários.');
  if (!ajusteRes?.ok) throw new Error(ajusteRes?.error || 'Falha ao carregar ajustes.');

  const funcionarios = funcRes.rows || [];
  const ajustes = ajusteRes.rows || [];
  renderFuncionariosAjuste(funcionarios, ajustes);
  renderAjustesTable(ajustes);
}

window.addEventListener('DOMContentLoaded', () => {
  $('btnAtualizarAjuste').addEventListener('click', () => {
    refreshAll().catch((e) => alert(String(e?.message || e)));
  });

  $('btnSalvarAjuste').addEventListener('click', async () => {
    const cpf = $('funcionarioAjusteSelect').value;
    const dataAfastamento = String($('dataAfastamentoInput').value || '').trim();
    const dataRetorno = String($('dataRetornoInput').value || '').trim();
    if (!cpf) return alert('Selecione o funcionário.');
    if (!dataAfastamento && !dataRetorno) {
      return alert('Informe ao menos uma data de afastamento ou retorno.');
    }

    setAjusteStatus('Salvando...');
    const res = await window.api.saveValeApontamento({
      CPF: cpf,
      data_afastamento: dataAfastamento,
      data_retorno: dataRetorno
    });
    if (!res?.ok) {
      setAjusteStatus('Erro');
      return alert(res?.error || 'Falha ao salvar ajuste.');
    }
    setAjusteStatus('OK');
    await refreshAll();
  });

  $('btnLimparAjuste').addEventListener('click', () => {
    $('funcionarioAjusteSelect').value = '';
    $('dataAfastamentoInput').value = '';
    $('dataRetornoInput').value = '';
    setAjusteStatus('Pronto');
  });

  $('ajustesTable').addEventListener('click', async (e) => {
    const btnEdit = e.target.closest('.act-edit-ajuste');
    if (btnEdit) {
      const tr = btnEdit.closest('tr');
      if (!tr) return;
      const tds = tr.querySelectorAll('td');
      const cpf = String(tds[0]?.textContent || '').trim();
      const cadastro = String(tds[1]?.textContent || '').trim();
      const nome = String(tds[2]?.textContent || '').trim();
      ensureFuncionarioOption(cpf, cadastro, nome);
      $('funcionarioAjusteSelect').value = cpf;
      $('dataAfastamentoInput').value = String(tds[3]?.textContent || '').trim();
      $('dataRetornoInput').value = String(tds[4]?.textContent || '').trim();
      setAjusteStatus('Edição carregada');
      return;
    }

    const btnDel = e.target.closest('.act-del-ajuste');
    if (!btnDel) return;
    const cpf = btnDel.getAttribute('data-cpf');
    if (!confirm(`Excluir ajuste do CPF ${cpf}?`)) return;

    setAjusteStatus('Excluindo...');
    const res = await window.api.deleteValeApontamento(cpf);
    if (!res?.ok) {
      setAjusteStatus('Erro');
      return alert(res?.error || 'Falha ao excluir ajuste.');
    }

    setAjusteStatus('OK');
    await refreshAll();
  });

  refreshAll().catch((e) => alert(String(e?.message || e)));
});
