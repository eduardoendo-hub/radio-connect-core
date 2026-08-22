import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { contarPresenca } from '../noar/servico.js'
import { redis } from '../../lib/redis.js'
import { faixaDe } from '../../lib/tempo.js'
import { lerRegua, nivelDe, type Degrau } from '../ouvintes/conexao.js'

export const rotasAudiencia = Router()

/**
 * Audiência.
 *
 * **Três telas, três perguntas, três pessoas.** *Agora* é para quem está operando no
 * estúdio; *Programas* é para a direção e para a venda; *Evolução* é para a diretoria uma
 * vez por mês. Uma tela só que respondesse as três seria um painel que ninguém abre.
 *
 * Em todas elas, dois números convivem e nenhum é a versão fraca do outro:
 *
 *   **No aplicativo** — quem está dentro do produto, ouvindo por onde quiser. Muita gente
 *   abre com a rádio tocando no carro ou na cozinha e usa a tela para votar, conversar e
 *   entrar em promoção; ouvir por streaming consome banda e nem todo mundo quer gastar a
 *   dela conosco. É aqui que a participação acontece, e é este o tamanho da base viva.
 *
 *   **Ouvindo pelo aplicativo** — escuta digital, que custa banda ao ouvinte e entrega
 *   minuto contável à emissora.
 *
 * Nenhum dos dois é "a audiência da rádio". O IBOPE mede quantos ouvem; isto mede quem
 * ouve — com nome e telefone.
 */

const periodo = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(7),
})

// ── Agora ────────────────────────────────────────────────────

/**
 * O minuto corrente, e as últimas horas de meia em meia.
 *
 * `noApp` e `ouvindo` do instante vêm do Redis, não do banco: o banco guarda a faixa
 * fechada, e quem está no estúdio precisa do número de agora, não do número dos últimos
 * trinta minutos.
 */
