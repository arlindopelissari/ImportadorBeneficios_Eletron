// services/db.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

// ✅ DB SEMPRE no userData (Roaming) — sem admin, persistente, 1 fonte de verdade
function getDbPath() {
  const dir = app.getPath('userData'); // ex: C:\Users\arlin\AppData\Roaming\importador-beneficios-eletron
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sys.db');
}

function openDb() {
  return new Database(getDbPath());
}

function ensureSchema(db) {
  // funcionários
  db.exec(`
    CREATE TABLE IF NOT EXISTS funcionario (
      Empresa TEXT,
      Tipo TEXT,
      Cadastro TEXT,
      Nome TEXT,
      Admissao TEXT,
      Situacao TEXT,
      Escala TEXT,
      CCusto TEXT,
      CCustoDescricao TEXT,
      DataAfastamento TEXT,
      CPF TEXT,
      Nascimento TEXT,
      PRIMARY KEY (Empresa, Cadastro)
    );
  `);

  // ✅ dependentes Unimed (CPF do dependente é único; cpfresponsavel pode mudar)
  db.exec(`
    CREATE TABLE IF NOT EXISTS unimed_dependente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beneficiario TEXT NOT NULL,
      cpf TEXT NOT NULL,
      cpfresponsavel TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ✅ garante unicidade por CPF do dependente (regra nova)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_unimed_dependente_cpf
    ON unimed_dependente(cpf);
  `);

  // ✅ Vale Alimentação
  db.exec(`
    CREATE TABLE IF NOT EXISTS vale_alimentacao (
      Id_Vale INTEGER PRIMARY KEY AUTOINCREMENT,
      Nome TEXT NOT NULL,
      Valor REAL NOT NULL DEFAULT 0,
      dias_trabalhados INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migração defensiva para bases antigas sem a coluna dias_trabalhados
  try {
    db.exec(`ALTER TABLE vale_alimentacao ADD COLUMN dias_trabalhados INTEGER NOT NULL DEFAULT 0`);
  } catch {}

  // ✅ Ligação Centro de Custo -> Vale Alimentação
  db.exec(`
    CREATE TABLE IF NOT EXISTS vale_ccusto (
      CCusto TEXT PRIMARY KEY,
      Id_Vale INTEGER NOT NULL,
      FOREIGN KEY (Id_Vale) REFERENCES vale_alimentacao(Id_Vale)
    );
  `);

  // ✅ Apontamento para Vale Alimentação por funcionário
  db.exec(`
    CREATE TABLE IF NOT EXISTS vale_apontamento_funcionario (
      CPF TEXT PRIMARY KEY,
      dias_trabalhados INTEGER NOT NULL DEFAULT 0,
      data_afastamento TEXT NOT NULL DEFAULT '',
      data_retorno TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec(`ALTER TABLE vale_apontamento_funcionario ADD COLUMN data_afastamento TEXT NOT NULL DEFAULT ''`);
  } catch {}

  try {
    db.exec(`ALTER TABLE vale_apontamento_funcionario ADD COLUMN data_retorno TEXT NOT NULL DEFAULT ''`);
  } catch {}

  // ✅ Faltas por funcionário (manutenção separada)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vale_falta_funcionario (
      CPF TEXT PRIMARY KEY,
      faltas INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migração simples: se existirem faltas no apontamento antigo, copia para a nova tabela
  try {
    db.exec(`
      INSERT OR IGNORE INTO vale_falta_funcionario (CPF, faltas, updated_at)
      SELECT CPF, COALESCE(faltas, 0), datetime('now')
      FROM vale_apontamento_funcionario
      WHERE COALESCE(faltas, 0) > 0
    `);
  } catch {}

  // ❌ NÃO criar planounimed/planoup/planoodonto aqui.
  // Quem cria é o Python, com o schema correto.
}

function tableExists(db, table) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  return !!row;
}

function getColumns(db, table) {
  try {
    if (!tableExists(db, table)) return [];
    return db.prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name);
  } catch {
    return [];
  }
}

function safeDeleteAll(db, table) {
  try {
    if (!tableExists(db, table)) return 0;
    const c = db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c;
    db.prepare(`DELETE FROM "${table}"`).run();
    return c;
  } catch {
    return 0;
  }
}

