const XLSX = require('xlsx');

const REQUIRED_HEADERS = [
  'Empresa', 'Tipo', 'Cadastro', 'Nome', 'Admissao', 'Situacao', 'Escala', 'CCusto', 'CCustoDescricao',
  'DataAfastamento', 'CPF', 'Nascimento'
];

const ALIASES = {
  'c.custo': 'CCusto',
  'custo': 'CCusto',
  'descrição (c.custo)': 'CCustoDescricao',
  'descricao (c.custo)': 'CCustoDescricao',
  'descrição': 'CCustoDescricao',
  'descricao': 'CCustoDescricao',
  'admissão': 'Admissao',
  'situação': 'Situacao',
  'data afastamento': 'DataAfastamento'
};

function normHeader(h) {
  const s = String(h || '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  return ALIASES[low] || s.replace(/\s+/g, '');
}

function validateHeaders(headers) {
  const set = new Set(headers);
  const missing = REQUIRED_HEADERS.filter(h => !set.has(h));
  if (missing.length) throw new Error(`Arquivo incompatível. Campo obrigatório ausente: ${missing.join(', ')}`);
}

function normalizeCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function isCadastroNewer(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');

  const na = da ? Number(da) : Number.NaN;
  const nb = db ? Number(db) : Number.NaN;

  if (Number.isFinite(na) && Number.isFinite(nb)) return na > nb;
  if (Number.isFinite(na) && !Number.isFinite(nb)) return true;
  if (!Number.isFinite(na) && Number.isFinite(nb)) return false;
  return String(a || '').trim().localeCompare(String(b || '').trim(), 'pt-BR') > 0;
}

function importEmployeesXlsx(db, xlsxPath) {
  if (!xlsxPath) throw new Error('Selecione um XLSX válido.');

  const wb = XLSX.readFile(xlsxPath, { cellDates: false });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error('XLSX sem planilhas.');

  const ws = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if (!rows.length) throw new Error('XLSX vazio.');

  const headerRow = rows[0].map(normHeader);
  validateHeaders(headerRow);
 
  const idx = {};
  headerRow.forEach((h, i) => { if (h) idx[h] = i; });

  const clearFunc = db.prepare(`DELETE FROM funcionario`);

  const upsert = db.prepare(`
    INSERT INTO funcionario (
      Empresa, Tipo, Cadastro, Nome, Admissao, Situacao, Escala,
      CCusto, CCustoDescricao, DataAfastamento, CPF, Nascimento
    ) VALUES (
      @Empresa, @Tipo, @Cadastro, @Nome, @Admissao, @Situacao, @Escala,
      @CCusto, @CCustoDescricao, @DataAfastamento, @CPF, @Nascimento
    )
    ON CONFLICT(Empresa, Cadastro) DO UPDATE SET
      Tipo = excluded.Tipo,
      Nome = excluded.Nome,
      Admissao = excluded.Admissao,
      Situacao = excluded.Situacao,
      Escala = excluded.Escala,
      CCusto = excluded.CCusto,
      CCustoDescricao = excluded.CCustoDescricao,
      DataAfastamento = excluded.DataAfastamento,
      CPF = excluded.CPF,
      Nascimento = excluded.Nascimento
  `);

  let importedRows = 0;

  const tx = db.transaction(() => {
    // ✅ limpa antes de importar
    clearFunc.run();

    const byCpf = new Map();
    const withoutCpf = [];

    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      if (!line || !line.length) continue;

      const rec = {};
      for (const h of REQUIRED_HEADERS) rec[h] = String(line[idx[h]] ?? '').trim();

      if (!rec.Empresa || !rec.Cadastro) continue;

      const cpfKey = normalizeCpf(rec.CPF);
      if (!cpfKey) {
        withoutCpf.push(rec);
        continue;
      }

      const prev = byCpf.get(cpfKey);
      if (!prev || isCadastroNewer(rec.Cadastro, prev.Cadastro)) {
        byCpf.set(cpfKey, rec);
      }
    }

    for (const rec of byCpf.values()) {
      upsert.run(rec);
      importedRows++;
    }

    for (const rec of withoutCpf) {
      upsert.run(rec);
      importedRows++;
    }
  });

  tx();

  return { importedRows };
}

module.exports = { importEmployeesXlsx };
