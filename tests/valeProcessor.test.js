const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const {
  exportar_xls_comprocard,
  exportar_xlsx_ticket,
  processar_base,
  validarNormalizarCpf
} = require('../services/valeProcessor');

function buildCpf(baseNineDigits) {
  const digits = String(baseNineDigits).replace(/\D/g, '').padStart(9, '0').slice(0, 9);
  const nums = digits.split('').map(Number);

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;

  sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (11 - i);
  sum += d1 * 2;
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;

  return `${digits}${d1}${d2}`;
}

function makeEmployee(overrides = {}) {
  return {
    Nome: 'Funcionario Teste',
    CPF: buildCpf('123456789'),
    DataNascimento: '10/02/1990',
    CodigoVinculo: '01',
    Situacao: '01',
    DataAfastamento: '',
    DataAdmissao: '01/01/2026',
    DescricaoCCusto: 'ADMINISTRATIVO',
    ...overrides
  };
}

function runProcess(employee, options = {}) {
  return processar_base({
    colaboradores: [employee],
    mesReferencia: '02/2026',
    valorTicket: 455.8,
    valorComprocard: 1100,
    ajustesManuais: options.ajustesManuais || [],
    faltas: options.faltas || []
  });
}

function getSingleResult(result, operator) {
  const rows = operator === 'TICKET' ? result.ticket : result.comprocard;
  assert.equal(rows.length, 1);
  assert.equal(result.descartados.length, 0);
  assert.equal(result.processamento.length, 1);
  return result.processamento[0];
}

function getTempDir() {
  const base = path.join(__dirname, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'vale-'));
}

test('1. colaborador ativo o mes todo', () => {
  const result = runProcess(makeEmployee());
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.diasDireito, 28);
  assert.equal(item.valorFinal, 1100);
});

test('2. admitido no dia 08 no COMPROCARD recebe integral', () => {
  const result = runProcess(makeEmployee({ DataAdmissao: '08/02/2026' }));
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.criterio, 'admissao_integral_ate_10');
  assert.equal(item.diasDireito, 28);
  assert.equal(item.valorFinal, 1100);
});

test('3. admitido no dia 17 no COMPROCARD recebe proporcional', () => {
  const result = runProcess(makeEmployee({ DataAdmissao: '17/02/2026' }));
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.diasDireito, 12);
  assert.equal(item.valorFinal, 471.43);
});

test('4. admitido no dia 08 no TICKET recebe integral', () => {
  const result = runProcess(makeEmployee({
    DataAdmissao: '08/02/2026',
    DescricaoCCusto: 'SPCI - GV'
  }));
  const item = getSingleResult(result, 'TICKET');
  assert.equal(item.criterio, 'admissao_integral_ate_10');
  assert.equal(item.diasDireito, 28);
  assert.equal(item.valorFinal, 455.8);
});

test('5. demitido no dia 15', () => {
  const result = runProcess(makeEmployee({
    Situacao: '07',
    DataAfastamento: '15/02/2026'
  }));
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.diasDireito, 15);
  assert.equal(item.valorFinal, 589.29);
});

test('6. admitido dia 11 e demitido dia 27 no mesmo mes', () => {
  const result = runProcess(makeEmployee({
    DataAdmissao: '11/02/2026',
    Situacao: '07',
    DataAfastamento: '27/02/2026'
  }));
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.diasDireito, 17);
  assert.equal(item.valorFinal, 667.86);
});

test('7. afastado com ajuste manual', () => {
  const employee = makeEmployee({ CPF: buildCpf('123456780') });
  const result = runProcess(employee, {
    ajustesManuais: [
      {
        CPF: employee.CPF,
        dataAfastamento: '2026-02-10'
      }
    ]
  });
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.diasAfastados, 19);
  assert.equal(item.diasDireito, 9);
  assert.equal(item.valorFinal, 353.57);
});

test('8. faltas reduzem dias de direito', () => {
  const employee = makeEmployee({ CPF: buildCpf('123456781') });
  const result = runProcess(employee, {
    faltas: [
      {
        CPF: employee.CPF,
        faltas: 3
      }
    ]
  });
  const item = getSingleResult(result, 'COMPROCARD');
  assert.equal(item.faltas, 3);
  assert.equal(item.diasDireito, 25);
  assert.equal(item.valorFinal, 982.14);
});

test('9. CPF iniciado por zero e preservado nas exportacoes', (t) => {
  const cpf = buildCpf('012345678');
  const info = validarNormalizarCpf(cpf);
  assert.equal(info.semMascara.length, 11);
  assert.ok(info.semMascara.startsWith('0'));
  assert.equal(info.semMascaraSemZero, info.semMascara.replace(/^0+/, ''));

  const dir = getTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outPath = path.join(dir, 'comprocard.xls');
  exportar_xls_comprocard([
    { Nome: 'Teste Zero', CPF: cpf, Valor: 1100 }
  ], outPath);

  const wb = XLSX.readFile(outPath, { raw: false });
  assert.equal(wb.SheetNames[0], 'Regras');
  assert.equal(wb.SheetNames[1], 'Plan1');
  const regrasWs = wb.Sheets.Regras;
  const ws = wb.Sheets.Plan1;
  assert.equal(regrasWs.A2.v, 'Operadora');
  assert.equal(regrasWs.B2.v, 'COMPROCARD');
  assert.equal(ws.B2.v, info.semMascara);
});

