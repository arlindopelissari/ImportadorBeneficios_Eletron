const path = require('path');
const XLSX = require('xlsx');

const VINCULOS_EXCLUIDOS = new Set(['55', '80']);
const DESCRICOES_TICKET = new Set(['SPCI - GV', 'OAE - VALE']);
const DEPARTAMENTO_TICKET = 'Geral';
const UNIDADE_ENTREGA_TICKET = '2 - CIABRASIL ENGENHARIA - MG';
const CONTRATO_TICKET = '1735553786 - TAE';
const COMPROCARD = 'COMPROCARD';
const TICKET = 'TICKET';

const FILTER_RULES = [
  'Excluir Codigo Vinculo 80 e 55.',
  'Excluir Situacao 32.',
  'Manter Situacao 07 somente quando a Data Afastamento estiver dentro do mes de referencia.',
  'Excluir admitidos com Data Admissao futura ao mes de referencia.'
];

const COMMON_ADJUSTMENT_RULES = [
  'Aplicar afastamentos e retornos informados manualmente.',
  'Subtrair faltas informadas manualmente.',
  'Dias de direito limitados entre 0 e os dias do mes.',
  'Valor final arredondado para 2 casas decimais.'
];

function trimString(value) {
  return String(value ?? '').trim();
}

function normalizeDigits(value) {
  return trimString(value).replace(/\D/g, '');
}

function normalizeTextKey(value) {
  return trimString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function createDate(year, month, day) {
  const dt = new Date(year, month - 1, day);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function excelSerialToDate(serial) {
  const num = Number(serial);
  if (!Number.isFinite(num)) return null;
  const wholeDays = Math.floor(num);
  const millis = Math.round((num - wholeDays) * 86400000);
  const epoch = Date.UTC(1899, 11, 30);
  const dt = new Date(epoch + wholeDays * 86400000 + millis);
  if (Number.isNaN(dt.getTime())) return null;
  return createDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function dateToExcelSerial(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const epoch = Date.UTC(1899, 11, 30);
  return (utc - epoch) / 86400000;
}

function parseFlexibleDate(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return createDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number') {
    return excelSerialToDate(value);
  }

  const raw = trimString(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return createDate(year, month, day);
  }

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const ymd = createDate(year, month, day);
    if (ymd) return ymd;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (slashMatch) {
    let first = Number(slashMatch[1]);
    let second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;

    let day = first;
    let month = second;
    if (second > 12 && first <= 12) {
      month = first;
      day = second;
    }

    return createDate(year, month, day);
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return excelSerialToDate(Number(raw));
  }

  return null;
}

function formatBrDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function parseMesReferencia(mesReferencia) {
  if (mesReferencia instanceof Date) {
    return {
      year: mesReferencia.getFullYear(),
      month: mesReferencia.getMonth() + 1
    };
  }

  const raw = trimString(mesReferencia);
  if (!raw) throw new Error('Mes de referencia obrigatorio.');

  let match = raw.match(/^(\d{2})\/(\d{4})$/);
  if (match) {
    return { month: Number(match[1]), year: Number(match[2]) };
  }

  match = raw.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  throw new Error('Mes de referencia invalido. Use MM/YYYY ou YYYY-MM.');
}

function obterPrimeiroEUltimoDiaMes(mesReferencia) {
  const { year, month } = parseMesReferencia(mesReferencia);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Mes de referencia invalido.');
  }

  const primeiroDia = createDate(year, month, 1);
  const ultimoDia = createDate(year, month + 1, 0) || new Date(year, month, 0);
  ultimoDia.setHours(0, 0, 0, 0);

  return {
    year,
    month,
    primeiroDia,
    ultimoDia,
    diasDoMes: ultimoDia.getDate(),
    mesReferencia: `${pad2(month)}/${year}`
  };
}

function calcularDiasDoMes(mesReferencia) {
  return obterPrimeiroEUltimoDiaMes(mesReferencia).diasDoMes;
}

function normalizeCodigo(value) {
  const digits = normalizeDigits(value);
  if (!digits) return '';
  return digits.padStart(2, '0');
}

function sameMonth(date, periodo) {
  return (
    date instanceof Date &&
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === periodo.year &&
    date.getMonth() + 1 === periodo.month
  );
}

function isValidCpfDigits(cpf) {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += digits[i] * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== digits[9]) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += digits[i] * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === digits[10];
}

function validarNormalizarCpf(cpf) {
  const digits = normalizeDigits(cpf);
  if (!digits) throw new Error('CPF nao informado.');
  if (digits.length > 11) throw new Error('CPF invalido.');

  const digits11 = digits.padStart(11, '0');
  if (!isValidCpfDigits(digits11)) throw new Error('CPF invalido.');

  return {
    digits: digits11,
    semMascara: digits11,
    semMascaraSemZero: digits11.replace(/^0+/, '') || '0',
    formatado: `${digits11.slice(0, 3)}.${digits11.slice(3, 6)}.${digits11.slice(6, 9)}-${digits11.slice(9, 11)}`
  };
}