rotasAudiencia.get('/audiencia/agora', exigirOperador(), async (req, res, next) => {
  try {
    const horas = Math.min(24, Math.max(1, Number(req.query.horas ?? 6)))
    const desde = faixaDe(new Date(Date.now() - horas * 3600_000))
    const faixaAtual = faixaDe()

    const [noAppAgora, ouvindoAgora, faixas, edicao] = await Promise.all([
      contarPresenca(req.emissora!.id),
      contarAgora(req.emissora!.id, faixaAtual),
      prisma.faixaAudiencia.findMany({
        where: { inicioEm: { gte: desde } },
        orderBy: { inicioEm: 'asc' },
      }),
      prisma.edicao.findFirst({
        where: { inicioEm: { lte: new Date() }, fimEm: { gte: new Date() } },
        select: {
          id: true,
          inicioEm: true,
          fimEm: true,
          programa: { select: { nome: true, corDestaque: true } },
          locutor: { select: { nome: true } },
        },
      }),
    ])

    const programas = await nomesDe(faixas.map((f) => f.programaId))

    res.json({
      agora: { noApp: noAppAgora, ouvindo: ouvindoAgora },
      noAr: edicao
        ? {
            programa: edicao.programa.nome,
            cor: edicao.programa.corDestaque,
            locutor: edicao.locutor?.nome ?? null,
            comecou: edicao.inicioEm,
            termina: edicao.fimEm,
          }
        : null,
      // A faixa corrente entra incompleta e a tela precisa saber disso: meia hora que
      // acabou de começar sempre parece uma queda se for lida como as outras.
      faixaAberta: faixaAtual,
      faixas: faixas.map((f) => ({ ...f, programa: programas.get(f.programaId ?? '') ?? null })),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Quantas pessoas com o áudio tocando neste instante.
 *
 * O conjunto do Redis da faixa corrente responde isso de graça: ele já existe para
 * deduplicar a contagem, e o tamanho dele é exatamente quem tocou áudio nesta meia hora.
 * É o número mais próximo de "agora" que dá para ter sem pedir mais nada ao aplicativo.
 */
async function contarAgora(emissoraId: string, faixa: Date) {
  try {
    return await redis.scard(`aud:${emissoraId}:${faixa.getTime()}:ouvindo`)
  } catch {
    return 0
  }
}

// ── Programas ────────────────────────────────────────────────

/**
 * Cada programa, com o que ele fez de audiência.
 *
 * **É a tela que a rádio nunca teve.** Audiência por programa, com participação ao lado —
 * porque as duas contam histórias diferentes: um programa pode segurar muita gente e não
 * arrancar um voto, e outro pode ter metade do público e o dobro de interação. O primeiro
 * vende inventário; o segundo vende relacionamento.
 */
rotasAudiencia.get('/audiencia/programas', exigirOperador(), async (req, res, next) => {
  try {
    const { dias } = periodo.parse(req.query)
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)

    const faixas = await prisma.faixaAudiencia.findMany({
      where: { inicioEm: { gte: faixaDe(desde) } },
      orderBy: { inicioEm: 'asc' },
    })

    const porPrograma = new Map<string, {
      noApp: number; ouvindo: number; minutosOuvidos: number
      momentos: number; mensagens: number; participacoes: number; plays: number
      faixas: number
    }>()

    for (const f of faixas) {
      const chave = f.programaId ?? ''
      const atual = porPrograma.get(chave) ?? {
        noApp: 0, ouvindo: 0, minutosOuvidos: 0,
        momentos: 0, mensagens: 0, participacoes: 0, plays: 0, faixas: 0,
      }
      atual.noApp += f.noApp
      atual.ouvindo += f.ouvindo
      atual.minutosOuvidos += f.minutosOuvidos
      atual.momentos += f.momentos
      atual.mensagens += f.mensagens
      atual.participacoes += f.participacoes
      atual.plays += f.plays
      atual.faixas += 1
      porPrograma.set(chave, atual)
    }

    const nomes = await nomesDe([...porPrograma.keys()])

    const linhas = [...porPrograma.entries()].map(([id, v]) => ({
      programaId: id || null,
      programa: nomes.get(id) ?? 'Fora da grade',
      cor: nomes.get(id + ':cor') ?? null,
      ...v,
      // **Média por faixa, e não soma.** Somar `noApp` de todas as meias horas de um
      // programa de três horas conta a mesma pessoa seis vezes e faz o programa mais
      // longo ganhar sempre. A média por faixa é o que dá para comparar "A Hora do
      // Ronco", de três horas, com "Band ao Vivo", de vinte e cinco minutos.
      mediaNoApp: v.faixas ? Math.round(v.noApp / v.faixas) : 0,
      mediaOuvindo: v.faixas ? Math.round(v.ouvindo / v.faixas) : 0,
      minutosPorOuvinte: v.ouvindo ? Math.round(v.minutosOuvidos / v.ouvindo) : 0,
    }))

    linhas.sort((a, b) => b.mediaNoApp - a.mediaNoApp)
    res.json({ dias, programas: linhas })
  } catch (e) {
    next(e)
  }
})

// ── Evolução ─────────────────────────────────────────────────

/**
 * Dia a dia. A única das três que responde "está crescendo?".
 *
 * O dia é fechado somando as faixas, e não contando pessoas: somar `noApp` de 48 faixas
 * conta quem ficou o dia inteiro 48 vezes. O que a tela mostra é o **pico** e a média,
 * que são comparáveis entre dias — e, para quem quiser gente de verdade no dia, o
 * `DiaDoOuvinte` responde separado, sem dupla contagem.
 */
rotasAudiencia.get('/audiencia/evolucao', exigirOperador(), async (req, res, next) => {
  try {
    const { dias } = periodo.parse(req.query)
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    desde.setHours(0, 0, 0, 0)

    const [faixas, diasDeGente] = await Promise.all([
      prisma.faixaAudiencia.findMany({
        where: { inicioEm: { gte: desde } },
        orderBy: { inicioEm: 'asc' },
      }),
      prisma.diaDoOuvinte.groupBy({
        by: ['data'],
        where: { data: { gte: desde } },
        _count: { _all: true },
        _sum: { minutosOuvidos: true },
      }),
    ])

    const porDia = new Map<string, {
      picoNoApp: number; picoOuvindo: number
      momentos: number; mensagens: number; participacoes: number; plays: number
      minutosOuvidos: number
    }>()

    for (const f of faixas) {
      const chave = f.inicioEm.toISOString().slice(0, 10)
      const atual = porDia.get(chave) ?? {
        picoNoApp: 0, picoOuvindo: 0,
        momentos: 0, mensagens: 0, participacoes: 0, plays: 0, minutosOuvidos: 0,
      }
      atual.picoNoApp = Math.max(atual.picoNoApp, f.noApp)
      atual.picoOuvindo = Math.max(atual.picoOuvindo, f.ouvindo)
      atual.momentos += f.momentos
      atual.mensagens += f.mensagens
      atual.participacoes += f.participacoes
      atual.plays += f.plays
      atual.minutosOuvidos += f.minutosOuvidos
      porDia.set(chave, atual)
    }

    const gente = new Map(
      diasDeGente.map((d) => [d.data.toISOString().slice(0, 10), d._count._all]),
    )

    // Dias sem nada entram como zero: buraco no gráfico esconde uma queda, e uma queda é
    // justamente o que a diretoria abre esta tela para ver.
    const linhas: unknown[] = []
    for (let i = dias; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const chave = d.toISOString().slice(0, 10)
      const v = porDia.get(chave)
      linhas.push({
        dia: chave,
        pessoas: gente.get(chave) ?? 0,
        picoNoApp: v?.picoNoApp ?? 0,
        picoOuvindo: v?.picoOuvindo ?? 0,
        momentos: v?.momentos ?? 0,
        mensagens: v?.mensagens ?? 0,
        participacoes: v?.participacoes ?? 0,
        plays: v?.plays ?? 0,
        minutosOuvidos: v?.minutosOuvidos ?? 0,
      })
    }

    res.json({ dias, evolucao: linhas })
  } catch (e) {
    next(e)
  }
})

/** Nome e cor dos programas citados, num mapa — e `id:cor` para a cor. */
async function nomesDe(ids: (string | null)[]) {
  const limpos = [...new Set(ids.filter((i): i is string => !!i))]
  const mapa = new Map<string, string>()
  if (limpos.length === 0) return mapa
  const programas = await prisma.programa.findMany({
    where: { id: { in: limpos } },
    select: { id: true, nome: true, corDestaque: true },
  })
  for (const p of programas) {
    mapa.set(p.id, p.nome)
    if (p.corDestaque) mapa.set(p.id + ':cor', p.corDestaque)
  }
  return mapa
}

// ── Quem está aí ─────────────────────────────────────────────

/**
 * As pessoas que estão com a rádio neste minuto, com nome e telefone.
 *
 * **É a tela que fecha o círculo do produto.** O locutor olha, escolhe e fala: *"a Ana,
 * de Guarulhos, tá com a gente desde as sete da manhã"*. Quem ouviu o próprio nome no
 * rádio nunca mais desinstala o aplicativo, e quem ouviu o nome de outra pessoa entende
 * na hora que estar ali tem consequência. Nenhum banner faz isso.
 *
 * **Quem tem nome vem primeiro, e isso não é ordenação por acaso.** Ouvinte que entrou só
 * com telefone é invisível para o que esta tela serve: o locutor não tem como citar
 * alguém que ele não sabe chamar. Aparecem no fim, e aparecem de propósito — é o empurrão
 * para a produção pedir o cadastro completo.
 *
 * **Depois do nome, ordena pelo degrau.** Agora que a escada existe, o locutor sabe quem
 * vale citar: alguém da Família Band ouvindo há quarenta minutos é uma história; alguém
 * que abriu o aplicativo pela primeira vez hoje é só um número.
 *
 * O telefone volta inteiro, como na tela do contemplado: é o canal pelo qual a produção
 * chama a pessoa, e mascarar aqui seria proteger a rádio dos próprios ouvintes. O CPF
 * nunca vem — esse fica onde já estava, e para o que já servia.
 */
rotasAudiencia.get('/audiencia/quem-esta-ai', exigirOperador(), async (req, res, next) => {
  try {
    const teto = Math.min(60, Math.max(4, Number(req.query.limite ?? 24)))
    const emissoraId = req.emissora!.id

    const ids = await presentesAgora(emissoraId)
    if (ids.length === 0) return res.json({ pessoas: [], total: 0 })

    const faixa = faixaDe()
    const [pessoas, ouvindoAgora, respostasHoje, ultimas, minutosHoje] = await Promise.all([
      prisma.ouvinte.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, nome: true, apelido: true, telefone: true,
          cidade: true, criadoEm: true, podeSerCitado: true,
        },
      }),
      quaisOuvindo(emissoraId, faixa, ids),
      contarRespostasDeHoje(ids),
      ultimaCoisaQueFez(ids),
      minutosDeHoje(ids),
    ])

    const regua = lerRegua((req.emissora!.configuracao as Record<string, unknown>)?.regua)
    const degraus = await degrauDe(ids, regua)

    const lista = pessoas
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        // **O apelido manda quando existe.** É o nome que a pessoa escolheu para ouvir no
        // rádio, e é o que o locutor deve dizer — "o Dudu, de Guarulhos" soa como alguém
        // que ele conhece; o nome de registro soa como uma lista sendo lida.
        comoChamar: p.apelido?.trim() || p.nome?.trim() || null,
        podeSerCitado: p.podeSerCitado,
        telefone: p.telefone,
        cidade: p.cidade,
        ouvindo: ouvindoAgora.has(p.id),
        votouHoje: respostasHoje.get(p.id) ?? 0,
        minutosHoje: minutosHoje.get(p.id) ?? 0,
        nivel: degraus.get(p.id) ?? 0,
        degrau: regua[degraus.get(p.id) ?? 0]?.rotulo ?? '',
        // O gancho mais quente que existe: "o Dudu votou na Ana Castela agora há pouco".
        // É o que transforma uma lista de nomes numa conversa — o locutor não precisa
        // inventar o que dizer, ele já tem o assunto.
        ultima: ultimas.get(p.id) ?? null,
        desde: p.criadoEm,
      }))
      .sort((a, b) => {
        // **Quem autorizou vem primeiro, depois quem tem nome.** É a ordem do que serve:
        // o locutor está procurando alguém que ele possa citar e saiba chamar. Quem não
        // autorizou continua na lista, e continua de propósito — some-lo esconderia que
        // a rádio tem ouvinte ali, e a produção precisa saber que existe gente que ainda
        // não foi convidada a dizer sim.
        const podeCitar = (x: typeof a) => (x.podeSerCitado && x.comoChamar ? 1 : 0)
        const temNome = (x: typeof a) => (x.comoChamar ? 1 : 0)
        return (
          podeCitar(b) - podeCitar(a) ||
          temNome(b) - temNome(a) ||
          b.nivel - a.nivel ||
          b.votouHoje - a.votouHoje ||
          Number(b.ouvindo) - Number(a.ouvindo)
        )
      })

    res.json({ pessoas: lista.slice(0, teto), total: ids.length })
  } catch (e) {
    next(e)
  }
})

