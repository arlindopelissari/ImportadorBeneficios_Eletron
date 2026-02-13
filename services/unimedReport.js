// services/unimedReport.js
// Relatório Unimed (XLSX) com:
// - Validação de pendências (sem vínculo com funcionário)
// - Aba "Por CCusto" (começa em B2, com borda e TOTAL GERAL)
// - Aba "Demitidos" (lista + soma no final)

const ExcelJS = require('exceljs');

function rowsToPreview(rows) {
  if (!rows || rows.length === 0) return { columns: [], rows: [] };

  const preferred = ['beneficiario', 'cpf', 'cpf_func', 'total_valor'];
  const keys = Object.keys(rows[0]);

  const columns = [
    ...preferred.filter(c => keys.includes(c)),
    ...keys.filter(c => !preferred.includes(c)),
  ];

  return {
    columns,
    rows: rows.map(r => columns.map(c => (r?.[c] ?? '')))
  };
}

function normalizeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function applyThinBorder(cell) {
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
  };
}

function formatSheetB2Table(ws, headers, dataRows, numberColumnIndexes = []) {
  // Tabela começando em B2
  const startRow = 2;
  const startCol = 2; // B

  // Cabeçalho
  for (let i = 0; i < headers.length; i++) {
    const cell = ws.getCell(startRow, startCol + i);
    cell.value = headers[i];
    cell.font = { bold: true };
    applyThinBorder(cell);
  }

  // Linhas
  let r = startRow + 1;
  for (const row of dataRows) {
    for (let c = 0; c < headers.length; c++) {
      const cell = ws.getCell(r, startCol + c);
      cell.value = row[c];
      applyThinBorder(cell);
    }
    r++;
  }

  // Formatação numérica (colunas específicas)
  for (const idx of numberColumnIndexes) {
    ws.getColumn(startCol + idx).numFmt = '#,##0.00';
  }

  // Largura (básico)
  for (let i = 0; i < headers.length; i++) {
    ws.getColumn(startCol + i).width = Math.max(16, String(headers[i]).length + 4);
  }
}

function addCCustoResumoSheet(workbook, rowsResumo, dO) {
  const ws = workbook.addWorksheet(dO);

  // Monta dados: [CCustoDescricao, total_valor]
  let totalGeral = 0;
  const tableRows = rowsResumo.map(r => {
    const v = normalizeNumber(r.total_valor);
    totalGeral += v;
    return [r.CCustoDescricao, v];
  });

  // adiciona TOTAL GERAL no final
  tableRows.push(['TOTAL GERAL', totalGeral]);

  formatSheetB2Table(
    ws,
    ['Centro de Custo', 'Valor'],
    tableRows,
    [1] // coluna 2 (index 1) é numérica
  );

  // deixa a linha do TOTAL em negrito
  const lastRow = 2 + tableRows.length;
  ws.getRow(lastRow).font = { bold: true };

  // Ajuste fino de colunas
  ws.getColumn(2).width = 35; // CCustoDescricao
  ws.getColumn(3).width = 18; // total_valor
}

function addDemitidosSheet(workbook, rowsDemitidos) {
  const ws = workbook.addWorksheet('Demitidos');

  // Cabeçalhos do seu SQL_QUERY_02
  const headers = ['Plano','Cadastro', 'Centro de Custo', 'Nome', 'CPF', 'Data Afastamento', 'Valor'];

let totalGeral = 0;
const tableRows = rowsDemitidos.map(r => {
  const v = normalizeNumber(r.total_valor);
  totalGeral += v;

  return [
    r.Plano ?? '',
    r.Cadastro ?? '',
    r.CCustoDescricao ?? '',
    r.nome ?? '',
    r.cpf ?? '',
    r.DataAfastamento ?? '',
    v
  ];
});

  // TOTAL GERAL no final
  tableRows.push(['', '', '', '', 'TOTAL GERAL', totalGeral]);
  
  formatSheetB2Table(
    ws,
    headers,
    tableRows,
    [5] // total_valor
  );

  const lastRow = 2 + tableRows.length;
  ws.getRow(lastRow).font = { bold: true };
  
  // Mescla B..F na linha TOTAL (B=2, F=6, G=7)
  ws.mergeCells(lastRow, 2, lastRow, 6); // B:lastRow até F:lastRow

  const cellTotalLabel = ws.getCell(lastRow, 2); // B:lastRow
  cellTotalLabel.value = 'TOTAL GERAL';
  cellTotalLabel.alignment = { horizontal: 'right', vertical: 'middle' };
  cellTotalLabel.font = { bold: true };

  // larguras melhores
  ws.getColumn(2).width = 14; // Cadastro (col B)
  ws.getColumn(3).width = 30; // CCustoDescricao
  ws.getColumn(4).width = 28; // nome
  ws.getColumn(5).width = 18; // cpf
  ws.getColumn(6).width = 16; // DataAfastamento
  ws.getColumn(7).width = 16; // total_valor
}

