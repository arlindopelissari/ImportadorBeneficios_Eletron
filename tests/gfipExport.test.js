const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { createGfipWorkbook } = require('../services/gfipExport');

function getTempDir() {
  const base = path.join(__dirname, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'gfip-export-'));
}

test('exportacao GFIP gera workbook unico com abas e totais por aba', (t) => {
  const dir = getTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const outPath = path.join(dir, 'gfip.xlsx');
  const { workbook, summary } = createGfipWorkbook({
    gfipAnteriorRows: [
      {
        nome_trabalhador: 'ANA TESTE',
        pis_pasep_ci: '111.11111.11-1',
        admissao: '01/01/2024',
        rem_sem_13_sal: '100,10',
        contrib_seg_devida: '10,10',
        base_cal_prev_social: '90,00'
      },
      {
        nome_trabalhador: 'BIA TESTE',
        pis_pasep_ci: '222.22222.22-2',
        admissao: '02/01/2024',
        rem_sem_13_sal: '200,20',
        contrib_seg_devida: '20,20',
        base_cal_prev_social: '180,00'
      }
    ],
    gfipAtualRows: [
      {
        nome_trabalhador: 'CARLOS TESTE',
        pis_pasep_ci: '333.33333.33-3',
        admissao: '03/01/2024',
        rem_sem_13_sal: '300,30',
        contrib_seg_devida: '30,30',
        base_cal_prev_social: '270,00'
      }
    ]
  });

  XLSX.writeFile(workbook, outPath);
  const wb = XLSX.readFile(outPath, { raw: true });

  assert.deepEqual(wb.SheetNames, ['GFIP_ANTERIOR', 'GFIP_ATUAL']);
  assert.equal(summary.GFIP_ANTERIOR.rowCount, 2);
  assert.equal(summary.GFIP_ATUAL.rowCount, 1);

  const anterior = wb.Sheets.GFIP_ANTERIOR;
  const atual = wb.Sheets.GFIP_ATUAL;

  assert.equal(anterior.A1.v, 'NOME TRABALHADOR');
  assert.equal(anterior.A2.v, 'ANA TESTE');
  assert.equal(anterior.D2.v, 100.1);
  assert.equal(anterior.E2.v, 10.1);
  assert.equal(anterior.F2.v, 90);
  assert.equal(anterior.A4.v, 'TOTAL');
  assert.equal(anterior.D4.v, 300.3);
  assert.equal(anterior.E4.v, 30.3);
  assert.equal(anterior.F4.v, 270);

  assert.equal(atual.A2.v, 'CARLOS TESTE');
  assert.equal(atual.A3.v, 'TOTAL');
  assert.equal(atual.D3.v, 300.3);
  assert.equal(atual.E3.v, 30.3);
  assert.equal(atual.F3.v, 270);
});
