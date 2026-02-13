const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTable(containerId, preview) {
  const host = $(containerId);
  host.innerHTML = '';

  if (!preview || !preview.columns || !preview.rows || preview.columns.length === 0) {
    host.innerHTML = '<div class="muted" style="padding:10px;">Sem dados.</div>';
    return;
  }

  const cols = preview.columns;
  const rows = preview.rows;

  let html = '<table><thead><tr>';
  for (const c of cols) html += `<th>${escapeHtml(c)}</th>`;
  html += '</tr></thead><tbody>';

  for (const r of rows) {
    html += '<tr>';
    for (let i = 0; i < cols.length; i++) html += `<td>${escapeHtml(r[i])}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  host.innerHTML = html;
}

function navHtml(active) {
  const items = [
    ['index.html', 'Dashboard'],
    ['employees.html', 'Funcionários (XLSX)'],
    ['benefits.html', 'Planos (PDF)'],
    ['maintenance.html', 'Manutenção']
  ];
  return items.map(([href, label]) => {
    const cls = (href === active) ? 'btn badge' : 'btn';
    return `<a class="${cls}" href="./${href}">${label}</a>`;
  }).join('');
}