/** Quem apareceu na janela de presença, do mais recente para trás. */
async function presentesAgora(emissoraId: string) {
  try {
    // A mesma janela que alimenta o contador do No Ar. Reusar a chave é o que garante
    // que a lista e o número grande no topo da tela nunca discordem — dois jeitos de
    // contar a mesma coisa é como um painel perde a confiança de quem olha.
    return await redis.zrevrange(`presenca:${emissoraId}`, 0, 199)
  } catch {
    return []
  }
}

/** Quais destes estão com o áudio tocando pelo aplicativo nesta meia hora. */
async function quaisOuvindo(emissoraId: string, faixa: Date, ids: string[]) {
  const dentro = new Set<string>()
  if (ids.length === 0) return dentro
  try {
    const chave = `aud:${emissoraId}:${faixa.getTime()}:ouvindo`
    const tubo = redis.pipeline()
    for (const id of ids) tubo.sismember(chave, id)
    const r = await tubo.exec()
    r?.forEach(([, v], i) => { if (v === 1) dentro.add(ids[i]!) })
  } catch {
    /* sem Redis, ninguém aparece como ouvindo — melhor que aparecer errado. */
  }
  return dentro
}

/** Quantos Momentos cada uma respondeu hoje. É o gancho mais quente para o locutor. */
async function contarRespostasDeHoje(ids: string[]) {
  const inicio = new Date()
  inicio.setHours(0, 0, 0, 0)
  const linhas = await prisma.respostaMomento.groupBy({
    by: ['ouvinteId'],
    where: { ouvinteId: { in: ids }, respondidoEm: { gte: inicio } },
    _count: { _all: true },
  })
  return new Map(linhas.map((l) => [l.ouvinteId, l._count._all]))
}