function formatarCpf(cpf) {
  return validarNormalizarCpf(cpf).formatado;
}

function classificar_operadora(colaborador) {
  const descricao = normalizeTextKey(
    colaborador?.descricaoCCusto ??
    colaborador?.DescricaoCCusto ??
    colaborador?.CCustoDescricao ??
    colaborador?.['Descricao (C.Custo)'] ??
    colaborador?.['Descricao (C.CUSTO)'] ??
    colaborador?.['Descrição (C.Custo)'] ??
    colaborador?.['Descrição (C.CUSTO)']
  );

  return DESCRICOES_TICKET.has(descricao) ? TICKET : COMPROCARD;
}

function identificar_operadora(colaborador) {
  return classificar_operadora(colaborador);
}

function normalizeColaborador(colaborador) {
  const nome = trimString(colaborador?.Nome ?? colaborador?.nome);
  const cpfRaw = colaborador?.CPF ?? colaborador?.cpf;
  const codigoVinculo = normalizeCodigo(
    colaborador?.CodigoVinculo ??
    colaborador?.['Codigo Vinculo'] ??
    colaborador?.['Código Vínculo'] ??
    colaborador?.Tipo ??
    colaborador?.tipo
  );
  const situacao = normalizeCodigo(colaborador?.Situacao ?? colaborador?.situação ?? colaborador?.situacao);
  const dataAdmissao = parseFlexibleDate(
    colaborador?.DataAdmissao ??
    colaborador?.['Data Admissao'] ??
    colaborador?.['Data Admissão'] ??
    colaborador?.Admissao ??
    colaborador?.admissao
  );
  const dataAfastamento = parseFlexibleDate(
    colaborador?.DataAfastamento ??
    colaborador?.['Data Afastamento'] ??
    colaborador?.data_afastamento
  );
  const dataNascimento = parseFlexibleDate(
    colaborador?.DataNascimento ??
    colaborador?.['Data Nascimento'] ??
    colaborador?.Nascimento ??
    colaborador?.nascimento
  );

  return {
    raw: colaborador || {},
    nome,
    cpfRaw,
    codigoVinculo,
    situacao,
    dataAdmissao,
    dataAfastamento,
    dataNascimento,
    descricaoCCusto: trimString(
      colaborador?.DescricaoCCusto ??
      colaborador?.CCustoDescricao ??
      colaborador?.['Descricao (C.Custo)'] ??
      colaborador?.['Descrição (C.Custo)']
    ),
    cadastro: trimString(colaborador?.Cadastro ?? colaborador?.cadastro)
  };
}

function filtrar_colaboradores(colaboradores, options = {}) {
  if (!Array.isArray(colaboradores)) throw new Error('Colaboradores deve ser um array.');

  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const validos = [];
  const descartados = [];

  for (const original of colaboradores) {
    const colaborador = normalizeColaborador(original);
    const baseInfo = {
      nome: colaborador.nome,
      cpf: trimString(colaborador.cpfRaw),
      motivo: ''
    };

    if (!colaborador.nome) {
      descartados.push({ ...baseInfo, motivo: 'Nome nao informado.' });
      continue;
    }

    if (!colaborador.dataAdmissao) {
      descartados.push({ ...baseInfo, motivo: 'Data de admissao invalida.' });
      continue;
    }

    let cpfInfo;
    try {
      cpfInfo = validarNormalizarCpf(colaborador.cpfRaw);
    } catch (error) {
      descartados.push({ ...baseInfo, motivo: String(error.message || error) });
      continue;
    }

    if (VINCULOS_EXCLUIDOS.has(colaborador.codigoVinculo)) {
      descartados.push({ ...baseInfo, cpf: cpfInfo.semMascara, motivo: `Codigo vinculo ${colaborador.codigoVinculo} excluido.` });
      continue;
    }

    if (colaborador.situacao === '32') {
      descartados.push({ ...baseInfo, cpf: cpfInfo.semMascara, motivo: 'Situacao 32 excluida.' });
      continue;
    }

    if (colaborador.dataAdmissao > periodo.ultimoDia) {
      descartados.push({ ...baseInfo, cpf: cpfInfo.semMascara, motivo: 'Admissao futura ao mes de referencia.' });
      continue;
    }

    if (colaborador.situacao === '07') {
      if (!colaborador.dataAfastamento || !sameMonth(colaborador.dataAfastamento, periodo)) {
        descartados.push({ ...baseInfo, cpf: cpfInfo.semMascara, motivo: 'Demitido fora do mes de referencia.' });
        continue;
      }
    }

    validos.push({
      ...colaborador,
      cpfInfo
    });
  }

  return { validos, descartados, periodo };
}