function clearBenefits(db) {
  // limpa tabelas de benefícios (se existirem)
  // ⚠️ NÃO apaga dependentes aqui (manutenção separada)
  let total = 0;
  total += safeDeleteAll(db, 'planounimed');
  total += safeDeleteAll(db, 'planoup');
  total += safeDeleteAll(db, 'planoodonto');
  return total;
}

function clearValeFaltas(db) {
  return safeDeleteAll(db, 'vale_falta_funcionario');
}

function resolveGfipTable(source) {
  const raw = String(source || '').trim().toLowerCase();
  if (raw === 'gfip_anterior') return 'gfip_anterior';
  if (raw === 'gfip_atual' || raw === 'gfip' || !raw) return 'gfip_atual';
  throw new Error('Fonte GFIP inválida.');
}

function clearGfip(db, source) {
  return safeDeleteAll(db, resolveGfipTable(source));
}

function clearRelVerbas(db) {
  return safeDeleteAll(db, 'relverbas');
}

function deleteBenefitsBySource(db, source) {
  const s = String(source || '').toLowerCase();
  const table =
    s === 'uphealth' ? 'planoup' :
    s === 'odontoprev' ? 'planoodonto' :
    'planounimed';

  return safeDeleteAll(db, table);
}

function getTablePreview(db, table, maxRows = 5000) {
  const cols = getColumns(db, table);
  if (cols.length === 0) return { columns: [], rows: [] };

  const sql = `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${table}" LIMIT ?`;
  const rows = db.prepare(sql).all(maxRows);

  return {
    columns: cols,
    rows: rows.map(r => cols.map(c => r[c]))
  };
}

function getEmployeesPreview(db, maxRows = 5000) {
  return getTablePreview(db, 'funcionario', maxRows);
}

function getBenefitsPreview(db, source, maxRows = 5000) {
  const s = (source || '').toLowerCase();
  const table =
    s === 'uphealth' ? 'planoup' :
    s === 'odontoprev' ? 'planoodonto' :
    'planounimed';
  return getTablePreview(db, table, maxRows);
}

// ✅ Preview dependentes
function getDependentesPreview(db, maxRows = 5000) {
  return getTablePreview(db, 'unimed_dependente', maxRows);
}

function buildGfipPreviewColumns() {
  return [
    'nome_trabalhador',
    'pis_pasep_ci',
    'admissao',
    'rem_sem_13_sal',
    'contrib_seg_devida',
    'base_cal_prev_social'
  ];
}

function buildGfipRows(db, source, maxRows = null) {
  const table = resolveGfipTable(source);
  if (!tableExists(db, table)) return [];

  // Mantem o schema interno fiel ao PDF e monta a pre-visualizacao no layout pedido.
  // A coluna "CONTRIB SEG DEVIDA" corresponde ao 4o valor numerico do PDF.
  // A "BASE CAL PREV SOCIAL" exibida aqui reaproveita o campo de base capturado na importacao.
  const sql = `
    SELECT
      nome_trabalhador,
      pis_pasep_ci,
      admissao,
      rem_sem_13_sal,
      contrib_seg_devida,
      base_cal_13_sal_prev_social AS base_cal_prev_social
    FROM "${table}"
    ORDER BY ordem
    ${maxRows != null ? 'LIMIT ?' : ''}
  `;

  return maxRows != null
    ? db.prepare(sql).all(maxRows)
    : db.prepare(sql).all();
}

function getGfipPreview(db, source, maxRows = 5000) {
  const columns = buildGfipPreviewColumns();
  const rows = buildGfipRows(db, source, maxRows);

  return {
    columns,
    rows: rows.map((row) => columns.map((column) => row[column]))
  };
}

function getGfipExportRows(db, source) {
  return buildGfipRows(db, source, null);
}

function buildRelVerbasPreviewColumns() {
  return [
    'ordem',
    'fl',
    'matricula',
    'nome',
    'cpf',
    'ano_mes',
    'cod_verba',
    'desc_verba',
    'ref_qtd',
    'valor',
    'data_pagto',
    'ccusto'
  ];
}

function getRelVerbasPreview(db, maxRows = 5000) {
  if (!tableExists(db, 'relverbas')) return { columns: [], rows: [] };

  const columns = buildRelVerbasPreviewColumns();
  const rows = db.prepare(`
    SELECT ${columns.map((column) => `"${column}"`).join(', ')}
      FROM relverbas
     ORDER BY ordem
     LIMIT ?
  `).all(maxRows);

  return {
    columns,
    rows: rows.map((row) => columns.map((column) => row[column]))
  };
}

