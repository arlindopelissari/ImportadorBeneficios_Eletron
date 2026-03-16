const XLSX = require('xlsx');

const GFIP_SHEET_COLUMNS = [
  'NOME TRABALHADOR',
  'PIS/PASEP/CI',
  'ADMISSÃO',
  'REM SEM 13° SAL',
  'CONTRIB SEG DEVIDA',
  'BASE CÁL PREV SOCIAL'
];

function parseBrMoney(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function buildSheetData(rows = []) {
  const totals = {
    remSem13: 0,
    contribSegDevida: 0,
    baseCalPrevSocial: 0
  };

  const body = rows.map((row) => {
    const remSem13 = parseBrMoney(row?.rem_sem_13_sal);
    const contribSegDevida = parseBrMoney(row?.contrib_seg_devida);
    const baseCalPrevSocial = parseBrMoney(row?.base_cal_prev_social);

    totals.remSem13 += remSem13;
    totals.contribSegDevida += contribSegDevida;
    totals.baseCalPrevSocial += baseCalPrevSocial;

    return [
      String(row?.nome_trabalhador || '').trim(),
      String(row?.pis_pasep_ci || '').trim(),
      String(row?.admissao || '').trim(),
      round2(remSem13),
      round2(contribSegDevida),
      round2(baseCalPrevSocial)
    ];
  });

  const roundedTotals = {
    remSem13: round2(totals.remSem13),
    contribSegDevida: round2(totals.contribSegDevida),
    baseCalPrevSocial: round2(totals.baseCalPrevSocial)
  };

  return {
    sheetRows: [
      GFIP_SHEET_COLUMNS,
      ...body,
      [
        'TOTAL',
        '',
        '',
        roundedTotals.remSem13,
        roundedTotals.contribSegDevida,
        roundedTotals.baseCalPrevSocial
      ]
    ],
    dataRowCount: body.length,
    totals: roundedTotals
  };
}

function applyNumericFormatting(worksheet, startRow, endRow) {
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    for (const col of ['D', 'E', 'F']) {
      const cell = worksheet[`${col}${rowIndex}`];
      if (!cell) continue;
      cell.t = 'n';
      cell.z = '#,##0.00';
    }
  }
}

function appendGfipSheet(workbook, sheetName, rows = []) {
  const spec = buildSheetData(rows);
  const ws = XLSX.utils.aoa_to_sheet(spec.sheetRows);
  ws['!cols'] = [
    { wch: 38 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 20 },
    { wch: 20 }
  ];

  const totalRowIndex = spec.dataRowCount + 2;
  applyNumericFormatting(ws, 2, totalRowIndex);

  XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  return {
    sheetName,
    rowCount: spec.dataRowCount,
    totals: spec.totals
  };
}

function createGfipWorkbook({ gfipAnteriorRows = [], gfipAtualRows = [] } = {}) {
  const wb = XLSX.utils.book_new();
  const summary = {
    GFIP_ANTERIOR: appendGfipSheet(wb, 'GFIP_ANTERIOR', gfipAnteriorRows),
    GFIP_ATUAL: appendGfipSheet(wb, 'GFIP_ATUAL', gfipAtualRows)
  };

  return {
    workbook: wb,
    summary
  };
}

module.exports = {
  GFIP_SHEET_COLUMNS,
  appendGfipSheet,
  buildSheetData,
  createGfipWorkbook,
  parseBrMoney,
  round2
};