function createDaySet(startDay, endDay, diasDoMes) {
  const dias = new Set();
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) return dias;

  const inicio = clamp(Math.trunc(startDay), 1, diasDoMes);
  const fim = clamp(Math.trunc(endDay), 0, diasDoMes);
  if (inicio > fim) return dias;

  for (let dia = inicio; dia <= fim; dia++) dias.add(dia);
  return dias;
}

function calcular_dias_direito_comprocard(colaborador, options = {}) {
  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const admitidoNoMes = sameMonth(colaborador.dataAdmissao, periodo);
  const demitidoNoMes = colaborador.situacao === '07' && sameMonth(colaborador.dataAfastamento, periodo);
  const diaAdmissao = admitidoNoMes ? colaborador.dataAdmissao.getDate() : null;
  const diaDemissao = demitidoNoMes ? colaborador.dataAfastamento.getDate() : null;

  let diasCalendario;
  let criterio;

  if (admitidoNoMes && demitidoNoMes) {
    diasCalendario = createDaySet(diaAdmissao, diaDemissao, periodo.diasDoMes);
    criterio = 'admissao_demissao_mes';
  } else if (demitidoNoMes) {
    diasCalendario = createDaySet(1, diaDemissao, periodo.diasDoMes);
    criterio = 'demissao_proporcional';
  } else if (admitidoNoMes) {
    if (diaAdmissao <= 10) {
      diasCalendario = createDaySet(1, periodo.diasDoMes, periodo.diasDoMes);
      criterio = 'admissao_integral_ate_10';
    } else {
      diasCalendario = createDaySet(diaAdmissao, periodo.diasDoMes, periodo.diasDoMes);
      criterio = 'admissao_proporcional';
    }
  } else {
    diasCalendario = createDaySet(1, periodo.diasDoMes, periodo.diasDoMes);
    criterio = 'mes_integral';
  }

  return {
    criterio,
    diasCalendario,
    diasBase: diasCalendario.size
  };
}

function calcular_dias_direito_ticket(colaborador, options = {}) {
  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const admitidoNoMes = sameMonth(colaborador.dataAdmissao, periodo);
  const demitidoNoMes = colaborador.situacao === '07' && sameMonth(colaborador.dataAfastamento, periodo);
  const diaAdmissao = admitidoNoMes ? colaborador.dataAdmissao.getDate() : null;
  const diaDemissao = demitidoNoMes ? colaborador.dataAfastamento.getDate() : null;

  let diasCalendario;
  let criterio;

  if (admitidoNoMes && demitidoNoMes) {
    diasCalendario = createDaySet(diaAdmissao, diaDemissao, periodo.diasDoMes);
    criterio = 'admissao_demissao_mes';
  } else if (demitidoNoMes) {
    diasCalendario = createDaySet(1, diaDemissao, periodo.diasDoMes);
    criterio = 'demissao_proporcional';
  } else if (admitidoNoMes) {
    if (diaAdmissao <= 10) {
      diasCalendario = createDaySet(1, periodo.diasDoMes, periodo.diasDoMes);
      criterio = 'admissao_integral_ate_10';
    } else {
      diasCalendario = createDaySet(diaAdmissao, periodo.diasDoMes, periodo.diasDoMes);
      criterio = 'admissao_proporcional';
    }
  } else {
    diasCalendario = createDaySet(1, periodo.diasDoMes, periodo.diasDoMes);
    criterio = 'mes_integral';
  }

  return {
    criterio,
    diasCalendario,
    diasBase: diasCalendario.size
  };
}

function normalizeManualAdjustment(adjustment) {
  if (!adjustment) return null;

  const dataAfastamento = parseFlexibleDate(
    adjustment.dataAfastamento ??
    adjustment.DataAfastamento ??
    adjustment.data_afastamento ??
    adjustment.DataAfastamentoManual
  );

  const dataRetorno = parseFlexibleDate(
    adjustment.dataRetorno ??
    adjustment.DataRetorno ??
    adjustment.data_retorno ??
    adjustment.DataRetornoManual
  );

  if (!dataAfastamento && !dataRetorno) return null;

  return {
    dataAfastamento,
    dataRetorno
  };
}

