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

function getTablePreview(db, table, maxRows = 500) {
  const cols = getColumns(db, table);
  if (cols.length === 0) return { columns: [], rows: [] };

  const sql = `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${table}" LIMIT ?`;
  const rows = db.prepare(sql).all(maxRows);

  return {
    columns: cols,
    rows: rows.map(r => cols.map(c => r[c]))
  };
}

function getEmployeesPreview(db, maxRows = 500) {
  return getTablePreview(db, 'funcionario', maxRows);
}

function getBenefitsPreview(db, source, maxRows = 500) {
  const s = (source || '').toLowerCase();
  const table =
    s === 'uphealth' ? 'planoup' :
    s === 'odontoprev' ? 'planoodonto' :
    'planounimed';
  return getTablePreview(db, table, maxRows);
}

// ✅ Preview dependentes
function getDependentesPreview(db, maxRows = 500) {
  return getTablePreview(db, 'unimed_dependente', maxRows);
}

// ✅ ÚNICO DELETE em funcionario (um lugar só)
function deleteDemitidos(db, meses) {
  const m = Number.isFinite(meses) ? Math.max(0, Math.min(6, meses)) : 0;

  if (m <= 0) {
    // 0 meses => mais seguro: não apaga nada
    return 0;
  }

  // limite = 1º dia do mês atual - m meses (yyyy-MM-dd)
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const limite = new Date(first.getFullYear(), first.getMonth() - m, 1);
  const limiteStr = limite.toISOString().slice(0, 10);

  const stmt = db.prepare(`
    DELETE FROM funcionario
      WHERE (TRIM(Situacao) = '7' OR TRIM(Situacao) = '007')
        AND IFNULL(TRIM(DataAfastamento),'') <> ''
        AND date(
              substr(DataAfastamento, 7, 4) || '-' ||
              substr(DataAfastamento, 4, 2) || '-' ||
              substr(DataAfastamento, 1, 2)
            ) < date(?)
  `);

  return stmt.run(limiteStr).changes;
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
  getEmployeesPreview,
  getBenefitsPreview,
  getDependentesPreview,
  getTablePreview,
  deleteDemitidos,
  repairPlanounimedIfNeeded,
  migrateUnimedDependenteUniqueCpf,
  populateUnimedDependentesFromPlano,
  deleteDependenteById,
  updateCpfResponsavelById
};
