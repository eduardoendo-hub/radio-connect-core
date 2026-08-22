import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { contarPresenca } from '../noar/servico.js'
import { redis } from '../../lib/redis.js'
import { faixaDe } from '../../lib/tempo.js'

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