function aplicar_afastamentos(diasCalendario, adjustment, options = {}) {
  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const dias = new Set(diasCalendario || []);
  const ajuste = normalizeManualAdjustment(adjustment);

  if (!ajuste) {
    return {
      diasCalendario: dias,
      diasAfastados: 0,
      ajusteAplicado: false,
      motivo: ''
    };
  }

  const { dataAfastamento, dataRetorno } = ajuste;

  if (
    dataAfastamento &&
    dataRetorno &&
    dataRetorno.getTime() <= dataAfastamento.getTime()
  ) {
    return {
      diasCalendario: dias,
      diasAfastados: 0,
      ajusteAplicado: false,
      motivo: 'Data de retorno deve ser maior que data de afastamento.'
    };
  }

  let inicio = null;
  let fim = null;

  if (dataAfastamento) {
    if (dataAfastamento > periodo.ultimoDia) {
      return {
        diasCalendario: dias,
        diasAfastados: 0,
        ajusteAplicado: false,
        motivo: ''
      };
    }

    inicio = dataAfastamento < periodo.primeiroDia ? 1 : dataAfastamento.getDate();
  } else if (dataRetorno && sameMonth(dataRetorno, periodo)) {
    inicio = 1;
  }

  if (dataRetorno) {
    if (dataRetorno <= periodo.primeiroDia) {
      return {
        diasCalendario: dias,
        diasAfastados: 0,
        ajusteAplicado: false,
        motivo: ''
      };
    }

    if (sameMonth(dataRetorno, periodo)) {
      fim = dataRetorno.getDate() - 1;
    } else if (dataRetorno > periodo.ultimoDia) {
      fim = periodo.diasDoMes;
    }
  } else if (inicio != null) {
    fim = periodo.diasDoMes;
  }

  if (inicio == null || fim == null || inicio > fim) {
    return {
      diasCalendario: dias,
      diasAfastados: 0,
      ajusteAplicado: false,
      motivo: ''
    };
  }

  let removidos = 0;
  for (let dia = inicio; dia <= fim; dia++) {
    if (dias.delete(dia)) removidos++;
  }

  return {
    diasCalendario: dias,
    diasAfastados: removidos,
    ajusteAplicado: removidos > 0,
    motivo: ''
  };
}

function aplicar_faltas(diasDireito, faltas, maxDias) {
  const faltasNum = Math.max(0, Math.trunc(Number(faltas) || 0));
  const limite = Number.isFinite(maxDias) ? Math.max(0, maxDias) : Math.max(0, diasDireito);
  return clamp(Math.max(0, Number(diasDireito) - faltasNum), 0, limite);
}

function aplicar_ajustes_manuais(payload = {}) {
  const diasCalendario = new Set(payload.diasCalendario || []);
  const periodo = payload.periodo || obterPrimeiroEUltimoDiaMes(payload.mesReferencia);
  const afastamento = aplicar_afastamentos(diasCalendario, payload.ajusteManual, { periodo });
  const diasAntesFaltas = clamp(afastamento.diasCalendario.size, 0, periodo.diasDoMes);
  const diasDireito = aplicar_faltas(diasAntesFaltas, payload.faltas, periodo.diasDoMes);

  return {
    diasCalendario: afastamento.diasCalendario,
    diasAposAfastamento: diasAntesFaltas,
    diasDireito,
    diasAfastados: afastamento.diasAfastados,
    faltasAplicadas: Math.max(0, Math.trunc(Number(payload.faltas) || 0)),
    ajusteAplicado: afastamento.ajusteAplicado,
    motivo: afastamento.motivo
  };
}

function aplicar_ajustes_manuis(payload) {
  return aplicar_ajustes_manuais(payload);
}

const OPERATOR_RULES = {
  [COMPROCARD]: {
    nome: COMPROCARD,
    valorPadrao: 1100,
    separacao: 'Todos os colaboradores fora de "SPCI - GV" e "OAE - Vale".',
    admissaoAte10Integral: true,
    layout: [
      'A = Nome',
      'B = CPF com 11 digitos',
      'C = Valor',
      'D = 1'
    ],
    regrasCalculo: [
      'Admitido no mes entre dia 1 e 10 recebe valor integral.',
      'Admitido no mes a partir do dia 11 recebe proporcional.',
      'Demitido no mes recebe proporcional ate o dia da demissao.',
      'Admitido e demitido no mesmo mes recebe proporcional entre admissao e demissao.'
    ]
  },
  [TICKET]: {
    nome: TICKET,
    valorPadrao: 455.8,
    separacao: 'Somente colaboradores com Descricao (C.Custo) igual a "SPCI - GV" ou "OAE - Vale".',
    admissaoAte10Integral: true,
    layout: [
      'A = CPF sem pontuacao e sem zero a esquerda',
      'B = CPF com pontuacao',
      'C = Nome',
      'D = Data de Nascimento',
      `E = ${DEPARTAMENTO_TICKET}`,
      `F = ${UNIDADE_ENTREGA_TICKET}`,
      'G = Valor',
      `H = ${CONTRATO_TICKET}`
    ],
    regrasCalculo: [
      'Admitido no mes entre dia 1 e 10 recebe valor integral.',
      'Admitido no mes a partir do dia 11 recebe proporcional.',
      'Demitido no mes recebe proporcional ate o dia da demissao.',
      'Admitido e demitido no mesmo mes recebe proporcional entre admissao e demissao.'
    ]
  }
};