function getRelVerbasRubricas(db) {
  if (!tableExists(db, 'relverbas')) return [];

  return db.prepare(`
    SELECT
      TRIM(cod_verba) AS cod_verba,
      MAX(TRIM(desc_verba)) AS desc_verba,
      COUNT(*) AS total_registros
    FROM relverbas
    WHERE IFNULL(TRIM(cod_verba), '') <> ''
    GROUP BY TRIM(cod_verba)
    ORDER BY
      CASE
        WHEN TRIM(cod_verba) GLOB '[0-9]*' THEN CAST(TRIM(cod_verba) AS INTEGER)
        ELSE 999999999
      END,
      TRIM(cod_verba)
  `).all();
}

function getRelVerbasExportRows(db, codigos = []) {
  if (!tableExists(db, 'relverbas')) return [];

  const normalizedCodes = Array.from(
    new Set(
      (codigos || [])
        .map((code) => String(code || '').trim())
        .filter(Boolean)
    )
  );

  if (!normalizedCodes.length) return [];

  const placeholders = normalizedCodes.map(() => '?').join(', ');
  return db.prepare(`
    SELECT
      fl,
      matricula,
      nome,
      cpf,
      ano_mes,
      cod_verba,
      desc_verba,
      ref_qtd,
      valor,
      data_pagto,
      ccusto
    FROM relverbas
    WHERE TRIM(cod_verba) IN (${placeholders})
    ORDER BY ordem
  `).all(...normalizedCodes);
}

function getDependentesUnimedForExport(db) {
  return db.prepare(`
    SELECT beneficiario, cpf, cpfresponsavel
      FROM unimed_dependente
     WHERE IFNULL(TRIM(cpfresponsavel), '') <> ''
     ORDER BY beneficiario, cpf
  `).all();
}

function getValesAlimentacao(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT Id_Vale, Nome, Valor, dias_trabalhados
      FROM vale_alimentacao
     ORDER BY Id_Vale
  `).all();
}

function saveValeAlimentacao(db, payload) {
  ensureSchema(db);
  const idRaw = Number(payload?.Id_Vale);
  const hasId = Number.isFinite(idRaw) && idRaw > 0;
  const nome = String(payload?.Nome || '').trim();
  const valor = Number(payload?.Valor);
  const dias = Number(payload?.dias_trabalhados ?? 0);

  if (!nome) throw new Error('Nome é obrigatório.');
  if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor inválido.');
  if (!Number.isFinite(dias) || dias < 0) throw new Error('Dias trabalhados inválido.');

  if (hasId) {
    const upd = db.prepare(`
      UPDATE vale_alimentacao
         SET Nome = ?, Valor = ?, dias_trabalhados = ?
       WHERE Id_Vale = ?
    `);
    return upd.run(nome, valor, Math.trunc(dias), idRaw).changes;
  }

  const ins = db.prepare(`
    INSERT INTO vale_alimentacao (Nome, Valor, dias_trabalhados)
    VALUES (?, ?, ?)
  `);
  const r = ins.run(nome, valor, Math.trunc(dias));
  return r.changes;
}

function deleteValeAlimentacao(db, idVale) {
  ensureSchema(db);
  const id = Number(idVale);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Id_Vale inválido.');

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM vale_ccusto WHERE Id_Vale = ?`).run(id);
    return db.prepare(`DELETE FROM vale_alimentacao WHERE Id_Vale = ?`).run(id).changes;
  });
  return tx();
}

function getCentrosCusto(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT
      TRIM(CCusto) AS CCusto,
      TRIM(CCustoDescricao) AS CCustoDescricao
    FROM funcionario
    WHERE IFNULL(TRIM(CCusto), '') <> ''
    GROUP BY TRIM(CCusto), TRIM(CCustoDescricao)
    ORDER BY TRIM(CCusto)
  `).all();
}

function getValeCcustoVinculos(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT
      vc.CCusto,
      COALESCE(f.CCustoDescricao, '') AS CCustoDescricao,
      vc.Id_Vale,
      va.Nome AS NomeVale,
      va.Valor AS ValorVale
    FROM vale_ccusto vc
    LEFT JOIN vale_alimentacao va ON va.Id_Vale = vc.Id_Vale
    LEFT JOIN (
      SELECT TRIM(CCusto) AS CCusto, MAX(TRIM(CCustoDescricao)) AS CCustoDescricao
      FROM funcionario
      GROUP BY TRIM(CCusto)
    ) f ON f.CCusto = vc.CCusto
    ORDER BY vc.CCusto
  `).all();
}

