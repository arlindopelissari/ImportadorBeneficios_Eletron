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
    ['employees.html', 'Funcionarios (XLSX)'],
    ['benefits.html', 'Planos (PDF)'],
    ['maintenance.html', 'Depend. Unimed']
  ];

  return items.map(([href, label]) => {
    const cls = href === active ? 'menu-link is-active' : 'menu-link';
    return `<a class="${cls}" href="./${href}">${label}</a>`;
  }).join('');
}

function setReportMenuEnabled(enabled) {
  const btn = $('btnRelatorioUnimedMenu');
  if (!btn) return;
  btn.disabled = !enabled;
}

async function defaultGenerateReport() {
  try {
    const res = await window.api.generateUnimedReport();
    if (res?.canceled) return;
    if (!res?.ok) {
      alert(res?.error || 'Falha ao gerar relatorio.');
      return;
    }
    alert(`Relatorio gerado:\n${res.file || ''}`);
  } catch (e) {
    alert(String(e?.message || e));
  }
}

function setupGlobalHeader({ activePage, pageTitle, onGenerateReport } = {}) {
  const nav = $('nav');
  if (nav && activePage) nav.innerHTML = navHtml(activePage);

  const pageTitleEl = $('pageTitle');
  if (pageTitleEl && pageTitle) pageTitleEl.textContent = pageTitle;

  const wrap = $('reportMenuWrap');
  const btn = $('btnReportMenu');
  const item = $('btnRelatorioUnimedMenu');

  if (wrap && btn && !wrap.dataset.bound) {
    const close = () => {
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    wrap.dataset.bound = '1';
  }

  if (item) {
    item.onclick = async () => {
      if (item.disabled) return;
      const handler = onGenerateReport || defaultGenerateReport;
      await handler();
    };
  }
}