function buildCalcResult(colaborador, operador, valorIntegral, calcBase, calcAjustes, periodo) {
  const valorDiario = Number(valorIntegral) / periodo.diasDoMes;
  const valorFinal = round2(valorDiario * calcAjustes.diasDireito);

  return {
    operadora: operador,
    nome: colaborador.nome,
    cadastro: colaborador.cadastro,
    cpf: colaborador.cpfInfo.semMascara,
    cpfFormatado: colaborador.cpfInfo.formatado,
    cpfSemZeroEsquerda: colaborador.cpfInfo.semMascaraSemZero,
    dataNascimento: colaborador.dataNascimento,
    dataNascimentoFormatada: formatBrDate(colaborador.dataNascimento),
    dataAdmissao: colaborador.dataAdmissao,
    dataAfastamento: colaborador.dataAfastamento,
    descricaoCCusto: colaborador.descricaoCCusto,
    situacao: colaborador.situacao,
    codigoVinculo: colaborador.codigoVinculo,
    diasDoMes: periodo.diasDoMes,
    valorIntegral: round2(valorIntegral),
    valorDiario,
    criterio: calcBase.criterio,
    diasBase: clamp(calcBase.diasBase, 0, periodo.diasDoMes),
    diasAfastados: calcAjustes.diasAfastados,
    faltas: calcAjustes.faltasAplicadas,
    diasAjustados: clamp(calcAjustes.diasAposAfastamento, 0, periodo.diasDoMes),
    diasDireito: clamp(calcAjustes.diasDireito, 0, periodo.diasDoMes),
    valorFinal
  };
}

function calcular_valor_comprocard(colaborador, options = {}) {
  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const valorIntegral = Number(options.valorIntegral);
  if (!Number.isFinite(valorIntegral) || valorIntegral < 0) {
    throw new Error('Valor integral COMPROCARD invalido.');
  }

  const calcBase = calcular_dias_direito_comprocard(colaborador, { periodo });
  const calcAjustes = aplicar_ajustes_manuais({
    diasCalendario: calcBase.diasCalendario,
    ajusteManual: options.ajusteManual,
    faltas: options.faltas,
    periodo
  });

  return buildCalcResult(colaborador, COMPROCARD, valorIntegral, calcBase, calcAjustes, periodo);
}

function calcular_valor_ticket(colaborador, options = {}) {
  const periodo = options.periodo || obterPrimeiroEUltimoDiaMes(options.mesReferencia);
  const valorIntegral = Number(options.valorIntegral);
  if (!Number.isFinite(valorIntegral) || valorIntegral < 0) {
    throw new Error('Valor integral TICKET invalido.');
  }

  const calcBase = calcular_dias_direito_ticket(colaborador, { periodo });
  const calcAjustes = aplicar_ajustes_manuais({
    diasCalendario: calcBase.diasCalendario,
    ajusteManual: options.ajusteManual,
    faltas: options.faltas,
    periodo
  });

  return buildCalcResult(colaborador, TICKET, valorIntegral, calcBase, calcAjustes, periodo);
}

function criarRegistroComprocard(calculo) {
  return {
    Nome: calculo.nome,
    CPF: calculo.cpf,
    Valor: calculo.valorFinal,
    Tipo: 1,
    DiasDireito: calculo.diasDireito
  };
}

function criarRegistroTicket(calculo) {
  return {
    CPFSemZeroEsquerda: calculo.cpfSemZeroEsquerda,
    CPFFormatado: calculo.cpfFormatado,
    Nome: calculo.nome,
    DataNascimento: calculo.dataNascimento,
    Departamento: DEPARTAMENTO_TICKET,
    UnidadeEntrega: UNIDADE_ENTREGA_TICKET,
    Valor: calculo.valorFinal,
    Contrato: CONTRATO_TICKET,
    DiasDireito: calculo.diasDireito
  };
}