async function generateUnimedReport(db, outPath) {
  // 1) Validação pendências
  const pendencias = db.prepare(SQL_VALIDACAO).all();
  if (pendencias.length > 0) {
    return {
      ok: false,
      pendencias,
      pendenciasPreview: rowsToPreview(pendencias),
    };
  }

  // 2) Dados
  const resumoCCusto = db.prepare(SQL_QUERY_CCUSTO_RESUMO).all();
  const resumoCCustoOD = db.prepare(SQL_ODONTO).all();
  const resumoCCustoUpHealth = db.prepare(SQL_Up_Health).all();
  const demitidos = db.prepare(SQL_QUERY_02).all();

  // 3) XLSX (ExcelJS)
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ImportadorBeneficios';
  workbook.created = new Date();

  addCCustoResumoSheet(workbook, resumoCCusto,'Plano Unimed');
  addCCustoResumoSheet(workbook, resumoCCustoOD,'Odonto Prev');
  addCCustoResumoSheet(workbook, resumoCCustoUpHealth,'Up Health');
  addDemitidosSheet(workbook, demitidos);

  await workbook.xlsx.writeFile(outPath);
  return { ok: true, file: outPath };
}

// =========================
// QUERIES (do usuário)
// =========================

// Validação: CPF sem vínculo com funcionário
const SQL_VALIDACAO = `
WITH SemResp AS (
  SELECT
    p.*,
    COALESCE(
      (SELECT d.cpfresponsavel
       FROM unimed_dependente d
       WHERE d.cpf = p.cpf
       LIMIT 1),
      p.cpf
    ) AS cpf_func
  FROM planounimed p
)
SELECT
  b.beneficiario,
  b.cpf,
  SUM(
    CAST(
      REPLACE(REPLACE(REPLACE(b.valor,'R$',''),' ',''),',','.') AS REAL
    )
  ) AS total_valor
FROM SemResp b
LEFT JOIN funcionario f
  ON f.CPF = b.cpf_func
WHERE
  f.CPF IS NULL
GROUP BY b.beneficiario, b.cpf
ORDER BY b.beneficiario;
`;

// RESUMO por CCustoDescricao (o que você mostrou no print)
const SQL_QUERY_CCUSTO_RESUMO = `
WITH base AS (
  SELECT
    p.*,
    COALESCE(
      (SELECT d.cpfresponsavel
       FROM unimed_dependente d
       WHERE d.cpf = p.cpf
       LIMIT 1),
      p.cpf
    ) AS cpf_func
  FROM planounimed p
)
SELECT
  f.CCustoDescricao,
  SUM(
    CAST(
      REPLACE(REPLACE(REPLACE(b.valor,'R$',''),' ',''),',','.') AS REAL
    )
  ) AS total_valor
FROM base b
JOIN funcionario f
  ON f.CPF = b.cpf_func
GROUP BY f.CCustoDescricao
ORDER BY f.CCustoDescricao;
`;
// Query Odonto (resumo por CCustoDescricao)
const SQL_ODONTO = ` 
  SELECT
    f.CCustoDescricao AS CCustoDescricao,
    SUM(
      CAST(
        REPLACE(REPLACE(REPLACE(p.Valor,'R$',''),' ',''),',','.') AS REAL
      )
    ) AS total_valor
  FROM funcionario f
  JOIN planoodonto p
    ON p.Nome = f.Nome
  WHERE IFNULL(p.Valor,'') <> ''
  GROUP BY
    f.CCustoDescricao
     order by f.CCustoDescricao;`;