test('10. funcionario com vinculo 80 ou 55 e excluido', () => {
  const result = runProcess(makeEmployee({ CodigoVinculo: '80' }));
  assert.equal(result.processamento.length, 0);
  assert.equal(result.descartados.length, 1);
  assert.match(result.descartados[0].motivo, /Codigo vinculo 80/);
});

test('11. funcionario com situacao 32 e excluido', () => {
  const result = runProcess(makeEmployee({ Situacao: '32' }));
  assert.equal(result.processamento.length, 0);
  assert.equal(result.descartados.length, 1);
  assert.match(result.descartados[0].motivo, /Situacao 32/);
});

test('12. demitido fora do mes e excluido', () => {
  const result = runProcess(makeEmployee({
    Situacao: '07',
    DataAfastamento: '31/01/2026'
  }));
  assert.equal(result.processamento.length, 0);
  assert.equal(result.descartados.length, 1);
  assert.match(result.descartados[0].motivo, /Demitido fora do mes/);
});

test('13. admitido em mes futuro e excluido', () => {
  const result = runProcess(makeEmployee({
    DataAdmissao: '01/03/2026'
  }));
  assert.equal(result.processamento.length, 0);
  assert.equal(result.descartados.length, 1);
  assert.match(result.descartados[0].motivo, /Admissao futura/);
});

test('Ticket admitido dia 11 recebe proporcional', () => {
  const result = runProcess(makeEmployee({
    Nome: 'RONDINELE FERREIRA FREITAS',
    DataAdmissao: '11/02/2026',
    DescricaoCCusto: 'SPCI - GV'
  }));
  const item = getSingleResult(result, 'TICKET');
  assert.equal(item.criterio, 'admissao_proporcional');
  assert.equal(item.diasDireito, 18);
  assert.equal(item.valorFinal, 293.01);
});

test('COMPROCARD e TICKET sao processados em objetos distintos', () => {
  const result = processar_base({
    colaboradores: [
      makeEmployee({ Nome: 'Colab Comprocard', CPF: buildCpf('123123123') }),
      makeEmployee({ Nome: 'Colab Ticket', CPF: buildCpf('321321321'), DescricaoCCusto: 'SPCI - GV' })
    ],
    mesReferencia: '02/2026',
    valorTicket: 455.8,
    valorComprocard: 1100
  });

  assert.equal(result.operadoras.COMPROCARD.totalRegistros, 1);
  assert.equal(result.operadoras.TICKET.totalRegistros, 1);
  assert.equal(result.operadoras.COMPROCARD.registros[0].Nome, 'Colab Comprocard');
  assert.equal(result.operadoras.TICKET.registros[0].Nome, 'Colab Ticket');
  assert.equal(result.operadoras.COMPROCARD.regras.nome, 'COMPROCARD');
  assert.equal(result.operadoras.TICKET.regras.nome, 'TICKET');
  assert.notEqual(result.operadoras.COMPROCARD.regras.separacao, result.operadoras.TICKET.regras.separacao);
});

test('exportar_xlsx_ticket gera relatorio Ticket em xlsx com aba Beneficiarios', (t) => {
  const dir = getTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outPath = path.join(dir, 'ticket.xlsx');

  exportar_xlsx_ticket([
    {
      CPFSemZeroEsquerda: '4839376654',
      CPFFormatado: '048.393.766-54',
      Nome: 'ADILTON BASILIO FILHO',
      DataNascimento: new Date(1981, 11, 16),
      Valor: 455.8
    }
  ], outPath);

  const generated = XLSX.readFile(outPath, { raw: false, bookVBA: true });
  const regras = generated.Sheets.Regras;
  const sheet = generated.Sheets.Beneficiarios;
  assert.equal(Boolean(generated.vbaraw), false);
  assert.equal(generated.SheetNames[0], 'Regras');
  assert.equal(generated.SheetNames[1], 'Beneficiarios');
  assert.equal(regras.A2.v, 'Operadora');
  assert.equal(regras.B2.v, 'TICKET');
  assert.equal(sheet.A1.v, 'Matrícula');
  assert.equal(sheet.B1.v, 'CPF');
  assert.equal(sheet.A2.v, '4839376654');
  assert.equal(sheet.B2.v, '048.393.766-54');
  assert.equal(sheet.C2.v, 'ADILTON BASILIO FILHO');
  assert.equal(sheet.D2.v, '16/12/1981');
  assert.equal(sheet.E2.v, 'Geral');
  assert.equal(sheet.F2.v, '2 - CIABRASIL ENGENHARIA - MG');
  assert.equal(sheet.G2.v, 455.8);
  assert.equal(sheet.H2.v, '1735553786 - TAE');
});