const OPERATOR_CONFIG = {
  [COMPROCARD]: {
    ...OPERATOR_RULES[COMPROCARD],
    fileKey: 'comprocard',
    calcularValor: calcular_valor_comprocard,
    validarCalculo: () => null,
    criarRegistroSaida: criarRegistroComprocard,
    exportarArquivo: exportar_xls_comprocard
  },
  [TICKET]: {
    ...OPERATOR_RULES[TICKET],
    fileKey: 'ticket',
    calcularValor: calcular_valor_ticket,
    validarCalculo: (calculo) => {
      if (!calculo.dataNascimento) {
        return 'Data de nascimento invalida para exportacao Ticket.';
      }
      return null;
    },
    criarRegistroSaida: criarRegistroTicket,
    exportarArquivo: exportar_xlsx_ticket
  }
};

function normalizeCpfMap(rows, mapFn) {
  const map = new Map();

  for (const row of rows || []) {
    try {
      const cpfInfo = validarNormalizarCpf(row?.CPF ?? row?.cpf);
      map.set(cpfInfo.semMascara, mapFn ? mapFn(row, cpfInfo) : row);
    } catch {
      continue;
    }
  }

  return map;
}

function buildReasonSummary(descartados) {
  const counts = new Map();
  for (const item of descartados || []) {
    const key = trimString(item?.motivo) || 'Sem motivo';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => a.motivo.localeCompare(b.motivo, 'pt-BR'));
}

function createOperatorBuckets() {
  return Object.fromEntries(
    Object.entries(OPERATOR_CONFIG).map(([name, config]) => [
      name,
      {
        nome: name,
        config,
        calculos: [],
        registros: []
      }
    ])
  );
}

// Exemplo:
// processar_base({
//   colaboradores,
//   mesReferencia: '02/2026',
//   valorTicket: 455.8,
//   valorComprocard: 1100,
//   ajustesManuais,
//   faltas,
//   outComprocardPath: 'C:/saida/COMPROCARD_022026.xls',
//   outTicketPath: 'C:/saida/TICKET_022026.xlsx'
// });
function processar_base(options = {}) {
  const {
    colaboradores,
    mesReferencia,
    valorTicket = 455.8,
    valorComprocard = 1100,
    ajustesManuais = [],
    faltas = [],
    outComprocardPath,
    outTicketPath,
    logger
  } = options;

  if (!Array.isArray(colaboradores)) {
    throw new Error('Colaboradores deve ser um array.');
  }

  const periodo = obterPrimeiroEUltimoDiaMes(mesReferencia);
  const logs = [];
  const pushLog = (line) => {
    const text = trimString(line);
    if (!text) return;
    logs.push(text);
    if (typeof logger === 'function') logger(text);
  };

  pushLog(`Mes de referencia: ${periodo.mesReferencia}`);
  pushLog(`Entrada: ${colaboradores.length} colaborador(es).`);

  const filtragem = filtrar_colaboradores(colaboradores, { periodo });
  const ajustesMap = normalizeCpfMap(ajustesManuais, (row) => normalizeManualAdjustment(row));
  const faltasMap = normalizeCpfMap(faltas, (row) => Math.max(0, Math.trunc(Number(row?.faltas ?? row?.Faltas ?? 0) || 0)));

  const operatorBuckets = createOperatorBuckets();
  const descartados = [...filtragem.descartados];

  pushLog(`Apos filtros: ${filtragem.validos.length} colaborador(es) elegiveis.`);

  for (const colaborador of filtragem.validos) {
    const ajusteManual = ajustesMap.get(colaborador.cpfInfo.semMascara) || null;
    const faltasColaborador = faltasMap.get(colaborador.cpfInfo.semMascara) || 0;
    const operadora = classificar_operadora(colaborador);
    const operatorConfig = OPERATOR_CONFIG[operadora];

    try {
      const valorIntegral = operadora === TICKET ? valorTicket : valorComprocard;
      const calculo = operatorConfig.calcularValor(colaborador, {
        periodo,
        valorIntegral,
        ajusteManual,
        faltas: faltasColaborador
      });

      const validationError = operatorConfig.validarCalculo(calculo, colaborador);
      if (validationError) {
        descartados.push({
          nome: calculo.nome,
          cpf: calculo.cpf,
          motivo: validationError
        });
        continue;
      }

      operatorBuckets[operadora].calculos.push(calculo);
      operatorBuckets[operadora].registros.push(operatorConfig.criarRegistroSaida(calculo, colaborador));
    } catch (error) {
      descartados.push({
        nome: colaborador.nome,
        cpf: colaborador.cpfInfo?.semMascara || trimString(colaborador.cpfRaw),
        motivo: String(error?.message || error)
      });
    }
  }

  const ticket = operatorBuckets[TICKET].registros;
  const comprocard = operatorBuckets[COMPROCARD].registros;
  const processamento = [
    ...operatorBuckets[COMPROCARD].calculos,
    ...operatorBuckets[TICKET].calculos
  ];
  const totalTicket = round2(ticket.reduce((sum, item) => sum + Number(item.Valor || 0), 0));
  const totalComprocard = round2(comprocard.reduce((sum, item) => sum + Number(item.Valor || 0), 0));

  pushLog(`Ticket: ${ticket.length} registro(s), total R$ ${totalTicket.toFixed(2)}.`);
  pushLog(`Comprocard: ${comprocard.length} registro(s), total R$ ${totalComprocard.toFixed(2)}.`);

  const reasonSummary = buildReasonSummary(descartados);
  if (reasonSummary.length > 0) {
    pushLog(`Descartados: ${descartados.length} registro(s).`);
  }

  const arquivos = {};
  if (outComprocardPath) {
    OPERATOR_CONFIG[COMPROCARD].exportarArquivo(comprocard, outComprocardPath, {
      periodo,
      valorIntegral: valorComprocard
    });
    arquivos.comprocard = outComprocardPath;
    pushLog(`Arquivo COMPROCARD gerado em ${outComprocardPath}.`);
  }

  if (outTicketPath) {
    OPERATOR_CONFIG[TICKET].exportarArquivo(ticket, outTicketPath, {
      periodo,
      valorIntegral: valorTicket
    });
    arquivos.ticket = outTicketPath;
    pushLog(`Arquivo TICKET gerado em ${outTicketPath}.`);
  }

  return {
    periodo,
    logs,
    ticket,
    comprocard,
    operadoras: {
      [COMPROCARD]: {
        nome: COMPROCARD,
        regras: OPERATOR_RULES[COMPROCARD],
        calculos: operatorBuckets[COMPROCARD].calculos,
        registros: operatorBuckets[COMPROCARD].registros,
        arquivo: arquivos.comprocard || '',
        totalRegistros: comprocard.length,
        valorTotal: totalComprocard
      },
      [TICKET]: {
        nome: TICKET,
        regras: OPERATOR_RULES[TICKET],
        calculos: operatorBuckets[TICKET].calculos,
        registros: operatorBuckets[TICKET].registros,
        arquivo: arquivos.ticket || '',
        totalRegistros: ticket.length,
        valorTotal: totalTicket
      }
    },
    processamento,
    descartados,
    resumoDescartados: reasonSummary,
    resumo: {
      totalEntrada: colaboradores.length,
      totalElegiveis: filtragem.validos.length,
      totalProcessados: processamento.length,
      totalTicket: ticket.length,
      totalComprocard: comprocard.length,
      totalDescartados: descartados.length,
      valorTotalTicket: totalTicket,
      valorTotalComprocard: totalComprocard
    },
    arquivos
  };
}

