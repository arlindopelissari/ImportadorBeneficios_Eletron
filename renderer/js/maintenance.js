function setStatus(s) { $('mStatus').textContent = s; }

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderDependentes(preview) {
  const host = $('depTable');
  host.innerHTML = '';

  if (!preview?.columns?.length) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  const cols = preview.columns;
  const rows = preview.rows;

  let html = '<table><thead><tr>';
  for (const c of cols) html += `<th>${escapeHtml(c)}</th>`;
  html += '<th>Ações</th>';
  html += '</tr></thead><tbody>';

  for (const r of rows) {
    const idIdx = cols.indexOf('id');
    const cpfRespIdx = cols.indexOf('cpfresponsavel');

    const id = idIdx >= 0 ? r[idIdx] : '';
    const cpfresp = cpfRespIdx >= 0 ? (r[cpfRespIdx] ?? '') : '';

    html += `<tr data-id="${escapeHtml(id)}">`;

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];

      if (col === 'cpfresponsavel') {
        html += `<td>
          <input class="cpfresp" type="text" value="${escapeHtml(cpfresp)}" style="min-width:180px;" disabled />
        </td>`;
      } else {
        html += `<td>${escapeHtml(r[i])}</td>`;
      }
    }

    html += `<td style="white-space:nowrap;">
      <button class="btn act-edit">Editar</button>
      <button class="btn act-save" disabled>Salvar</button>
      <button class="btn act-del">Deletar</button>
    </td>`;

    html += `</tr>`;
  }

  html += '</tbody></table>';
  host.innerHTML = html;
}

async function refreshDeps() {
  setStatus('Atualizando...');
  const preview = await window.api.getDependentesPreview(500);
  renderDependentes(preview);
  setStatus('OK');
}

window.addEventListener('DOMContentLoaded', () => {
  setupGlobalHeader({ activePage: 'maintenance.html', pageTitle: 'Depend. Unimed' });

  $('btnRefreshDep').addEventListener('click', () =>
    refreshDeps().catch(e => alert(String(e?.message || e)))
  );

  $('depTable').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;

    const tr = ev.target.closest('tr');
    if (!tr) return;

    const id = tr.getAttribute('data-id');
    const inp = tr.querySelector('input.cpfresp');
    const btnEdit = tr.querySelector('.act-edit');
    const btnSave = tr.querySelector('.act-save');

    if (btn.classList.contains('act-edit')) {
      inp.disabled = false;
      inp.focus();
      btnSave.disabled = false;
      btnEdit.disabled = true;
      return;
    }

    if (btn.classList.contains('act-save')) {
      const cpfresponsavel = inp.value.trim();
      setStatus('Salvando...');
      const res = await window.api.dependenteUpdateCpfResp({ id, cpfresponsavel });
      if (!res?.ok) {
        setStatus('Erro');
        alert(res?.error || 'Falha ao salvar.');
        return;
      }
      inp.disabled = true;
      btnSave.disabled = true;
      btnEdit.disabled = false;
      await refreshDeps();
      return;
    }

    if (btn.classList.contains('act-del')) {
      if (!confirm('Deletar este dependente?')) return;
      setStatus('Deletando...');
      const res = await window.api.dependenteDelete(id);
      if (!res?.ok) {
        setStatus('Erro');
        alert(res?.error || 'Falha ao deletar.');
        return;
      }
      await refreshDeps();
      return;
    }
  });

  refreshDeps().catch(() => {});
});
