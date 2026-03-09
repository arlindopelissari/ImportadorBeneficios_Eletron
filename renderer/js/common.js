const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function prettyHeaderName(name) {
  const key = String(name || '').trim();
  const map = {
    Empresa: 'Empresa',
    Tipo: 'Tipo',
    Cadastro: 'Cadastro',
    Nome: 'Nome',
    Admissao: 'Admissão',
    Situacao: 'Situação',
    Escala: 'Escala',
    CCusto: 'C. Custo',
    CCustoDescricao: 'Descrição do C. Custo',
    DataAfastamento: 'Data de Afastamento',
    CPF: 'CPF',
    Nascimento: 'Nascimento',
    beneficiario: 'Beneficiário',
    cpf: 'CPF',
    cpf_func: 'CPF Funcionário',
    cpfresponsavel: 'CPF Responsável',
    total_valor: 'Valor Total',
    tipo_pendencia: 'Tipo de Pendência',
    id: 'ID',
    tp: 'Tipo',
    codigo: 'Código',
    data_limite: 'Data Limite',
    data_inclusao: 'Data de Inclusão',
    id_rubrica: 'ID Rubrica',
    Id_Vale: 'Id_Vale',
    NomeVale: 'Nome do Vale',
    ValorVale: 'Valor do Vale',
    dias_trabalhados: 'Dias Trabalhados',
    faltas: 'Faltas',
    data_afastamento: 'Data Afastamento',
    data_retorno: 'Data Retorno',
    updated_at: 'Atualizado em'
  };

  return map[key] || key.replace(/_/g, ' ');
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
  for (const c of cols) html += `<th>${escapeHtml(prettyHeaderName(c))}</th>`;
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
    ['employees.html', 'Funcionários (XLSX)'],
    ['benefits.html', 'Planos (PDF)'],
    ['maintenance.html', 'Depend. Unimed'],
    ['vale.html', 'Vale Alimentação']
  ];

  return items.map(([href, label]) => {
    const cls = href === active ? 'menu-link is-active' : 'menu-link';
    return `<a class="${cls}" href="./${href}">${label}</a>`;
  }).join('');
}

function globalHeaderHtml(pageTitle = '') {
  return `
    <div class="header">
      <div class="header__left">
        <div class="nav" id="nav"></div>
      </div>

      <div class="header__right">
        <div class="menu-dd" id="reportMenuWrap">
          <button class="menu-dd__btn" id="btnReportMenu" type="button" aria-haspopup="true" aria-expanded="false">
            Gerar Relatório <span class="menu-dd__chev">▾</span>
          </button>
          <div class="menu-dd__panel" role="menu" aria-label="Menu de relatórios">
            <button class="menu-dd__item" id="btnRelatorioUnimedMenu" type="button" role="menuitem">
              Relatório
            </button>
          </div>
        </div>

        <div class="menu-dd" id="depMenuWrap">
          <button class="menu-dd__btn" id="btnDepMenu" type="button" aria-haspopup="true" aria-expanded="false">
            Dependentes <span class="menu-dd__chev">▾</span>
          </button>
          <div class="menu-dd__panel" role="menu" aria-label="Menu de dependentes">
            <button class="menu-dd__item" id="btnExportDepUnimed" type="button" role="menuitem">
              Exportar Dependentes Unimed
            </button>
            <button class="menu-dd__item" id="btnImportDepUnimed" type="button" role="menuitem">
              Importar Dependentes Unimed
            </button>
          </div>
        </div>

        <div class="page-title" id="pageTitle">${escapeHtml(pageTitle)}</div>
      </div>
    </div>
  `;
}

function ensureGlobalHeader(pageTitle = '') {
  const host = $('globalHeader');
  if (!host) return;
  const hasBuilt = !!host.querySelector('#nav');
  if (!hasBuilt) {
    host.innerHTML = globalHeaderHtml(pageTitle);
  }
}

function setReportMenuEnabled(enabled) {
  const btn = $('btnRelatorioUnimedMenu');
  if (!btn) return;
  btn.disabled = !enabled;
}

async function defaultExportDependentes() {
  const res = await window.api.exportDependentesUnimed();
  if (res?.canceled) return;
  if (!res?.ok) throw new Error(res?.error || 'Falha ao exportar dependentes.');
  alert(`Exportado: ${res.exported} registro(s)\n${res.file}`);
}