function buildRulesSheetRows(operatorName, context = {}) {
  const operatorRules = OPERATOR_CONFIG[operatorName];
  const periodo = context.periodo || obterPrimeiroEUltimoDiaMes(context.mesReferencia || new Date());
  const valorIntegral = round2(
    context.valorIntegral != null
      ? context.valorIntegral
      : operatorRules?.valorPadrao
  );

  const rows = [
    ['Tipo', 'Detalhe'],
    ['Operadora', operatorRules?.nome || operatorName],
    ['Mes Referencia', periodo.mesReferencia],
    ['Dias do Mes', periodo.diasDoMes],
    ['Valor Integral', valorIntegral.toFixed(2)],
    ['Separacao', operatorRules?.separacao || ''],
    ['Filtro', FILTER_RULES.join(' ')],
    ['Ajustes', COMMON_ADJUSTMENT_RULES.join(' ')]
  ];

  for (const regra of operatorRules?.regrasCalculo || []) {
    rows.push(['Calculo', regra]);
  }

  rows.push(['Formula', 'valorDiario = valorIntegral / diasDoMes']);
  rows.push(['Formula', 'valorFinal = valorDiario * diasDireito']);

  for (const item of operatorRules?.layout || []) {
    rows.push(['Layout', item]);
  }

  return rows;
}

function createRulesSheet(operatorName, context = {}) {
  const ws = XLSX.utils.aoa_to_sheet(buildRulesSheetRows(operatorName, context));
  ws['!cols'] = [
    { wch: 18 },
    { wch: 120 }
  ];
  return ws;
}