function saveValeCcustoVinculo(db, payload) {
  ensureSchema(db);
  const ccusto = String(payload?.CCusto || '').trim();
  const idVale = Number(payload?.Id_Vale);

  if (!ccusto) throw new Error('Centro de custo é obrigatório.');
  if (!Number.isFinite(idVale) || idVale <= 0) throw new Error('Id_Vale inválido.');

  const vale = db.prepare(`SELECT Id_Vale FROM vale_alimentacao WHERE Id_Vale = ?`).get(idVale);
  if (!vale) throw new Error('Vale alimentação não encontrado.');

  const stmt = db.prepare(`
    INSERT INTO vale_ccusto (CCusto, Id_Vale)
    VALUES (?, ?)
    ON CONFLICT(CCusto) DO UPDATE SET
      Id_Vale = excluded.Id_Vale
  `);
  return stmt.run(ccusto, idVale).changes;
}

function deleteValeCcustoVinculo(db, ccusto) {
  ensureSchema(db);
  const key = String(ccusto || '').trim();
  if (!key) throw new Error('Centro de custo inválido.');
  return db.prepare(`DELETE FROM vale_ccusto WHERE CCusto = ?`).run(key).changes;
}

function normalizeYmdDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Data inválida. Use o formato YYYY-MM-DD.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    throw new Error('Data inválida.');
  }

  return raw;
}

function getFuncionariosParaApontamento(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT
      TRIM(CPF) AS CPF,
      MAX(TRIM(Cadastro)) AS Cadastro,
      MAX(TRIM(Nome)) AS Nome
    FROM funcionario
    WHERE IFNULL(TRIM(CPF), '') <> ''
    GROUP BY TRIM(CPF)
    ORDER BY MAX(TRIM(Nome))
  `).all();
}

function getValeApontamentos(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT
      a.CPF,
      COALESCE(f.Cadastro, '') AS Cadastro,
      COALESCE(f.Nome, '') AS Nome,
      a.data_afastamento,
      a.data_retorno,
      a.updated_at
    FROM vale_apontamento_funcionario a
    LEFT JOIN (
      SELECT TRIM(CPF) AS CPF, MAX(TRIM(Cadastro)) AS Cadastro, MAX(TRIM(Nome)) AS Nome
      FROM funcionario
      GROUP BY TRIM(CPF)
    ) f ON f.CPF = a.CPF
    WHERE IFNULL(TRIM(a.data_afastamento), '') <> ''
       OR IFNULL(TRIM(a.data_retorno), '') <> ''
    ORDER BY COALESCE(f.Nome, ''), a.CPF
  `).all();
}

function saveValeApontamento(db, payload) {
  ensureSchema(db);
  const cpf = String(payload?.CPF || '').trim();
  const dataAfastamento = normalizeYmdDate(payload?.data_afastamento ?? payload?.dataAfastamento);
  const dataRetorno = normalizeYmdDate(payload?.data_retorno ?? payload?.dataRetorno);

  if (!cpf) throw new Error('CPF é obrigatório.');
  if (!dataAfastamento && !dataRetorno) {
    throw new Error('Informe ao menos uma data de afastamento ou retorno.');
  }

  if (dataAfastamento && dataRetorno && dataRetorno <= dataAfastamento) {
    throw new Error('A data de retorno deve ser maior que a data de afastamento.');
  }

  const stmt = db.prepare(`
    INSERT INTO vale_apontamento_funcionario (CPF, dias_trabalhados, data_afastamento, data_retorno, updated_at)
    VALUES (?, 0, ?, ?, datetime('now'))
    ON CONFLICT(CPF) DO UPDATE SET
      data_afastamento = excluded.data_afastamento,
      data_retorno = excluded.data_retorno,
      updated_at = datetime('now')
  `);
  return stmt.run(cpf, dataAfastamento, dataRetorno).changes;
}

