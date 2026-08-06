import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { redis, chaves } from '../../lib/redis.js'
import { erros } from '../../lib/erros.js'
import { exigirOuvinte } from '../../middleware/sessao.js'
import { recalcular } from '../noar/servico.js'

export const rotasMomentos = Router()

const responder = z.object({
  opcaoId: z.string().optional(),
  /**
   * Gerada no cliente. Em rede móvel ruim o app reenvia sem saber se a primeira chegou;
   * a chave garante que reenviar não vira voto duplicado.
   */
  chaveIdempotencia: z.string().max(64).optional(),
})

/**
 * Participar de um Momento.
 *
 * Isto é AÇÃO, não telemetria: precisa de resposta imediata ("seu voto foi registrado"),
 * de unicidade e de consistência. Não vai para fila.
 */
rotasMomentos.post('/:id/responder', exigirOuvinte(), async (req, res, next) => {
  try {
    const { opcaoId, chaveIdempotencia } = responder.parse(req.body)
    const s = req.sessao as { ouvinteId: string }
    const agora = new Date()

    const momento = await prisma.momento.findFirst({
      where: { id: req.params.id },
      include: { opcoes: { orderBy: { ordem: 'asc' } } },
    })
    if (!momento) throw erros.naoEncontrado('Momento')

    // A janela é ampla de propósito — 1 a 3 minutos — justamente para absorver a
    // diferença de atraso entre quem ouve no FM e quem ouve pelo streaming.
    if (momento.estado !== 'ATIVO' || momento.fimEm < agora || momento.inicioEm > agora) {
      throw erros.momentoEncerrado()
    }

    if (opcaoId && !momento.opcoes.some((o) => o.id === opcaoId)) {
      throw erros.dadosInvalidos([{ campo: 'opcaoId', problema: 'opção não pertence a este Momento' }])
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.respostaMomento.create({
          data: {
            momentoId: momento.id,
            ouvinteId: s.ouvinteId,
            opcaoId: opcaoId ?? null,
            chaveIdempotencia: chaveIdempotencia ?? null,
          },
        })
        if (opcaoId) {
          await tx.opcaoMomento.update({ where: { id: opcaoId }, data: { votos: { increment: 1 } } })
        }
      })
    } catch (e) {
      // Unicidade por par (momento, ouvinte) — a regra "impedir votos duplicados" mora
      // no banco, não numa validação que alguém pode esquecer de chamar.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw erros.jaParticipou()
      }
      throw e
    }

    const opcoes = await prisma.opcaoMomento.findMany({
      where: { momentoId: momento.id },
      orderBy: { ordem: 'asc' },
      select: { id: true, rotulo: true, emoji: true, votos: true },
    })
    const total = opcoes.reduce((s, o) => s + o.votos, 0)

    // O produto reconhece a ação na hora. Tocar num botão e ficar sem resposta é o
    // jeito mais rápido de a pessoa achar que não funcionou.
    res.json({
      registrado: true,
      mensagem: momento.mensagemPosResposta ?? 'Seu voto foi registrado.',
      resultado: {
        total,
        opcoes: opcoes.map((o) => ({
          ...o,
          percentual: total ? Math.round((o.votos / total) * 100) : 0,
        })),
      },
    })

    void redis.incr(chaves.votos(momento.id)).catch(() => {})
  } catch (e) {
    next(e)
  }
})

/** Resultado de um Momento — o fechamento que cria reciprocidade. */
rotasMomentos.get('/:id/resultado', exigirOuvinte(), async (req, res, next) => {
  try {
    const momento = await prisma.momento.findFirst({
      where: { id: req.params.id },
      select: { id: true, titulo: true, estado: true, tipo: true },
    })
    if (!momento) throw erros.naoEncontrado('Momento')

    const s = req.sessao as { ouvinteId: string }
    const [opcoes, minha] = await Promise.all([
      prisma.opcaoMomento.findMany({
        where: { momentoId: momento.id },
        orderBy: { ordem: 'asc' },
        select: { id: true, rotulo: true, emoji: true, votos: true },
      }),
      // O Estado No Ar é o mesmo para toda a emissora — é o que permite guardá-lo em
      // cache e responder 304. Por isso a resposta de cada pessoa não pode morar lá:
      // ela vem daqui, na consulta que o cartão já faz quando abre.
      prisma.respostaMomento.findFirst({
        where: { momentoId: momento.id, ouvinteId: s.ouvinteId },
        select: { opcaoId: true },
      }),
    ])
    const total = opcoes.reduce((sum, o) => sum + o.votos, 0)

    res.json({
      momento,
      total,
      respondi: !!minha,
      minhaOpcaoId: minha?.opcaoId ?? null,
      opcoes: opcoes.map((o) => ({ ...o, percentual: total ? Math.round((o.votos / total) * 100) : 0 })),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * A aba Momentos: o ativo e os resultados recentes.
 *
 * Com corte de 24h e sem paginação para trás, de propósito — o capítulo do No Ar é
 * explícito em que o Momento encerrado não vira feed. O histórico completo mora em
 * Sua Rádio, que é o lugar da memória.
 */
rotasMomentos.get('/', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const momentos = await prisma.momento.findMany({
      where: { estado: { in: ['ATIVO', 'ENCERRADO', 'RESULTADO_PUBLICADO'] }, inicioEm: { gte: desde } },
      orderBy: { inicioEm: 'desc' },
      take: 20,
      include: { opcoes: { orderBy: { ordem: 'asc' }, select: { id: true, rotulo: true, emoji: true, votos: true } } },
    })

    // O que esta pessoa já respondeu. Sem isso o app não tem como lembrar da própria
    // participação: quem votou pelo No Ar chegava na aba Momentos e via o mesmo
    // convite de novo, como se nada tivesse acontecido. Participação sem memória não
    // é conexão — é formulário.
    // RespostaMomento é filho, não carrega `emissoraId` e por isso não é escopada
    // automaticamente. Aqui não há brecha: os momentos já vieram filtrados pela
    // emissora do contexto e o ouvinte é o da sessão.
    const minhas = await prisma.respostaMomento.findMany({
      where: { momentoId: { in: momentos.map((m) => m.id) }, ouvinteId: s.ouvinteId },
      select: { momentoId: true, opcaoId: true },
    })
    const porMomento = new Map(minhas.map((r) => [r.momentoId, r.opcaoId]))

    res.json({
      momentos: momentos.map((m) => ({
        ...m,
        respondi: porMomento.has(m.id),
        minhaOpcaoId: porMomento.get(m.id) ?? null,
      })),
    })
  } catch (e) {
    next(e)
  }
})