function exportar_xls_comprocard(registros, outPath, context = {}) {
  if (!Array.isArray(registros)) throw new Error('Registros COMPROCARD deve ser um array.');
  if (!outPath) throw new Error('Caminho de saida COMPROCARD obrigatorio.');

  const wb = XLSX.utils.book_new();
  const rows = [['Nome', 'CPF', 'Valor', '']];

  for (const registro of registros) {
    const cpf = validarNormalizarCpf(registro?.CPF).semMascara;
    rows.push([
      trimString(registro?.Nome),
      cpf,
      round2(registro?.Valor),
      1
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 40 },
    { wch: 16 },
    { wch: 14 },
    { wch: 6 }
  ];

  for (let rowIndex = 2; rowIndex <= rows.length; rowIndex++) {
    const cpfCell = `B${rowIndex}`;
    const valueCell = `C${rowIndex}`;
    const tipoCell = `D${rowIndex}`;
    if (ws[cpfCell]) ws[cpfCell].t = 's';
    if (ws[valueCell]) ws[valueCell].z = '0.00';
    if (ws[tipoCell]) ws[tipoCell].t = 'n';
  }

  XLSX.utils.book_append_sheet(wb, createRulesSheet(COMPROCARD, context), 'Regras');
  XLSX.utils.book_append_sheet(wb, ws, 'Plan1');
  XLSX.writeFile(wb, outPath, { bookType: 'xls' });
  return outPath;
}

function exportar_xlsx_ticket(registros, outPath, context = {}) {
  if (!Array.isArray(registros)) throw new Error('Registros TICKET deve ser um array.');
  if (!outPath) throw new Error('Caminho de saida TICKET obrigatorio.');
  const wb = XLSX.utils.book_new();
  const rows = [[
    'Matrícula',
    'CPF',
    'Nome do Usuário',
    'Data de Nascimento',
    'Departamento',
    'Unidade de Entrega',
    'Valor Mensal do Benefício',
    'Número do contrato'
  ]];

  for (const registro of registros) {
    rows.push([
      trimString(registro?.CPFSemZeroEsquerda),
      trimString(registro?.CPFFormatado),
      trimString(registro?.Nome),
      formatBrDate(registro?.DataNascimento instanceof Date ? registro.DataNascimento : parseFlexibleDate(registro?.DataNascimento)),
      DEPARTAMENTO_TICKET,
      UNIDADE_ENTREGA_TICKET,
      round2(registro?.Valor),
      CONTRATO_TICKET
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 34 },
    { wch: 16 },
    { wch: 16 },
    { wch: 34 },
    { wch: 18 },
    { wch: 22 }
  ];

  for (let rowIndex = 2; rowIndex <= rows.length; rowIndex++) {
    const aCell = `A${rowIndex}`;
    const bCell = `B${rowIndex}`;
    const dCell = `D${rowIndex}`;
    const gCell = `G${rowIndex}`;
    const hCell = `H${rowIndex}`;
    if (ws[aCell]) ws[aCell].t = 's';
    if (ws[bCell]) ws[bCell].t = 's';
    if (ws[dCell]) ws[dCell].t = 's';
    if (ws[gCell]) ws[gCell].z = '0.00';
    if (ws[hCell]) ws[hCell].t = 's';
  }

  XLSX.utils.book_append_sheet(wb, createRulesSheet(TICKET, context), 'Regras');
  XLSX.utils.book_append_sheet(wb, ws, 'Beneficiarios');
  XLSX.writeFile(wb, outPath, { bookType: 'xlsx' });

  return outPath;
}

function exportar_xlsm_ticket(registros, _templatePath, outPath, context = {}) {
  return exportar_xlsx_ticket(registros, outPath || _templatePath, context);
}

function buildDefaultOutputNames(baseDir, mesReferencia) {
  const periodo = obterPrimeiroEUltimoDiaMes(mesReferencia);
  const suffix = `${pad2(periodo.month)}${periodo.year}`;
  return {
    comprocard: path.join(baseDir, `COMPROCARD_${suffix}.xls`),
    ticket: path.join(baseDir, `TICKET_${suffix}.xlsx`)
  };
}

module.exports = {
  CONTRATO_TICKET,
  DEPARTAMENTO_TICKET,
  DESCRICOES_TICKET,
  FILTER_RULES,
  OPERATOR_CONFIG,
  OPERATOR_RULES,
  UNIDADE_ENTREGA_TICKET,
  VINCULOS_EXCLUIDOS,
  aplicar_afastamentos,
  aplicar_ajustes_manuais,
  aplicar_ajustes_manuis,
  aplicar_faltas,
  buildDefaultOutputNames,
  calcular_dias_direito_comprocard,
  calcular_dias_direito_ticket,
  calcular_valor_comprocard,
  calcular_valor_ticket,
  calcularDiasDoMes,
  classificar_operadora,
  dateToExcelSerial,
  exportar_xls_comprocard,
  exportar_xlsx_ticket,
  exportar_xlsm_ticket,
  filtrar_colaboradores,
  formatBrDate,
  formatarCpf,
  identificar_operadora,
  normalizeColaborador,
  normalizeManualAdjustment,
  obterPrimeiroEUltimoDiaMes,
  parseFlexibleDate,
  parseMesReferencia,
  processar_base,
  round2,
  validarNormalizarCpf
};