function deleteValeApontamento(db, cpf) {
  ensureSchema(db);
  const key = String(cpf || '').trim();
  if (!key) throw new Error('CPF inválido.');
  return db.prepare(`DELETE FROM vale_apontamento_funcionario WHERE CPF = ?`).run(key).changes;
}

function getValeFaltas(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT
      f.CPF,
      COALESCE(e.Cadastro, '') AS Cadastro,
      COALESCE(e.Nome, '') AS Nome,
      f.faltas,
      f.updated_at
    FROM vale_falta_funcionario f
    LEFT JOIN (
      SELECT TRIM(CPF) AS CPF, MAX(TRIM(Cadastro)) AS Cadastro, MAX(TRIM(Nome)) AS Nome
      FROM funcionario
      GROUP BY TRIM(CPF)
    ) e ON e.CPF = f.CPF
    ORDER BY COALESCE(e.Nome, ''), f.CPF
  `).all();
}

function saveValeFalta(db, payload) {
  ensureSchema(db);
  const cpf = String(payload?.CPF || '').trim();
  const faltas = Number(payload?.faltas);

  if (!cpf) throw new Error('CPF é obrigatório.');
  if (!Number.isFinite(faltas) || faltas < 0) throw new Error('Faltas inválidas.');

  const stmt = db.prepare(`
    INSERT INTO vale_falta_funcionario (CPF, faltas, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(CPF) DO UPDATE SET
      faltas = excluded.faltas,
      updated_at = datetime('now')
  `);
  return stmt.run(cpf, Math.trunc(faltas)).changes;
}

function deleteValeFalta(db, cpf) {
  ensureSchema(db);
  const key = String(cpf || '').trim();
  if (!key) throw new Error('CPF inválido.');
  return db.prepare(`DELETE FROM vale_falta_funcionario WHERE CPF = ?`).run(key).changes;
}

// ✅ ÚNICO DELETE em funcionario (um lugar só)
function deleteDemitidos(db, regra) {
  const raw = String(regra ?? '').trim().toLowerCase();

  // "todos" => não deleta nenhum demitido
  if (!raw || raw === 'todos') {
    return 0;
  }

  // "nenhum"/"nehum" => deleta todos os demitidos
  if (raw === 'nenhum' || raw === 'nehum') {
    const stmtNenhum = db.prepare(`
      DELETE FROM funcionario
       WHERE (TRIM(Situacao) = '7' OR TRIM(Situacao) = '007')
    `);
    return stmtNenhum.run().changes;
  }

  if (raw === 'mes_atual') {
    const stmtMesAtual = db.prepare(`
      DELETE FROM funcionario
       WHERE (TRIM(Situacao) = '7' OR TRIM(Situacao) = '007')
         AND COALESCE(
               strftime('%Y-%m', date(
                 substr(DataAfastamento, 7, 4) || '-' ||
                 substr(DataAfastamento, 4, 2) || '-' ||
                 substr(DataAfastamento, 1, 2)
               )),
               ''
             ) <> strftime('%Y-%m', 'now', 'localtime')
    `);
    return stmtMesAtual.run().changes;
  }

  const mNum = Number(raw);
  const m = Number.isFinite(mNum) ? Math.max(0, mNum) : 0;
  if (m <= 0) return 0;

  // limite = 1º dia do mês atual - m meses (yyyy-MM-dd)
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const limite = new Date(first.getFullYear(), first.getMonth() - m, 1);
  const limiteStr = limite.toISOString().slice(0, 10);
 
  const stmtMeses = db.prepare(`
    DELETE FROM funcionario
      WHERE (TRIM(Situacao) = '7' OR TRIM(Situacao) = '007')
        AND IFNULL(TRIM(DataAfastamento),'') <> ''
        AND date(
              substr(DataAfastamento, 7, 4) || '-' ||
              substr(DataAfastamento, 4, 2) || '-' ||
              substr(DataAfastamento, 1, 2)
            ) < date(?)
  `);

  return stmtMeses.run(limiteStr).changes;
}

/**
 * ✅ Conserta schema errado do planounimed (quando alguém criou só com id)
 * Deve rodar ANTES do Python inserir.
 */
function repairPlanounimedIfNeeded(db) {
  if (!tableExists(db, 'planounimed')) return;

  const cols = getColumns(db, 'planounimed').map(c => c.toLowerCase());
  const mustHave = ['codigo', 'beneficiario', 'tp', 'cpf', 'valor'];

  const ok = mustHave.every(c => cols.includes(c));
  if (!ok) {
    db.prepare(`DROP TABLE IF EXISTS planounimed`).run();
  }
}

/**
 * ✅ Migração: antes era UNIQUE(cpf, cpfresponsavel) (errado pro teu fluxo)
 * Agora: CPF do dependente é único.
 *
 * - cria índice único por cpf
 * - remove índice antigo (se existir)
 * - remove duplicados mantendo o que tem cpfresponsavel preenchido
 */
function migrateUnimedDependenteUniqueCpf(db) {
  ensureSchema(db);

  // cria índice novo (se já existir, ok)
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ux_unimed_dependente_cpf ON unimed_dependente(cpf)`).run();

  // remove índices antigos suspeitos (nome varia; tenta derrubar os que mencionam responsavel)
  const idxs = db.prepare(`
    SELECT name, sql
      FROM sqlite_master
     WHERE type='index'
       AND tbl_name='unimed_dependente'
       AND IFNULL(name,'') <> 'ux_unimed_dependente_cpf'
  `).all();

  for (const it of idxs) {
    const name = String(it.name || '');
    const sql = String(it.sql || '').toLowerCase();
    const hit = name.toLowerCase().includes('responsavel') || sql.includes('cpfresponsavel');
    if (hit) {
      try { db.prepare(`DROP INDEX IF EXISTS "${name}"`).run(); } catch {}
    }
  }

  // dedup por cpf: mantém o registro com cpfresponsavel preenchido; senão mantém o mais antigo
  // (usa subquery + rowid/id pra não depender de ROW_NUMBER)
  db.exec(`
    DELETE FROM unimed_dependente
     WHERE id IN (
       SELECT d1.id
         FROM unimed_dependente d1
         JOIN unimed_dependente d2
           ON d1.cpf = d2.cpf
          AND d1.id <> d2.id
        WHERE
          -- d1 é o "perdedor"
          (
            (IFNULL(TRIM(d1.cpfresponsavel),'') = '' AND IFNULL(TRIM(d2.cpfresponsavel),'') <> '')
            OR
            (
              (IFNULL(TRIM(d1.cpfresponsavel),'') = IFNULL(TRIM(d2.cpfresponsavel),''))
              AND datetime(IFNULL(d1.created_at,'1970-01-01')) > datetime(IFNULL(d2.created_at,'1970-01-01'))
            )
            OR
            (
              (IFNULL(TRIM(d1.cpfresponsavel),'') = IFNULL(TRIM(d2.cpfresponsavel),''))
              AND datetime(IFNULL(d1.created_at,'1970-01-01')) = datetime(IFNULL(d2.created_at,'1970-01-01'))
              AND d1.id > d2.id
            )
          )
     );
  `);
}

