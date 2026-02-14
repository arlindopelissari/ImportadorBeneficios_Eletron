function setFaltasStatus(s) { $('faltasStatus').textContent = s; }
let funcionariosMap = new Map();

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

function renderFuncionariosFalta(funcionarios, faltasRows) {
  const sel = $('funcionarioFaltaSelect');
  sel.innerHTML = '<option value="">Selecione...</option>';

  const cpfsComFalta = new Set((faltasRows || []).map((r) => String(r.CPF || '').trim()));
  funcionariosMap = new Map();

  for (const r of funcionarios || []) {
    const cpf = String(r.CPF || '').trim();
    if (!cpf || cpfsComFalta.has(cpf)) continue;

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

  const sel = $('funcionarioFaltaSelect');
  const exists = Array.from(sel.options).some((opt) => opt.value === key);
  if (exists) return;

  const known = funcionariosMap.get(key);
  const label = known?.label || `${String(cadastro || '').trim()} - ${String(nome || '').trim()} (${key})`;
  sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`);
}

async function refreshAll() {
  const [funcRes, faltasRes] = await Promise.all([
    window.api.getFuncionariosApontamento(),
    window.api.getValeFaltas()
  ]);

  if (!funcRes?.ok) throw new Error(funcRes?.error || 'Falha ao carregar funcionários.');
  if (!faltasRes?.ok) throw new Error(faltasRes?.error || 'Falha ao carregar faltas.');

  const funcionarios = funcRes.rows || [];
  const faltas = faltasRes.rows || [];
  renderFuncionariosFalta(funcionarios, faltas);
  renderFaltasTable(faltas);
}

window.addEventListener('DOMContentLoaded', () => {
  $('btnAtualizarFaltas').addEventListener('click', () => {
    refreshAll().catch((e) => alert(String(e?.message || e)));
  });

  $('btnSalvarFalta').addEventListener('click', async () => {
    const cpf = $('funcionarioFaltaSelect').value;
    const faltas = Number($('faltasInput').value || 0);
    if (!cpf) return alert('Selecione o funcionário.');
    if (!Number.isFinite(faltas) || faltas < 0) return alert('Faltas inválidas.');

    setFaltasStatus('Salvando...');
    const res = await window.api.saveValeFalta({ CPF: cpf, faltas });
    if (!res?.ok) {
      setFaltasStatus('Erro');
      return alert(res?.error || 'Falha ao salvar faltas.');
    }
    setFaltasStatus('OK');
    await refreshAll();
  });

  $('btnLimparFalta').addEventListener('click', () => {
    $('funcionarioFaltaSelect').value = '';
    $('faltasInput').value = '';
  });

  $('btnExcluirTodasFaltas').addEventListener('click', async () => {
    if (!confirm('Excluir todos os registros de faltas?')) return;

    setFaltasStatus('Excluindo...');
    const res = await window.api.clearValeFaltas();
    if (!res?.ok) {
      setFaltasStatus('Erro');
      return alert(res?.error || 'Falha ao excluir todos os registros.');
    }

    setFaltasStatus(`OK (${res.changes || 0} excluídos)`);
    await refreshAll();
  });

  $('faltasTable').addEventListener('click', async (e) => {
    const btnEdit = e.target.closest('.act-edit-falta');
    if (btnEdit) {
      const tr = btnEdit.closest('tr');
      if (!tr) return;
      const tds = tr.querySelectorAll('td');
      const cpf = String(tds[0]?.textContent || '').trim();
      const cadastro = String(tds[1]?.textContent || '').trim();
      const nome = String(tds[2]?.textContent || '').trim();
      ensureFuncionarioOption(cpf, cadastro, nome);
      $('funcionarioFaltaSelect').value = cpf;
      $('faltasInput').value = String(tds[3]?.textContent || '').trim();
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
    await refreshAll();
  });

  refreshAll().catch((e) => alert(String(e?.message || e)));
});
