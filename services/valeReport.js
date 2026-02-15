const ExcelJS = require('exceljs');

function parseBrDate(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  const dt = new Date(y, mo, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
 
function parseYmdDate(s) {
  const v = String(s || '').trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normSituacao(v) {
  const n = Number(String(v || '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function toMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function sameMonthYear(a, b) {
  return a && b && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

async function generateValeReport(db, outPath, dataBaseYmd) {
  const dataBase = parseYmdDate(dataBaseYmd);
  if (!dataBase) return { ok: false, error: 'Data base inválida.' };

  const rows = db.prepare(`
    SELECT
      f.Cadastro,
      f.Nome,
      f.CPF,
      f.Situacao,
      f.Admissao,
      f.DataAfastamento,
      f.CCusto,
      f.CCustoDescricao,
      vc.Id_Vale,
      va.Nome AS ValeNome,
      va.Valor AS ValeValor,
      va.dias_trabalhados AS DiasBaseVale,
      COALESCE(vf.faltas, 0) AS Faltas
    FROM funcionario f
    JOIN vale_ccusto vc
      ON TRIM(vc.CCusto) = TRIM(f.CCusto)
    JOIN vale_alimentacao va
      ON va.Id_Vale = vc.Id_Vale
    LEFT JOIN vale_falta_funcionario vf
      ON TRIM(vf.CPF) = TRIM(f.CPF)
  `).all();

  const exclui = new Set([55, 80]);
  const demitidos = new Set([3, 6, 7, 32]);
  const baseDay = dataBase.getDate();

  const detalhe = [];
  for (const r of rows) {
    const sit = normSituacao(r.Situacao);
    if (exclui.has(sit)) continue;

    const adm = parseBrDate(r.Admissao);
    if (adm && adm > dataBase) continue;

    const isDemitido = demitidos.has(sit);
    const afast = parseBrDate(r.DataAfastamento);
    if (isDemitido) {
      if (!afast) continue;
      // Demitido entra pela competência (mês/ano da Data Base).
      if (!sameMonthYear(afast, dataBase)) continue;
    }

    const valorVale = Number(r.ValeValor) || 0;
    const diasBase = Math.max(0, Number(r.DiasBaseVale) || 0);
    const faltas = Math.max(0, Number(r.Faltas) || 0);
    const proporcional = isDemitido || baseDay > 10;

    // Para demitidos, dias trabalhados no mês = dia da DataAfastamento (limitado ao diasBase do vale).
    const diasTrabalhadosEfetivos = isDemitido
      ? Math.min(diasBase, Math.max(0, afast ? afast.getDate() : 0))
      : diasBase;

    const diasLiquidos = Math.max(0, diasTrabalhadosEfetivos - faltas);

    let valorCalc = 0;
    let criterio = 'Integral';
    if (!proporcional) {
      valorCalc = valorVale * diasLiquidos;
    } else {
      criterio = 'Proporcional';
      valorCalc = valorVale * diasLiquidos;
    }

    detalhe.push({
      Cadastro: r.Cadastro || '',
      Nome: r.Nome || '',
      CPF: r.CPF || '',
      Situacao: r.Situacao || '',
      Admissao: r.Admissao || '',
      DataAfastamento: r.DataAfastamento || '',
      CCusto: r.CCusto || '',
      CCustoDescricao: r.CCustoDescricao || '',
      IdVale: r.Id_Vale || '',
      ValeNome: r.ValeNome || '',
      ValorVale: toMoney(valorVale),
      DiasTrabalhadosBase: diasTrabalhadosEfetivos,
      Faltas: faltas,
      DiasLiquidos: diasLiquidos,
      Criterio: criterio,
      ValorCalculado: toMoney(valorCalc)
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ImportadorBeneficios';
  wb.created = new Date();

  const wsInfo = wb.addWorksheet('Info');
  wsInfo.addRow(['Data Base', dataBaseYmd]);
  wsInfo.addRow(['Regra', 'Situação diferente de 55 e 80']);
  wsInfo.addRow(['Regra', 'Admissão <= Data Base']);
  wsInfo.addRow(['Regra', 'Demitidos (3,6,7,32) somente no mês da Data Base']);
  wsInfo.addRow(['Regra', 'Até dia 10 integral; após dia 10 proporcional']);

  const wsDet = wb.addWorksheet('Vale Detalhe');
  wsDet.columns = [
    { header: 'Cadastro', key: 'Cadastro', width: 12 },
    { header: 'Nome', key: 'Nome', width: 34 },
    { header: 'CPF', key: 'CPF', width: 18 },
    { header: 'Situação', key: 'Situacao', width: 10 },
    { header: 'Admissão', key: 'Admissao', width: 12 },
    { header: 'Data Afastamento', key: 'DataAfastamento', width: 16 },
    { header: 'C.Custo', key: 'CCusto', width: 10 },
    { header: 'Descrição C.Custo', key: 'CCustoDescricao', width: 28 },
    { header: 'Id_Vale', key: 'IdVale', width: 10 },
    { header: 'Vale', key: 'ValeNome', width: 20 },
    { header: 'Valor Vale', key: 'ValorVale', width: 12 },
    { header: 'Dias Base Vale', key: 'DiasTrabalhadosBase', width: 14 },
    { header: 'Faltas', key: 'Faltas', width: 10 },
    { header: 'Dias Líquidos', key: 'DiasLiquidos', width: 14 },
    { header: 'Critério', key: 'Criterio', width: 14 },
    { header: 'Valor Calculado', key: 'ValorCalculado', width: 14 }
  ];
  for (const row of detalhe) wsDet.addRow(row);

  wsDet.getRow(1).font = { bold: true };
  wsDet.getColumn('ValorVale').numFmt = '#,##0.00';
  wsDet.getColumn('ValorCalculado').numFmt = '#,##0.00';

  const resumoMap = new Map();
  for (const d of detalhe) {
    const key = `${d.CCusto}||${d.CCustoDescricao}`;
    const prev = resumoMap.get(key) || { CCusto: d.CCusto, CCustoDescricao: d.CCustoDescricao, Total: 0 };
    prev.Total += Number(d.ValorCalculado) || 0;
    resumoMap.set(key, prev);
  }

  const wsRes = wb.addWorksheet('Resumo CCusto');
  wsRes.columns = [
    { header: 'C.Custo', key: 'CCusto', width: 12 },
    { header: 'Descrição C.Custo', key: 'CCustoDescricao', width: 32 },
    { header: 'Total', key: 'Total', width: 16 }
  ];
  for (const r of resumoMap.values()) {
    wsRes.addRow({ ...r, Total: toMoney(r.Total) });
  }
  wsRes.getRow(1).font = { bold: true };
  wsRes.getColumn('Total').numFmt = '#,##0.00';

  await wb.xlsx.writeFile(outPath);
  return { ok: true, file: outPath, totalRegistros: detalhe.length };
}

module.exports = { generateValeReport };