/**
 * A última coisa que cada uma fez hoje, com o que ela escolheu.
 *
 * **É o que transforma a lista em conversa.** Um nome sozinho obriga o locutor a inventar
 * o que dizer; "votou na Ana Castela há quatro minutos" é o assunto pronto. O rádio já
 * fazia isso com o telefone tocando na mesa — a diferença é que agora o assunto chega
 * antes da ligação.
 */
async function ultimaCoisaQueFez(ids: string[]) {
  const inicio = new Date()
  inicio.setHours(0, 0, 0, 0)
  const linhas = await prisma.respostaMomento.findMany({
    where: { ouvinteId: { in: ids }, respondidoEm: { gte: inicio } },
    orderBy: { respondidoEm: 'desc' },
    select: {
      ouvinteId: true,
      respondidoEm: true,
      opcao: { select: { rotulo: true } },
      momento: { select: { titulo: true } },
    },
  })
  // A consulta vem ordenada do mais recente para trás; o primeiro de cada pessoa é o que
  // interessa, e `Map.set` só entra quando a chave ainda não existe.
  const mapa = new Map<string, { escolha: string | null; momento: string; quando: Date }>()
  for (const l of linhas) {
    if (mapa.has(l.ouvinteId)) continue
    mapa.set(l.ouvinteId, {
      escolha: l.opcao?.rotulo ?? null,
      momento: l.momento.titulo,
      quando: l.respondidoEm,
    })
  }
  return mapa
}