function deleteDependenteById(db, id) {
  const rid = Number(id);
  if (!Number.isFinite(rid) || rid <= 0) throw new Error('ID inválido.');
  return db.prepare(`DELETE FROM unimed_dependente WHERE id = ?`).run(rid).changes;
}

function updateCpfResponsavelById(db, id, cpfresponsavel) {
  const rid = Number(id);
  const cpfresp = String(cpfresponsavel || '').trim();
  if (!Number.isFinite(rid) || rid <= 0) throw new Error('ID inválido.');
  if (!cpfresp) throw new Error('CPF do responsável é obrigatório.');

  return db.prepare(`
    UPDATE unimed_dependente
       SET cpfresponsavel = ?
     WHERE id = ?
  `).run(cpfresp, rid).changes;
}

function normalizeCpfKey(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function importDependentesUnimedRows(db, rows) {
  ensureSchema(db);
  migrateUnimedDependenteUniqueCpf(db);

  const all = db.prepare(`
    SELECT id, beneficiario, cpf, cpfresponsavel
      FROM unimed_dependente
  `).all();

  const byCpfKey = new Map();
  for (const r of all) {
    const key = normalizeCpfKey(r.cpf);
    if (!key) continue;
    if (!byCpfKey.has(key)) byCpfKey.set(key, r);
  }

  const insertStmt = db.prepare(`
    INSERT INTO unimed_dependente (beneficiario, cpf, cpfresponsavel)
    VALUES (?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE unimed_dependente
       SET beneficiario = CASE
            WHEN IFNULL(TRIM(?), '') <> '' THEN ?
            ELSE beneficiario
          END,
           cpfresponsavel = CASE
            WHEN IFNULL(TRIM(cpfresponsavel), '') = '' AND IFNULL(TRIM(?), '') <> '' THEN ?
            ELSE cpfresponsavel
          END
     WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let ignored = 0;

  const tx = db.transaction(() => {
    for (const row of rows || []) {
      const beneficiario = String(row?.beneficiario || '').trim();
      const cpf = String(row?.cpf || '').trim();
      const cpfresponsavel = String(row?.cpfresponsavel || '').trim();

      if (!beneficiario || !cpf) {
        ignored++;
        continue;
      }

      const key = normalizeCpfKey(cpf);
      if (!key) {
        ignored++;
        continue;
      }

      const existing = byCpfKey.get(key);
      if (existing) {
        const r = updateStmt.run(
          beneficiario,
          beneficiario,
          cpfresponsavel,
          cpfresponsavel,
          existing.id
        );
        if (r.changes > 0) updated++;
        else ignored++;
        continue;
      }

      try {
        insertStmt.run(beneficiario, cpf, cpfresponsavel);
        inserted++;
      } catch {
        ignored++;
      }
    }
  });

  tx();
  return { inserted, updated, ignored, total: (rows || []).length };
}

/**
 * ✅ Popular unimed_dependente após importar planounimed
 * Regra:
 * - CPF do dependente é único (não duplica mais)
 * - Reimportação NÃO zera cpfresponsavel já preenchido na manutenção
 */
function populateUnimedDependentesFromPlano(db) {
  if (!tableExists(db, 'planounimed')) return 0;

  ensureSchema(db);
  migrateUnimedDependenteUniqueCpf(db);

  const sqlSource = `
    WITH src AS (
      SELECT
        TRIM(d.cpf) AS cpf,
        MAX(TRIM(d.beneficiario)) AS beneficiario
      FROM planounimed d
      WHERE d.tp = 'D'
        AND IFNULL(TRIM(d.beneficiario), '') <> ''
        AND IFNULL(TRIM(d.cpf), '') <> ''
      GROUP BY TRIM(d.cpf)
    )
  `;

  const toInsert = db.prepare(`
    ${sqlSource}
    SELECT COUNT(*) AS c
    FROM src s
    LEFT JOIN unimed_dependente u ON u.cpf = s.cpf
    WHERE u.cpf IS NULL;
  `).get().c;

  const stmt = db.prepare(`
    ${sqlSource}
    INSERT INTO unimed_dependente (beneficiario, cpf, cpfresponsavel)
    SELECT
      s.beneficiario,
      s.cpf,
      '' AS cpfresponsavel
    FROM src s
    WHERE 1=1
    ON CONFLICT(cpf) DO UPDATE SET
      beneficiario = excluded.beneficiario,
      cpfresponsavel = CASE
        WHEN IFNULL(TRIM(unimed_dependente.cpfresponsavel),'') <> '' THEN unimed_dependente.cpfresponsavel
        ELSE unimed_dependente.cpfresponsavel
      END;
  `);

  stmt.run();
  return toInsert;
}

module.exports = {
  openDb,
  getDbPath,
  ensureSchema,
  clearBenefits,
  clearValeFaltas,
  clearGfip,
  clearRelVerbas,
  deleteBenefitsBySource,
  getEmployeesPreview,
  getBenefitsPreview,
  getDependentesPreview,
  getGfipPreview,
  getRelVerbasPreview,
  getRelVerbasRubricas,
  getRelVerbasExportRows,
  getGfipExportRows,
  getDependentesUnimedForExport,
  getValesAlimentacao,
  saveValeAlimentacao,
  deleteValeAlimentacao,
  getCentrosCusto,
  getValeCcustoVinculos,
  saveValeCcustoVinculo,
  deleteValeCcustoVinculo,
  getFuncionariosParaApontamento,
  getValeApontamentos,
  saveValeApontamento,
  deleteValeApontamento,
  getValeFaltas,
  saveValeFalta,
  deleteValeFalta,
  getTablePreview,
  deleteDemitidos,
  repairPlanounimedIfNeeded,
  migrateUnimedDependenteUniqueCpf,
  populateUnimedDependentesFromPlano,
  deleteDependenteById,
  updateCpfResponsavelById,
  importDependentesUnimedRows
};