async function defaultImportDependentes(onAfterImport) {
  const res = await window.api.importDependentesUnimed();
  if (res?.canceled) return;
  if (!res?.ok) throw new Error(res?.error || 'Falha ao importar dependentes.');

  if (typeof onAfterImport === 'function') {
    await onAfterImport(res);
  }

  alert(
    `Importação concluída\n` +
    `Inseridos: ${res.inserted ?? 0}\n` +
    `Atualizados: ${res.updated ?? 0}\n` +
    `Ignorados: ${res.ignored ?? 0}`
  );
}

function ensurePendenciasPopup() {
  let modal = $('globalPendenciasModal');
  if (modal) return modal;

  const html = `
    <div id="globalPendenciasModal" class="gmodal" style="display:none;">
      <div class="gmodal__content">
        <div class="gmodal__header">
          <span class="gmodal__title">Pendências encontradas</span>
          <button id="globalPendenciasCloseTop" class="gmodal__close" type="button" title="Fechar">×</button>
        </div>
        <div class="gmodal__body">
          <p id="globalPendenciasText" class="gmodal__text"></p>
          <div class="grid-wrapper">
            <div id="globalPendenciasTable"></div>
          </div>
        </div>
        <div class="gmodal__footer">
          <button id="globalPendenciasCloseBottom" class="btn" type="button">Fechar</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  modal = $('globalPendenciasModal');

  const close = () => {
    modal.style.display = 'none';
    $('globalPendenciasTable').innerHTML = '';
  };

  $('globalPendenciasCloseTop').addEventListener('click', close);
  $('globalPendenciasCloseBottom').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'globalPendenciasModal') close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') close();
  });

  return modal;
}

function openPendenciasPopup(preview, reason) {
  const modal = ensurePendenciasPopup();
  $('globalPendenciasText').textContent =
    reason || 'Existem beneficiários/dependentes sem vínculo com funcionário. Corrija antes de gerar o relatório.';
  renderTable('globalPendenciasTable', preview);
  modal.style.display = 'flex';
}

function ensureReportSuccessModal() {
  let modal = $('globalReportModal');
  if (modal) return modal;

  const html = `
    <div id="globalReportModal" class="rmodal" style="display:none;">
      <div class="rmodal__content">
        <div class="rmodal__header">
          <span class="rmodal__title">Relatório gerado</span>
          <button id="globalReportCloseTop" class="rmodal__close" type="button" title="Fechar">×</button>
        </div>
        <div class="rmodal__body">
          <p class="rmodal__text">O que deseja fazer agora?</p>
          <p id="globalReportPath" class="rmodal__path"></p>
          <div class="rmodal__actions">
            <button id="globalReportOpenFile" class="rmodal__btn rmodal__btn--primary" type="button">Abrir arquivo</button>
            <button id="globalReportOpenFolder" class="rmodal__btn" type="button">Abrir pasta</button>
            <button id="globalReportCloseBottom" class="rmodal__btn rmodal__btn--ghost" type="button">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  modal = $('globalReportModal');
  return modal;
}

function openReportSuccessModal(filePath) {
  const modal = ensureReportSuccessModal();
  const pathEl = $('globalReportPath');
  const btnOpenFile = $('globalReportOpenFile');
  const btnOpenFolder = $('globalReportOpenFolder');
  const btnCloseTop = $('globalReportCloseTop');
  const btnCloseBottom = $('globalReportCloseBottom');

  pathEl.textContent = String(filePath || '');

  return new Promise((resolve) => {
    const cleanup = () => {
      modal.style.display = 'none';
      modal.removeEventListener('click', onBackdrop);
      btnOpenFile.removeEventListener('click', onOpenFile);
      btnOpenFolder.removeEventListener('click', onOpenFolder);
      btnCloseTop.removeEventListener('click', onClose);
      btnCloseBottom.removeEventListener('click', onClose);
      document.removeEventListener('keydown', onEsc);
    };

    const done = (action) => {
      cleanup();
      resolve(action);
    };

    const onOpenFile = () => done('open-file');
    const onOpenFolder = () => done('open-folder');
    const onClose = () => done('close');
    const onBackdrop = (e) => {
      if (e.target && e.target.id === 'globalReportModal') done('close');
    };
    const onEsc = (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') done('close');
    };

    btnOpenFile.addEventListener('click', onOpenFile);
    btnOpenFolder.addEventListener('click', onOpenFolder);
    btnCloseTop.addEventListener('click', onClose);
    btnCloseBottom.addEventListener('click', onClose);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
    modal.style.display = 'flex';
  });
}

