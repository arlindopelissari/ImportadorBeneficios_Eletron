const { processar_base } = require('./valeProcessor');

function getColaboradoresBase(db) {
  return db.prepare(`
    SELECT
      TRIM(Cadastro) AS Cadastro,
      TRIM(Nome) AS Nome,
      TRIM(CPF) AS CPF,
      TRIM(Nascimento) AS Nascimento,
      TRIM(Tipo) AS CodigoVinculo,
      TRIM(Situacao) AS Situacao,
      TRIM(DataAfastamento) AS DataAfastamento,
      TRIM(Admissao) AS DataAdmissao,
      TRIM(CCustoDescricao) AS DescricaoCCusto
    FROM funcionario
    ORDER BY TRIM(Nome), TRIM(CPF)
  `).all();
}

function getAjustesManuais(db) {
  return db.prepare(`
    SELECT
      TRIM(CPF) AS CPF,
      TRIM(data_afastamento) AS dataAfastamento,
      TRIM(data_retorno) AS dataRetorno
    FROM vale_apontamento_funcionario
    WHERE IFNULL(TRIM(CPF), '') <> ''
      AND (
        IFNULL(TRIM(data_afastamento), '') <> ''
        OR IFNULL(TRIM(data_retorno), '') <> ''
      )
  `).all();
}

function getFaltasManuais(db) {
  return db.prepare(`
    SELECT
      TRIM(CPF) AS CPF,
      COALESCE(faltas, 0) AS faltas
    FROM vale_falta_funcionario
    WHERE IFNULL(TRIM(CPF), '') <> ''
  `).all();
}

async function generateValeReport(db, options = {}) {
  const {
    mesReferencia,
    valorTicket = 455.8,
    valorComprocard = 1100,
    outComprocardPath,
    outTicketPath
  } = options;

  if (!mesReferencia) {
    return { ok: false, error: 'Informe o mes de referencia.' };
  }

  if (!outComprocardPath || !outTicketPath) {
    return { ok: false, error: 'Arquivos de saida nao informados.' };
  }

  const colaboradores = getColaboradoresBase(db);
  if (!colaboradores.length) {
    return { ok: false, error: 'Nao existem colaboradores importados para processar.' };
  }

  const logs = [];
  const result = processar_base({
    colaboradores,
    mesReferencia,
    valorTicket,
    valorComprocard,
    ajustesManuais: getAjustesManuais(db),
    faltas: getFaltasManuais(db),
    outComprocardPath,
    outTicketPath,
    logger: (line) => logs.push(line)
  });

  return {
    ok: true,
    logs,
    resumo: result.resumo,
    resumoDescartados: result.resumoDescartados,
    totalEntrada: result.resumo.totalEntrada,
    totalProcessados: result.resumo.totalProcessados,
    totalTicket: result.resumo.totalTicket,
    totalComprocard: result.resumo.totalComprocard,
    valorTotalTicket: result.resumo.valorTotalTicket,
    valorTotalComprocard: result.resumo.valorTotalComprocard,
    comprocardFile: result.arquivos.comprocard,
    ticketFile: result.arquivos.ticket,
    files: [result.arquivos.comprocard, result.arquivos.ticket].filter(Boolean)
  };
}

module.exports = { generateValeReport };
