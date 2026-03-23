const XLSX = require('xlsx');

const REL_VERBAS_EXPORT_COLUMNS = [
  ['FL', 'fl'],
  ['MATRICULA', 'matricula'],
  ['NOME', 'nome'],
  ['CPF', 'cpf'],
  ['ANO / MÊS', 'ano_mes'],
  ['CÓD. VERBA', 'cod_verba'],
  ['DESC. VERBA', 'desc_verba'],
  ['REF. QTD', 'ref_qtd'],
  ['VALOR', 'valor'],
  ['DATA_PAGTO', 'data_pagto'],
  ['CCUSTO', 'ccusto'],
];

function createRelVerbasWorkbook(rows = []) {
  const workbook = XLSX.utils.book_new();
  const sheetRows = [
    REL_VERBAS_EXPORT_COLUMNS.map(([label]) => label),
    ...rows.map((row) => REL_VERBAS_EXPORT_COLUMNS.map(([, key]) => row?.[key] ?? ''))
  ];

  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: REL_VERBAS_EXPORT_COLUMNS.length - 1, r: Math.max(sheetRows.length - 1, 0) }
    })
  };

  const colWidths = REL_VERBAS_EXPORT_COLUMNS.map(([label], idx) => {
    const values = sheetRows.map((row) => String(row[idx] ?? ''));
    const maxLen = values.reduce((acc, value) => Math.max(acc, value.length), label.length);
    return { wch: Math.min(Math.max(maxLen + 2, 12), 36) };
  });
  sheet['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(workbook, sheet, 'RelVerbas');
  return {
    workbook,
    exported: rows.length,
    columns: REL_VERBAS_EXPORT_COLUMNS.map(([label]) => label)
  };
}

module.exports = {
  REL_VERBAS_EXPORT_COLUMNS,
  createRelVerbasWorkbook
};