function buildReportFailureMessage(res) {
  if (!res) return 'Falha ao gerar relatório.';
  if (res.error) return res.error;

  const byType = res.pendenciasByType || {};
  const depSemResp = Array.isArray(byType.dependenteSemCpfResp) ? byType.dependenteSemCpfResp.length : 0;
  const tpNaoDSemFunc = Array.isArray(byType.tpNaoDSemFuncionario) ? byType.tpNaoDSemFuncionario.length : 0;

  if (depSemResp || tpNaoDSemFunc) {
    const parts = [];
    if (depSemResp) parts.push(`${depSemResp} Dependente(s) não possui CPF do responsável informado`);
    if (tpNaoDSemFunc) parts.push(`${tpNaoDSemFunc} Beneficiário(s) não encontrado na base de funcionários`);
    return `Relatório bloqueado por pendências: ${parts.join(' | ')}`;
  }

  if (Array.isArray(res.pendencias) && res.pendencias.length > 0) {
    return `Relatório bloqueado por pendências (${res.pendencias.length}).`;
  }

  return 'Falha ao gerar relatório.';
}

async function handleReportSuccess(filePath) {
  if (!filePath) {
    alert('Relatório gerado com sucesso.');
    return;
  }

  if (window.api?.openReportFile && window.api?.openReportFolder) {
    const action = await openReportSuccessModal(filePath);
    if (action === 'open-file') {
      const res = await window.api.openReportFile(filePath);
      if (!res?.ok && res?.error) alert(`Falha ao abrir arquivo: ${res.error}`);
    } else if (action === 'open-folder') {
      const res = await window.api.openReportFolder(filePath);
      if (!res?.ok && res?.error) alert(`Falha ao abrir pasta: ${res.error}`);
    }
    return;
  }

  alert(`Relatório gerado:\n${filePath}`);
}

async function defaultGenerateReport() {
  try {
    const res = await window.api.generateUnimedReport();
    if (res?.canceled) return;
    if (!res?.ok) {
      const reason = buildReportFailureMessage(res);
      const preview =
        (res?.pendenciasPreview && res.pendenciasPreview.rows?.length) ? res.pendenciasPreview :
        (Array.isArray(res?.pendencias) && res.pendencias.length) ? { columns: Object.keys(res.pendencias[0] || {}), rows: res.pendencias.map(r => Object.values(r)) } :
        null;
      if (preview && preview.rows?.length) {
        openPendenciasPopup(preview, reason);
      } else {
        alert(reason);
      }
      return;
    }
    await handleReportSuccess(res.file);
  } catch (e) {
    alert(String(e?.message || e));
  }
}

function setupGlobalHeader({ activePage, pageTitle, onGenerateReport, onDependentesImported } = {}) {
  ensureGlobalHeader(pageTitle || '');

  const nav = $('nav');
  if (nav && activePage) nav.innerHTML = navHtml(activePage);

  const pageTitleEl = $('pageTitle');
  if (pageTitleEl && pageTitle) pageTitleEl.textContent = pageTitle;

  const wrap = $('reportMenuWrap');
  const btn = $('btnReportMenu');
  const item = $('btnRelatorioUnimedMenu');
  const depWrap = $('depMenuWrap');
  const depBtn = $('btnDepMenu');

  const closeReportMenu = () => {
    if (!wrap || !btn) return;
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  };

  const closeDependentesMenu = () => {
    if (!depWrap || !depBtn) return;
    depWrap.classList.remove('is-open');
    depBtn.setAttribute('aria-expanded', 'false');
  };

  if (wrap && btn && !wrap.dataset.bound) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDependentesMenu();
      const open = wrap.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', closeReportMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeReportMenu();
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

  const btnExport = $('btnExportDepUnimed');
  const btnImport = $('btnImportDepUnimed');

  if (depWrap && depBtn && !depWrap.dataset.bound) {
    depBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeReportMenu();
      const open = depWrap.classList.toggle('is-open');
      depBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', closeDependentesMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDependentesMenu();
    });

    depWrap.dataset.bound = '1';
  }

  if (btnExport && !btnExport.dataset.bound) {
    btnExport.addEventListener('click', async () => {
      try {
        await defaultExportDependentes();
      } catch (e) {
        alert(String(e?.message || e));
      }
    });
    btnExport.dataset.bound = '1';
  }

  if (btnImport && !btnImport.dataset.bound) {
    btnImport.addEventListener('click', async () => {
      try {
        await defaultImportDependentes(onDependentesImported);
      } catch (e) {
        alert(String(e?.message || e));
      }
    });
    btnImport.dataset.bound = '1';
  }
}