/** Quantos minutos cada uma ouviu pelo aplicativo hoje. */
async function minutosDeHoje(ids: string[]) {
  const hoje = new Date()
  const linhas = await prisma.diaDoOuvinte.findMany({
    where: {
      ouvinteId: { in: ids },
      data: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()),
    },
    select: { ouvinteId: true, minutosOuvidos: true },
  })
  return new Map(linhas.map((l) => [l.ouvinteId, l.minutosOuvidos]))
}

/**
 * O degrau de cada uma, em três consultas em vez de três por pessoa.
 *
 * Sem o agrupamento, uma lista de vinte e quatro pessoas viraria setenta e duas idas ao
 * banco a cada trinta segundos — numa tela que fica aberta o programa inteiro.
 */
async function degrauDe(ids: string[], regua: Degrau[]) {
  const mesAtras = new Date()
  mesAtras.setDate(mesAtras.getDate() - 30)
  const semanaAtras = new Date()
  semanaAtras.setDate(semanaAtras.getDate() - 7)
  const soData = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

  const [dias, momentos, promocoes, cadastros] = await Promise.all([
    prisma.diaDoOuvinte.findMany({
      where: { ouvinteId: { in: ids }, data: { gte: soData(mesAtras) } },
      select: { ouvinteId: true, data: true, minutosOuvidos: true },
    }),
    prisma.respostaMomento.groupBy({
      by: ['ouvinteId'],
      where: { ouvinteId: { in: ids }, respondidoEm: { gte: mesAtras } },
      _count: { _all: true },
    }),
    prisma.participacaoPromocao.groupBy({
      by: ['ouvinteId'],
      where: { ouvinteId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.ouvinte.findMany({
      where: { id: { in: ids } },
      select: { id: true, criadoEm: true },
    }),
  ])

  const porPessoa = new Map<string, number>()
  const nMomentos = new Map(momentos.map((m) => [m.ouvinteId, m._count._all]))
  const nPromocoes = new Map(promocoes.map((p) => [p.ouvinteId, p._count._all]))
  const nascimento = new Map(cadastros.map((c) => [c.id, c.criadoEm]))
  const limiteSemana = soData(semanaAtras)

  for (const id of ids) {
    const meus = dias.filter((d) => d.ouvinteId === id)
    const daSemana = meus.filter((d) => d.data >= limiteSemana)
    const criadoEm = nascimento.get(id)
    porPessoa.set(
      id,
      nivelDe(
        {
          diasNaSemana: daSemana.length,
          diasNoMes: meus.length,
          minutosNaSemana: daSemana.reduce((s, d) => s + d.minutosOuvidos, 0),
          momentosNoMes: nMomentos.get(id) ?? 0,
          promocoes: nPromocoes.get(id) ?? 0,
          // O chat não entra aqui: ele custaria uma consulta a mais por pessoa e não
          // muda o degrau de ninguém que já esteja no ar. A tela de Sua Rádio, que é
          // onde o ouvinte lê o próprio degrau, continua olhando.
          conversou: false,
          diasDeCasa: criadoEm
            ? Math.floor((Date.now() - criadoEm.getTime()) / 86_400_000)
            : 0,
        },
        regua,
      ),
    )
  }
  return porPessoa
}
