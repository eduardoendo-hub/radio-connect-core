import bcrypt from 'bcryptjs'
import { prismaSemEscopo as db } from '../lib/prisma.js'

/**
 * A rádio da demonstração.
 *
 * Precisa parecer real: grade completa, locutores com nome, Momentos ao longo do dia,
 * promoção ativa e uma campanha patrocinada. Numa reunião, o app tem que estar vivo —
 * é literalmente a promessa do produto.
 *
 * Idempotente: pode rodar quantas vezes quiser.
 */

const SLUG = 'bandfm'

const CORES = {
  primaria: '#F6821F', // laranja Band FM, amostrado do deck
  fundo: '#0B0B0C',
  superficie: '#151517',
  aoVivo: '#E3271E', // o vermelho do "AO VIVO" — reservado, significa "acontecendo agora"
}

async function main() {
  console.log('semeando a rádio de demonstração…')

  const emissora = await db.emissora.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      nome: 'Band FM',
      // A emissora fornece o m3u8. Não hospedamos áudio.
      streamUrl: process.env.STREAM_DEMO_URL ?? null,
      tema: {
        primaria: CORES.primaria,
        fundo: CORES.fundo,
        superficie: CORES.superficie,
        aoVivo: CORES.aoVivo,
        pulso: 'forte', // rádio popular: mais movimento. Uma jornalística usaria 'sobrio'.
      },
      configuracao: {
        modulos: { chat: true, promocoes: true, indiceConexao: true, publicidade: true },
        anuncios: {
          bannerNoAr: true,
          bannerChatACadaMensagens: 12,
          prerollMinutosEntre: 30,
          maxImpressoesPorSessao: 6,
        },
        momento: { duracaoPadraoSegundos: 180 },
      },
      conteudo: {
        saudacaoManha: 'Bom dia!',
        rotuloConexao: 'Sua conexão com a Band FM',
        vivendoMomento: 'ouvintes vivendo este momento',
      },
    },
  })
  console.log(`  emissora ${emissora.nome} (${emissora.id})`)

  // ── Operadores do Studio ───────────────────────────────────
  const senhaHash = await bcrypt.hash('bandfm2026', 10)
  const operadores = [
    { nome: 'Eduardo Endo', email: 'admin@bandfm.com.br', papel: 'ADMIN' as const },
    { nome: 'Carla Produção', email: 'producao@bandfm.com.br', papel: 'PRODUTOR' as const },
    { nome: 'Rafael Programação', email: 'programacao@bandfm.com.br', papel: 'PROGRAMACAO' as const },
    { nome: 'Marcelo Café', email: 'marcelo@bandfm.com.br', papel: 'LOCUTOR' as const },
  ]
  for (const o of operadores) {
    await db.operador.upsert({
      where: { emissoraId_email: { emissoraId: emissora.id, email: o.email } },
      update: { papel: o.papel, senhaHash },
      create: { emissoraId: emissora.id, ...o, senhaHash },
    })
  }
  console.log(`  ${operadores.length} operadores`)

  // ── Locutores ──────────────────────────────────────────────
  //
  // Nomes reais, da escala oficial da Band FM. As bios são nossas e provisórias — a
  // emissora revisa. `imagemUrl` fica nulo até as fotos oficiais chegarem: enquanto
  // isso o app desenha um avatar com as iniciais, que é honesto e não vira buraco.
  const locutoresBase = [
    { nome: 'Dyego Lopes', bio: 'A madrugada tem quem faça companhia.' },
    { nome: 'Tadeu Correa', bio: 'Começa o dia com você.' },
    { nome: 'Emerson França', bio: 'A manhã não começa sem ele.' },
    { nome: 'Pedro Luiz Ronco', bio: 'O Ronco em pessoa.' },
    { nome: 'Milena Barros', bio: 'A manhã inteira, do show ao coração.' },
    { nome: 'Kaká', bio: 'Energia da manhã.' },
    { nome: 'Marcelo Café', bio: 'A tarde é dele.' },
    { nome: 'Pedro Rafael', bio: 'Tamo junto até as cinco.' },
    { nome: 'Robson Ramos', bio: 'Leva você do fim da tarde à noite.' },
    { nome: 'Paulo Gomes', bio: 'Estação Band FM.' },
    { nome: 'Maicon Sales', bio: 'Estação Band FM.' },
    { nome: 'Marcelo Dias', bio: 'A noite tem nome e voz.' },
    // O documento da emissora não traz nomes para sábado e domingo — são dias de
    // plantão, com a escala definida na semana. Em vez de deixar a grade vazia (o app
    // ficaria mudo dois dias por semana) ou inventar uma pessoa que não existe, entra
    // um locutor de plantão: honesto sobre o que é, e substituível por nome real
    // assim que a rádio informar quem entrou.
    { nome: 'Plantão Band FM', bio: 'A equipe que segura o fim de semana.' },
  ]
  const locutores: Record<string, string> = {}
  for (const l of locutoresBase) {
    const existente = await db.locutor.findFirst({ where: { emissoraId: emissora.id, nome: l.nome } })
    const criado = existente ?? (await db.locutor.create({ data: { emissoraId: emissora.id, ...l } }))
    // A bio pode ter mudado desde a última vez; o nome é a chave.
    if (existente) await db.locutor.update({ where: { id: existente.id }, data: { bio: l.bio } })
    locutores[l.nome] = criado.id
  }
  console.log(`  ${locutoresBase.length} locutores`)

  // ── Programas e grade ──────────────────────────────────────
  //
  // Grade oficial de segunda a sexta. O primeiro nome de `equipe` é o titular — quem
  // assina a edição e aparece em destaque; os demais dividem o microfone.
  //
  // O SUPER 6 aparece quatro vezes no dia sem duração declarada no documento: é o
  // bloco de seis músicas que preenche a hora cheia entre dois programas. Aqui ele
  // ocupa exatamente esse buraco — 10h→11h, 13h→14h, 17h→18h, 21h→22h — e é isso que
  // fecha a grade sem sobreposição.
  //
  // Das 20h às 21h **não entra programa nenhum, e é de propósito**: é o horário
  // político eleitoral, que a emissora é obrigada a veicular. Sem programa não há
  // Edição, sem Edição não há Momento — o app fica em silêncio exatamente durante a
  // hora em que não pode haver interação comercial nem promocional.
  //
  // Se um dia alguém "consertar" essa lacuna preenchendo o buraco, vai criar um
  // problema regulatório, não resolver um problema de grade.
  type Bloco = {
    nome: string
    equipe: string[]
    inicio: string
    fim: string
    cor: string
    /** Quando o mesmo programa toca várias vezes no dia, cada faixa é um slot. */
    chave?: string
  }

  const grade: Bloco[] = [
    { nome: 'Band Coruja', equipe: ['Dyego Lopes'], inicio: '01:00', fim: '05:00', cor: '#1E4FD8' },
    { nome: 'Band Bom Dia', equipe: ['Tadeu Correa', 'Emerson França'], inicio: '05:00', fim: '06:00', cor: '#F6821F' },
    { nome: 'A Hora do Ronco', equipe: ['Tadeu Correa', 'Emerson França', 'Pedro Luiz Ronco'], inicio: '06:00', fim: '09:00', cor: '#F6821F' },
    { nome: 'Manhã Show', equipe: ['Milena Barros', 'Kaká'], inicio: '09:00', fim: '10:00', cor: '#22A06B' },
    { nome: 'Super 6', equipe: ['Milena Barros'], inicio: '10:00', fim: '11:00', cor: '#E3271E', chave: 'Super 6 · 10h' },
    { nome: 'Quem Ama Não Esquece', equipe: ['Milena Barros'], inicio: '11:00', fim: '12:15', cor: '#6E56CF' },
    { nome: 'Minha Música, Minha Vida', equipe: ['Milena Barros'], inicio: '12:15', fim: '13:00', cor: '#6E56CF' },
    { nome: 'Super 6', equipe: ['Marcelo Café'], inicio: '13:00', fim: '14:00', cor: '#E3271E', chave: 'Super 6 · 13h' },
    { nome: 'Curte Aí', equipe: ['Marcelo Café'], inicio: '14:00', fim: '14:40', cor: '#22A06B' },
    { nome: 'Tamo Junto', equipe: ['Marcelo Café', 'Pedro Rafael'], inicio: '14:40', fim: '17:00', cor: '#22A06B' },
    { nome: 'Super 6', equipe: ['Robson Ramos'], inicio: '17:00', fim: '18:00', cor: '#E3271E', chave: 'Super 6 · 17h' },
    { nome: 'Band ao Vivo', equipe: ['Robson Ramos'], inicio: '18:00', fim: '18:25', cor: '#E3271E' },
    { nome: 'Estação Band FM', equipe: ['Robson Ramos', 'Paulo Gomes', 'Maicon Sales'], inicio: '18:25', fim: '20:00', cor: '#6E56CF' },
    { nome: 'Super 6', equipe: ['Marcelo Dias'], inicio: '21:00', fim: '22:00', cor: '#E3271E', chave: 'Super 6 · 21h' },
    { nome: 'Band Love', equipe: ['Marcelo Dias'], inicio: '22:00', fim: '23:59', cor: '#1E4FD8' },
  ]

  // ── Sábado e domingo ───────────────────────────────────────
  //
  // O documento traz a grade completa dos dois dias, mas sem locutor: são dias de
  // plantão. A programação existe e o app precisa dela — sem isso a rádio ficava muda
  // dois dias por semana, justamente quando a audiência de rádio popular cresce.
  //
  // Os SUPER 6 seguem a mesma regra dos dias úteis: preenchem a hora cheia entre dois
  // programas.
  const PLANTAO = ['Plantão Band FM']

  const sabado: Bloco[] = [
    { nome: 'Band Coruja', equipe: PLANTAO, inicio: '01:00', fim: '05:00', cor: '#1E4FD8' },
    { nome: 'Band Bom Dia', equipe: PLANTAO, inicio: '05:00', fim: '07:00', cor: '#F6821F' },
    { nome: 'Top 5 · A Hora do Ronco', equipe: PLANTAO, inicio: '07:00', fim: '09:00', cor: '#F6821F' },
    { nome: 'Manhã Show', equipe: PLANTAO, inicio: '09:00', fim: '11:00', cor: '#22A06B' },
    { nome: 'Super 6', equipe: PLANTAO, inicio: '11:00', fim: '12:00', cor: '#E3271E', chave: 'Super 6 · 11h' },
    { nome: 'Festa da Band', equipe: PLANTAO, inicio: '12:00', fim: '14:00', cor: '#D6336C' },
    { nome: 'Super 6', equipe: PLANTAO, inicio: '14:00', fim: '15:00', cor: '#E3271E', chave: 'Super 6 · 14h' },
    { nome: 'Hora Cheia', equipe: PLANTAO, inicio: '15:00', fim: '16:00', cor: '#6E56CF' },
    { nome: 'Dá Play', equipe: PLANTAO, inicio: '16:00', fim: '18:00', cor: '#22A06B' },
    { nome: 'Band ao Vivo', equipe: PLANTAO, inicio: '18:00', fim: '19:00', cor: '#E3271E' },
    { nome: 'Super 6', equipe: PLANTAO, inicio: '19:00', fim: '20:00', cor: '#E3271E', chave: 'Super 6 · 19h' },
    { nome: 'Hora Cheia', equipe: PLANTAO, inicio: '20:00', fim: '21:00', cor: '#6E56CF', chave: 'Hora Cheia · 20h' },
    { nome: 'Pista da Band', equipe: PLANTAO, inicio: '21:00', fim: '23:59', cor: '#1E4FD8' },
  ]

  const domingo: Bloco[] = [
    { nome: 'Band Coruja', equipe: PLANTAO, inicio: '00:00', fim: '05:00', cor: '#1E4FD8' },
    { nome: 'Band Bom Dia', equipe: PLANTAO, inicio: '05:00', fim: '07:00', cor: '#F6821F' },
    { nome: 'Estação Band FM', equipe: PLANTAO, inicio: '07:00', fim: '09:00', cor: '#6E56CF' },
    { nome: 'Band ao Vivo', equipe: PLANTAO, inicio: '09:00', fim: '11:00', cor: '#E3271E' },
    { nome: 'Super 6', equipe: PLANTAO, inicio: '11:00', fim: '12:00', cor: '#E3271E', chave: 'Super 6 · 11h' },
    { nome: 'Festa da Band', equipe: PLANTAO, inicio: '12:00', fim: '15:00', cor: '#D6336C' },
    { nome: 'As Mais Pedidas da Semana', equipe: PLANTAO, inicio: '15:00', fim: '16:00', cor: '#22A06B' },
    { nome: 'Dá Play', equipe: PLANTAO, inicio: '16:00', fim: '18:00', cor: '#22A06B' },
    { nome: 'Band ao Vivo', equipe: PLANTAO, inicio: '18:00', fim: '19:00', cor: '#E3271E', chave: 'Band ao Vivo · 18h' },
    { nome: 'Super 6', equipe: PLANTAO, inicio: '19:00', fim: '20:00', cor: '#E3271E', chave: 'Super 6 · 19h' },
    { nome: 'As Mais Pedidas da Semana', equipe: PLANTAO, inicio: '20:00', fim: '21:00', cor: '#22A06B', chave: 'As Mais Pedidas · 20h' },
    { nome: 'Band Love', equipe: PLANTAO, inicio: '21:00', fim: '23:59', cor: '#1E4FD8' },
  ]

  /// A grade completa, com os dias em que cada faixa toca.
  /// 0 = domingo. Dias úteis são 1 a 5.
  const semana: { bloco: Bloco; dias: number[] }[] = [
    ...grade.map((bloco) => ({ bloco, dias: [1, 2, 3, 4, 5] })),
    ...sabado.map((bloco) => ({ bloco, dias: [6] })),
    ...domingo.map((bloco) => ({ bloco, dias: [0] })),
  ]

  // Um Programa por nome; um SlotGrade por faixa de horário. É a diferença entre a
  // identidade ("Super 6") e a recorrência ("Super 6, das 13h às 14h").
  const programas: Record<string, string> = {}
  for (const { bloco: g, dias } of semana) {
    if (!programas[g.nome]) {
      const existente = await db.programa.findFirst({ where: { emissoraId: emissora.id, nome: g.nome } })
      const titular = locutores[g.equipe[0]!]!
      const equipeIds = g.equipe.slice(1).map((n) => ({ id: locutores[n]! }))
      const p =
        existente ??
        (await db.programa.create({
          data: {
            emissoraId: emissora.id,
            nome: g.nome,
            corDestaque: g.cor,
            locutorTitularId: titular,
            tomDeVoz: 'descontraído',
            equipe: { connect: equipeIds },
          },
        }))
      if (existente) {
        await db.programa.update({
          where: { id: existente.id },
          data: {
            corDestaque: g.cor,
            locutorTitularId: titular,
            // `set` e não `connect`: rodar de novo tem que convergir para a escala do
            // documento, não somar gente que saiu do programa.
            equipe: { set: equipeIds },
          },
        })
      }
      programas[g.nome] = p.id
    }

    for (const dia of dias) {
      const jaTem = await db.slotGrade.findFirst({
        where: {
          emissoraId: emissora.id,
          programaId: programas[g.nome]!,
          diaSemana: dia,
          horaInicio: g.inicio,
        },
      })
      if (!jaTem) {
        await db.slotGrade.create({
          data: {
            emissoraId: emissora.id,
            programaId: programas[g.nome]!,
            diaSemana: dia,
            horaInicio: g.inicio,
            horaFim: g.fim,
          },
        })
      }
    }
  }
  console.log(`  ${Object.keys(programas).length} programas · ${grade.length} faixas úteis · ${sabado.length} no sábado · ${domingo.length} no domingo`)

  // ── Aposenta a grade inventada ─────────────────────────────
  //
  // Antes da escala oficial chegar, a demo rodava com programas fictícios. Eles não
  // podem simplesmente conviver com os reais: a grade do dia mostraria dezoito
  // programas, metade deles inexistentes.
  //
  // Programa não se apaga — Momentos, respostas e impressões apontam para as edições
  // dele, e apagar seria reescrever o passado. Ele é desativado e perde os slots, que
  // é o que impede novas edições de nascerem. As edições futuras sem Momento algum
  // saem, porque essas ainda não são história de ninguém.
  const daGradeOficial = Object.values(programas)
  const obsoletos = await db.programa.findMany({
    where: { emissoraId: emissora.id, id: { notIn: daGradeOficial } },
    select: { id: true, nome: true },
  })
  if (obsoletos.length) {
    const ids = obsoletos.map((p) => p.id)
    await db.slotGrade.deleteMany({ where: { emissoraId: emissora.id, programaId: { in: ids } } })
    const inicioDeHoje = new Date(); inicioDeHoje.setHours(0, 0, 0, 0)
    await db.edicao.deleteMany({
      where: {
        emissoraId: emissora.id,
        programaId: { in: ids },
        inicioEm: { gte: inicioDeHoje },
        momentos: { none: {} },
      },
    })
    await db.programa.updateMany({ where: { id: { in: ids } }, data: { ativo: false } })
    console.log(`  ${obsoletos.length} programas fora da escala desativados: ${obsoletos.map((p) => p.nome).join(', ')}`)
  }

  // Locutores que não existem na escala oficial também saem de cena.
  const daEscala = Object.values(locutores)
  const foraDeEscala = await db.locutor.updateMany({
    where: { emissoraId: emissora.id, id: { notIn: daEscala }, ativo: true },
    data: { ativo: false },
  })
  if (foraDeEscala.count) console.log(`  ${foraDeEscala.count} locutores fora da escala desativados`)

  // ── Edições de hoje e amanhã ───────────────────────────────
  //
  // A Edição é a ocorrência concreta — "A Hora do Ronco de hoje". É a ela que os
  // Momentos se ligam, e é ela que o Studio abre no modo Ao Vivo.
  let edicoesCriadas = 0
  for (const desloc of [0, 1]) {
    const dia = new Date()
    dia.setDate(dia.getDate() + desloc)
    const diaSemana = dia.getDay()

    // Cada dia tem a sua grade. Antes o fim de semana era pulado, e a demonstração
    // aberta num sábado mostrava um app sem programa nenhum.
    const doDia = semana.filter((x) => x.dias.includes(diaSemana)).map((x) => x.bloco)

    for (const g of doDia) {
      const [hi, mi] = g.inicio.split(':').map(Number)
      const [hf, mf] = g.fim.split(':').map(Number)
      const inicioEm = new Date(dia); inicioEm.setHours(hi!, mi!, 0, 0)
      const fimEm = new Date(dia); fimEm.setHours(hf!, mf!, 0, 0)

      const jaTem = await db.edicao.findFirst({
        where: { emissoraId: emissora.id, programaId: programas[g.nome]!, inicioEm },
      })
      if (jaTem) continue

      await db.edicao.create({
        data: {
          emissoraId: emissora.id,
          programaId: programas[g.nome]!,
          // O titular é quem assina a edição; a equipe vem do programa.
          locutorId: locutores[g.equipe[0]!]!,
          // "Super 6 · 13h" e "Super 6 · 17h" são o mesmo programa em faixas
          // diferentes. O título distingue as edições na lista do dia.
          titulo: g.chave ?? null,
          inicioEm,
          fimEm,
        },
      })
      edicoesCriadas++
    }
  }
  console.log(`  ${edicoesCriadas} edições novas (hoje e amanhã)`)

  // ── Templates: criar um Momento em menos de 20 segundos ────
  const templates = [
    {
      nome: 'Qual música toca agora?',
      tipo: 'ESCOLHA' as const,
      titulo: 'Qual música toca agora?',
      opcoesPadrao: [{ rotulo: 'Opção A' }, { rotulo: 'Opção B' }],
      duracaoSegundos: 180,
      favorito: true,
    },
    {
      nome: 'Gostou da música?',
      tipo: 'REACAO' as const,
      titulo: 'Gostou dessa?',
      opcoesPadrao: [
        { rotulo: 'Amei', emoji: '❤️' },
        { rotulo: 'Gostei', emoji: '👍' },
        { rotulo: 'Passa', emoji: '👎' },
      ],
      duracaoSegundos: 120,
      favorito: true,
    },
    {
      nome: 'Batalha das Músicas',
      tipo: 'ESCOLHA' as const,
      titulo: 'Batalha! Quem leva essa?',
      opcoesPadrao: [{ rotulo: 'Artista A' }, { rotulo: 'Artista B' }],
      duracaoSegundos: 240,
      favorito: true,
    },
    {
      nome: 'Enquete rápida',
      tipo: 'ENQUETE' as const,
      titulo: 'Prefere nacional ou internacional?',
      opcoesPadrao: [{ rotulo: 'Nacional' }, { rotulo: 'Internacional' }],
      duracaoSegundos: 180,
      favorito: false,
    },
    {
      nome: 'Aviso rápido',
      tipo: 'AVISO' as const,
      titulo: 'Fica ligado!',
      opcoesPadrao: [],
      duracaoSegundos: 300,
      favorito: false,
    },
    {
      // O Fofocômetro entra como template para virar botão no Studio. O conteúdo é
      // sempre novo — o que o template guarda é o formato, não a fofoca.
      nome: 'Fofocômetro',
      tipo: 'FOFOCOMETRO' as const,
      titulo: 'Você quer saber quem foi visto aos beijos?',
      opcoesPadrao: [],
      duracaoSegundos: 600,
      favorito: true,
    },
    {
      nome: 'Chamada de promoção',
      tipo: 'CHAMADA_PROMOCAO' as const,
      titulo: 'Promoção no ar. Participe!',
      opcoesPadrao: [],
      duracaoSegundos: 600,
      favorito: true,
    },
  ]
  for (const t of templates) {
    const jaTem = await db.templateMomento.findFirst({ where: { emissoraId: emissora.id, nome: t.nome } })
    if (!jaTem) await db.templateMomento.create({ data: { emissoraId: emissora.id, ...t } })
  }
  console.log(`  ${templates.length} templates de Momento`)

  // ── Comercial: anunciante, campanha e promoção patrocinada ──
  //
  // Entra no seed de propósito: o inventário publicitário é requisito de MVP, não fase
  // dois. A demo precisa mostrar como o produto ganha dinheiro.
  const anunciante =
    (await db.anunciante.findFirst({ where: { emissoraId: emissora.id, nome: 'Supermercado Estrela' } })) ??
    (await db.anunciante.create({
      data: { emissoraId: emissora.id, nome: 'Supermercado Estrela', contato: 'comercial@estrela.com.br' },
    }))

  const campanha =
    (await db.campanha.findFirst({ where: { emissoraId: emissora.id, nome: 'Estrela · Promoção de Agosto' } })) ??
    (await db.campanha.create({
      data: {
        emissoraId: emissora.id,
        anuncianteId: anunciante.id,
        nome: 'Estrela · Promoção de Agosto',
        formato: 'promocao_patrocinada',
        status: 'ATIVA',
        inicioEm: new Date(),
        fimEm: new Date(Date.now() + 30 * 86400000),
        vendidoPor: 'RADIO', // vendida pelo comercial da rádio: revenue share 70/30
        valorTotal: '8500.00',
      },
    }))

  // ── Inventário publicitário de verdade ─────────────────────
  //
  // Entra no seed porque o capítulo do inventário trata publicidade como requisito de
  // MVP, não de fase dois: a receita do produto vem de mídia, e uma rádio que não vê o
  // anúncio na tela não entende como isso se paga.
  //
  // A Soneda é o anunciante da demonstração, com um banner e um pré-roll de oito
  // segundos. Vendida pela rádio — revenue share 70/30 —, que é o caso que interessa
  // mostrar: o comercial da emissora continua vendendo, e a plataforma entrega.
  const soneda =
    (await db.anunciante.findFirst({ where: { emissoraId: emissora.id, nome: 'Soneda' } })) ??
    (await db.anunciante.create({
      data: { emissoraId: emissora.id, nome: 'Soneda', contato: 'comercial@soneda.com.br' },
    }))

  const campanhaSoneda =
    (await db.campanha.findFirst({ where: { emissoraId: emissora.id, nome: 'Soneda · Agosto' } })) ??
    (await db.campanha.create({
      data: {
        emissoraId: emissora.id,
        anuncianteId: soneda.id,
        nome: 'Soneda · Agosto',
        formato: 'banner',
        status: 'ATIVA',
        inicioEm: new Date(),
        fimEm: new Date(Date.now() + 30 * 86400000),
        vendidoPor: 'RADIO',
        valorTotal: '12000.00',
      },
    }))

  // As URLs vêm do ambiente porque os arquivos são enviados pela rota de mídia e
  // ganham id no envio — não dá para chumbar no código.
  const bannerUrl = process.env.CRIATIVO_BANNER_URL
  const prerollUrl = process.env.CRIATIVO_PREROLL_URL

  if (bannerUrl) {
    const jaTem = await db.criativo.findFirst({ where: { campanhaId: campanhaSoneda.id, tipo: 'imagem' } })
    if (jaTem) {
      await db.criativo.update({ where: { id: jaTem.id }, data: { url: bannerUrl } })
    } else {
      await db.criativo.create({
        data: {
          campanhaId: campanhaSoneda.id,
          tipo: 'imagem',
          url: bannerUrl,
          clickUrl: 'https://www.soneda.com.br',
          posicoes: ['no_ar_banner', 'chat_inline'],
        },
      })
    }
  }

  if (prerollUrl) {
    const jaTem = await db.criativo.findFirst({ where: { campanhaId: campanhaSoneda.id, tipo: 'audio' } })
    if (jaTem) {
      await db.criativo.update({ where: { id: jaTem.id }, data: { url: prerollUrl } })
    } else {
      await db.criativo.create({
        data: {
          campanhaId: campanhaSoneda.id,
          tipo: 'audio',
          url: prerollUrl,
          duracao: 9,
          posicoes: ['preroll'],
        },
      })
    }
  }
  console.log(`  campanha Soneda: banner ${bannerUrl ? 'ok' : '—'} · pré-roll ${prerollUrl ? 'ok' : '—'}`)

  const jaTemPromo = await db.promocao.findFirst({ where: { emissoraId: emissora.id, titulo: { contains: 'ingressos' } } })
  if (!jaTemPromo) {
    await db.promocao.create({
      data: {
        emissoraId: emissora.id,
        titulo: 'Dois ingressos para o Baladão Band FM',
        descricao: 'Participe e concorra a um par de ingressos com acesso ao camarote.',
        regras: 'Válido para maiores de 18 anos. Sorteio ao vivo na sexta-feira.',
        inicioEm: new Date(),
        fimEm: new Date(Date.now() + 5 * 86400000),
        campanhaPatrocinadoraId: campanha.id,
      },
    })
  }
  console.log('  anunciante, campanha e promoção patrocinada')

  console.log('\npronto.')
  console.log(`  tenant: ${SLUG}`)
  console.log('  Studio: admin@bandfm.com.br / bandfm2026')
  console.log('  app: qualquer telefone, código 000000 (modo demonstração)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
