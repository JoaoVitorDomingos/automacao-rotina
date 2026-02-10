import "dotenv/config";
import { notion } from "./src/notion.js";
import { databaseIDs } from "./src/utils/databaseIds.js";

function dataBrasilSemHorario() {
  const agora = new Date();

  // pega data atual no Brasil SEM string intermediária
  const ano = Number(
    agora.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }),
  );

  const mes =
    Number(
      agora.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        month: "numeric",
      }),
    ) - 1;

  const dia = Number(
    agora.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
    }),
  );

  // cria data UTC fixa (00:00)
  return new Date(Date.UTC(ano, mes, dia));
}

const dataHoje = dataBrasilSemHorario();

console.log("Data: " + dataHoje);

const mapaHorario = {
  Segunda: "Horário Segunda",
  Terça: "Horário Terça",
  Quarta: "Horário Quarta",
  Quinta: "Horário Quinta",
  Sexta: "Horário Sexta",
  Sábado: "Horário Sábado",
  Domingo: "Horário Domingo",
};

const dias = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const diaSemana = dias[dataHoje.getUTCDay()];

async function main() {
  const idsDS = await obterIdsDS();

  const atividadesHoje = await obterAtividades(idsDS[0]);
  console.log("Atividades de Hoje:");
  console.log(atividadesHoje);

  if (atividadesHoje.results.length === 0) {
    console.log("Nenhuma atividade hoje.");
    return;
  }

  // Cria página de resumo diário
  let resumo = await obterResumoDoDia(idsDS[2]);
  let resumoId;

  if (resumo) {
    console.log("Resumo do dia já existe");
    resumoId = resumo.id;
  } else {
    resumoId = await criarResumo(idsDS[2]);
  }

  // Cria páginas para rotina
  const idsRotinaCriados = [];

  for (const atividade of atividadesHoje.results) {
    const existente = await rotinaJaExiste(idsDS[1], atividade.id);

    if (existente) {
      console.log(`Rotina já existe: ${atividade.id}`);
      idsRotinaCriados.push(existente.id);
      continue;
    }

    const page = await criarItemDeRotina({
      dataSourceRotina: idsDS[1],
      atividade,
      diaSemana,
    });

    idsRotinaCriados.push(page.id);
  }

  // Vincular atividades ao resumo
  await vincularRotinasAoResumo(resumoId, idsRotinaCriados);

  console.log("Rotina e resumo criados com sucesso");
}

main().catch(console.error);

function obterHorario(atividade, diaSemana) {
  const campoHorario = mapaHorario[diaSemana];

  if (!campoHorario) return "";

  const prop = atividade.properties[campoHorario];

  return prop?.rich_text?.[0]?.plain_text ?? "";
}

function dataSemHorario() {
  return dataHoje.toISOString();
}

async function obterIdsDS() {
  let ids = [];

  // Atividades
  const dbAtv = await notion.databases.retrieve({
    database_id: databaseIDs.atividadesDB,
  });

  ids.push(dbAtv.data_sources[0].id);

  // Rotina
  const dbRotina = await notion.databases.retrieve({
    database_id: databaseIDs.rotinaDB,
  });

  ids.push(dbRotina.data_sources[0].id);

  // Analise
  const dbAnalise = await notion.databases.retrieve({
    database_id: databaseIDs.analiseDB,
  });

  ids.push(dbAnalise.data_sources[0].id);

  return ids;
}

async function obterAtividades(id) {
  return await notion.dataSources.query({
    data_source_id: id,
    filter: {
      and: [
        {
          property: "Ativa",
          checkbox: {
            equals: true,
          },
        },
        {
          property: "Dias da semana",
          multi_select: {
            contains: diaSemana,
          },
        },
      ],
    },
  });
}

async function obterResumoDoDia(dataSourceAnalise) {
  const res = await notion.dataSources.query({
    data_source_id: dataSourceAnalise,
    filter: {
      property: "Data",
      date: {
        equals: dataSemHorario(),
      },
    },
  });

  return res.results[0] ?? null;
}

async function criarResumo(dataSourceAnalise) {
  const dataFormatada = dataBase.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
  const nomePag = `${dataFormatada} - ${diaSemana}`;

  const resumo = await notion.pages.create({
    parent: {
      data_source_id: dataSourceAnalise,
    },
    properties: {
      Nome: {
        title: [{ text: { content: nomePag } }],
      },
      Data: {
        date: {
          start: dataSemHorario(),
        },
      },
    },
    icon: {
      emoji: "📆",
    },
  });

  return resumo.id;
}

async function rotinaJaExiste(dataSourceRotina, atividadeId) {
  const res = await notion.dataSources.query({
    data_source_id: dataSourceRotina,
    filter: {
      and: [
        {
          property: "Data",
          date: {
            equals: dataSemHorario(),
          },
        },
        {
          property: "Atividade",
          relation: {
            contains: atividadeId,
          },
        },
      ],
    },
  });

  return res.results.length > 0 ? res.results[0] : null;
}

async function criarItemDeRotina({ dataSourceRotina, atividade, diaSemana }) {
  const horario = obterHorario(atividade, diaSemana);

  const nomeAtv =
    atividade.properties.Nome?.title?.[0]?.plain_text ?? "Atividade";

  return notion.pages.create({
    parent: {
      data_source_id: dataSourceRotina,
    },
    properties: {
      Nome: {
        title: [{ text: { content: nomeAtv } }],
      },
      Data: {
        date: {
          start: dataSemHorario(),
        },
      },
      Horário: {
        rich_text: [{ text: { content: horario } }],
      },
      Concluido: {
        checkbox: false,
      },
      Observação: {
        rich_text: [],
      },
      Atividade: {
        relation: [{ id: atividade.id }],
      },
    },
    icon: {
      emoji: atividade.icon?.emoji ?? "✅",
    },
  });
}

async function vincularRotinasAoResumo(resumoId, idsRotina) {
  await notion.pages.update({
    page_id: resumoId,
    properties: {
      Execução: {
        relation: idsRotina.map((id) => ({ id })),
      },
    },
  });
}
