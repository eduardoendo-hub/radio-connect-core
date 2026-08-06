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
  const locutoresBase = [
    { nome: 'Marcelo Café', bio: 'Acorda com você desde 2011.' },
    { nome: 'Renata Lima', bio: 'A trilha sonora da sua tarde.' },
    { nome: 'Tiago Nunes', bio: 'O sertanejo que a cidade pede.' },
    { nome: 'Bia Rocha', bio: 'A noite tem nome e voz.' },
  ]
  const locutores: Record<string, string> = {}
  for (const l of locutoresBase) {
    const existente = await db.locutor.findFirst({ where: { emissoraId: emissora.id, nome: l.nome } })
    const criado = existente ?? (await db.locutor.create({ data: { emissoraId: emissora.id, ...l } }))
    locutores[l.nome] = criado.id
  }
  console.log(`  ${locutoresBase.length} locutores`)

  // ── Programas e grade ──────────────────────────────────────
  const grade = [
    { nome: 'Bom Dia Band', locutor: 'Marcelo Café', inicio: '06:00', fim: '10:00', cor: '#F6821F' },
    { nome: 'Manhã Total', locutor: 'Renata Lima', inicio: '10:00', fim: '14:00', cor: '#22A06B' },
    { nome: 'Tarde Show', locutor: 'Renata Lima', inicio: '14:00', fim: '18:00', cor: '#6E56CF' },
    { nome: 'Balada Sertaneja', locutor: 'Tiago Nunes', inicio: '18:00', fim: '22:00', cor: '#E3271E' },
    { nome: 'Madrugada Band', locutor: 'Bia Rocha', inicio: '22:00', fim: '23:59', cor: '#1E4FD8' },
  ]

  const programas: Record<string, string> = {}
  for (const g of grade) {
    const existente = await db.programa.findFirst({ where: { emissoraId: emissora.id, nome: g.nome } })
    const p =
      existente ??
      (await db.programa.create({
        data: {
          emissoraId: emissora.id,
          nome: g.nome,
          corDestaque: g.cor,
          locutorTitularId: locutores[g.locutor]!,
          tomDeVoz: 'descontraído',
        },
      }))
    programas[g.nome] = p.id

    for (let dia = 0; dia <= 6; dia++) {
      const jaTem = await db.slotGrade.findFirst({
        where: { emissoraId: emissora.id, programaId: p.id, diaSemana: dia },
      })
      if (!jaTem) {
        await db.slotGrade.create({
          data: {
            emissoraId: emissora.id,
            programaId: p.id,
            diaSemana: dia,
            horaInicio: g.inicio,
            horaFim: g.fim,
          },
        })
      }
    }
  }
  console.log(`  ${grade.length} programas, grade de 7 dias`)

  // ── Edições de hoje e amanhã ───────────────────────────────
  //
  // A Edição é a ocorrência concreta — "o Bom Dia Band de hoje". É a ela que os
  // Momentos se ligam, e é ela que o Studio abre no modo Ao Vivo.
  let edicoesCriadas = 0
  for (const desloc of [0, 1]) {
    const dia = new Date()
    dia.setDate(dia.getDate() + desloc)

    for (const g of grade) {
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
          locutorId: locutores[g.locutor]!,
          inicioEm,
          fimEm,
        },
      })
      edicoesCriadas++
    }
  }
  console.log(`  ${edicoesCriadas} edições (hoje e amanhã)`)

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
