const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { createRelVerbasWorkbook } = require('../services/relVerbasExport');

function getTempDir() {
  const base = path.join(__dirname, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'relverbas-export-'));
}

test('exportacao Rel. Verbas gera workbook com colunas e descricoes corretas', (t) => {
  const dir = getTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const outPath = path.join(dir, 'relverbas.xlsx');
  const { workbook, exported, columns } = createRelVerbasWorkbook([
    {
      fl: '01',
      matricula: '03147',
      nome: 'SILVIO VICENTE FERREIRA MARIA',
      cpf: '16958312848',
      ano_mes: '200807',
      cod_verba: '103',
      desc_verba: 'HORAS NORMAIS',
      ref_qtd: '190,58',
      valor: '914,78',
      data_pagto: '20080806',
      ccusto: '510100108'
    }
  ]);

  XLSX.writeFile(workbook, outPath);
  const wb = XLSX.readFile(outPath, { raw: false });
  const sheet = wb.Sheets.RelVerbas;

  assert.equal(exported, 1);
  assert.deepEqual(columns, [
    'FL',
    'MATRICULA',
    'NOME',
    'CPF',
    'ANO / MÊS',
    'CÓD. VERBA',
    'DESC. VERBA',
    'REF. QTD',
    'VALOR',
    'DATA_PAGTO',
    'CCUSTO',
  ]);

  assert.deepEqual(wb.SheetNames, ['RelVerbas']);
  assert.equal(sheet.A1.v, 'FL');
  assert.equal(sheet.F1.v, 'CÓD. VERBA');
  assert.equal(sheet.G1.v, 'DESC. VERBA');
  assert.equal(sheet.A2.v, '01');
  assert.equal(sheet.B2.v, '03147');
  assert.equal(sheet.F2.v, '103');
  assert.equal(sheet.G2.v, 'HORAS NORMAIS');
  assert.equal(sheet.H2.v, '190,58');
  assert.equal(sheet.I2.v, '914,78');
});