// Query Odonto (resumo por CCustoDescricao)
const SQL_Up_Health = ` 
  SELECT
    f.CCustoDescricao AS CCustoDescricao,
    --p.beneficiario,

    SUM(
      CAST(
        REPLACE(REPLACE(REPLACE(p.valor_total,'R$',''),' ',''),',','.') AS REAL
      )
    ) AS total_valor
  FROM planoup p
  left JOIN funcionario f 
    ON REPLACE(REPLACE(p.cpf,'.',''),'-','')  = REPLACE(REPLACE(f.CPF,'.',''),'-','')
  WHERE IFNULL(p.valor_total,'') <> '' and p.valor_total<> 0
  GROUP BY
    f.CCustoDescricao
    --,p.beneficiario
    order by f.CCustoDescricao;`;

// Query 02 (Demitidos)
const SQL_QUERY_02 = `
WITH DemitidosUnimed AS (
  SELECT
    p.*,
    COALESCE(
      (SELECT d.cpfresponsavel
       FROM unimed_dependente d
       WHERE d.cpf = p.cpf
       LIMIT 1),
      p.cpf
    ) AS cpf_func
  FROM planounimed p
),
Unimed AS (
  SELECT
    'Unimed' AS Plano,
    f.Cadastro        AS Cadastro,
    f.CCustoDescricao AS CCustoDescricao,
    f.Nome            AS nome,
    f.CPF             AS cpf,
    f.DataAfastamento AS DataAfastamento,
    SUM(
      CAST(
        REPLACE(REPLACE(REPLACE(b.valor,'R$',''),' ',''),',','.') AS REAL
      )
    ) AS total_valor
  FROM DemitidosUnimed b
  JOIN funcionario f
    ON f.CPF = b.cpf_func
  WHERE f.Situacao IN ('7','007')
  GROUP BY
    f.Cadastro, f.CCustoDescricao, f.Nome, f.CPF, f.DataAfastamento
),
Odonto AS (
  SELECT
    'Odontoprev' AS Plano,
    f.Cadastro        AS Cadastro,
    f.CCustoDescricao AS CCustoDescricao,
    f.Nome            AS nome,
    f.CPF             AS cpf,
    f.DataAfastamento AS DataAfastamento,
    SUM(
      CAST(
        REPLACE(REPLACE(REPLACE(p.Valor,'R$',''),' ',''),',','.') AS REAL
      )
    ) AS total_valor
  FROM funcionario f
  JOIN planoodonto p
    ON p.Nome = f.Nome
  WHERE f.Situacao IN ('7','007')
    AND IFNULL(p.Valor,'') <> ''
  GROUP BY
    f.Cadastro, f.CCustoDescricao, f.Nome, f.CPF, f.DataAfastamento
),
Up AS (
  SELECT
    'Up' AS Plano,
    f.Cadastro        AS Cadastro,
    f.CCustoDescricao AS CCustoDescricao,
    f.Nome            AS nome,
    f.CPF             AS cpf,
    f.DataAfastamento AS DataAfastamento,
    SUM(
      CAST(
        REPLACE(REPLACE(REPLACE(p.Valor,'R$',''),' ',''),',','.') AS REAL
      )
    ) AS total_valor
  FROM funcionario f
  JOIN planoup p
    ON p.beneficiario = f.Nome
  WHERE f.Situacao IN ('7','007')
    AND IFNULL(p.Valor,'') <> ''
  GROUP BY
    f.Cadastro, f.CCustoDescricao, f.Nome, f.CPF, f.DataAfastamento
)
SELECT *
FROM (
  SELECT * FROM Unimed
  UNION ALL
  SELECT * FROM Odonto
  UNION ALL
  SELECT * FROM Up
) tb
ORDER BY 
  Plano,
  CASE
    WHEN tb.DataAfastamento LIKE '____-__-__' THEN tb.DataAfastamento
    WHEN tb.DataAfastamento LIKE '__/__/____' THEN
      substr(tb.DataAfastamento, 7, 4) || '-' ||
      substr(tb.DataAfastamento, 4, 2) || '-' ||
      substr(tb.DataAfastamento, 1, 2)
    ELSE tb.DataAfastamento
  END,
  tb.CCustoDescricao,
  tb.nome;
`;


module.exports = { generateUnimedReport };
