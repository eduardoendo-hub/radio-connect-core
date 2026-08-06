import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { erros } from '../../lib/erros.js'
import { exigirOuvinte, exigirOperador } from '../../middleware/sessao.js'

/**
 * Chat — conversa privada entre o ouvinte e a rádio.
 *
 * **Não é comunidade.** Cada ouvinte fala com a emissora e ninguém mais vê. Foi decisão
 * de produto: comunidade exige moderação, política de conteúdo, denúncia e time — coisas
 * que uma rádio de porte médio não tem. Um-para-um resolve o que a rádio já faz hoje no
 * WhatsApp, com a diferença de que aqui a mensagem chega vinculada ao programa no ar.
 *
 * **Sobre o Chatwoot:** o modelo já guarda `chatwootContactId` e `chatwootConversationId`
 * porque a operação da rádio vai querer as ferramentas de atendimento — fila, macro,
 * atribuição. O caminho é espelhar: a mensagem nasce aqui, é replicada lá, e o que o
 * agente responde no Chatwoot volta por webhook. Nada nestas rotas muda quando isso
 * ligar, porque o app e o Studio nunca falam com o Chatwoot direto.
 */

export const rotasChat = Router()
export const rotasChatStudio = Router()

/* ------------------------------------------------------------------ ouvinte */

/** A conversa é criada no primeiro acesso, não no cadastro: conversa vazia é ruído. */
async function conversaDoOuvinte(emissoraId: string, ouvinteId: string) {
  const existente = await prisma.conversa.findFirst({ where: { ouvinteId } })
  if (existente) return existente
  return prisma.conversa.create({ data: { emissoraId, ouvinteId } })
}

rotasChat.get('/', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const conversa = await conversaDoOuvinte(req.emissora!.id, s.ouvinteId)
    const mensagens = await prisma.mensagem.findMany({
      where: { conversaId: conversa.id },
      orderBy: { enviadaEm: 'asc' },
      take: 200,
      select: { id: true, direcao: true, tipo: true, conteudo: true, midiaUrl: true, enviadaEm: true },
    })
    res.json({ conversaId: conversa.id, mensagens })
  } catch (e) {
    next(e)
  }
})

const escrever = z.object({
  conteudo: z.string().min(1).max(1000),
  /** Gerada no aparelho: a rede do ouvinte cai, ele tenta de novo, e não duplica. */
  chaveIdempotencia: z.string().max(120).optional(),
})

rotasChat.post('/mensagens', exigirOuvinte(), async (req, res, next) => {
  try {
    const { conteudo } = escrever.parse(req.body)
    const s = req.sessao as { ouvinteId: string }
    const conversa = await conversaDoOuvinte(req.emissora!.id, s.ouvinteId)

    // A mensagem nasce dentro de uma Edição. É isso que permite ao produtor filtrar
    // "tudo que chegou durante o programa que está no ar" em vez de uma caixa infinita.
    const agora = new Date()
    const edicao = await prisma.edicao.findFirst({
      where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
      select: { id: true },
    })

    const mensagem = await prisma.mensagem.create({
      data: {
        conversaId: conversa.id,
        emissoraId: req.emissora!.id,
        direcao: 'ouvinte_para_radio',
        tipo: 'texto',
        conteudo,
        edicaoId: edicao?.id ?? null,
        enviadaEm: agora,
      },
      select: { id: true, direcao: true, tipo: true, conteudo: true, enviadaEm: true },
    })

    await prisma.conversa.update({
      where: { id: conversa.id },
      data: { ultimaMensagemEm: agora },
    })

    res.status(201).json({ mensagem })
  } catch (e) {
    next(e)
  }
})

/* ------------------------------------------------------------------- studio */

const PODE_ATENDER = ['PRODUTOR', 'MARKETING', 'DIRETOR', 'ADMIN'] as const

/**
 * A caixa da produção, ordenada por quem esperou mais.
 *
 * Ordenar por mais recente parece natural e está errado: quem mandou mensagem há vinte
 * minutos e continua esperando afunda na lista justamente quando mais precisa aparecer.
 * A fila é por espera, como qualquer atendimento.
 */
rotasChatStudio.get('/conversas', exigirOperador(...PODE_ATENDER), async (req, res, next) => {
  try {
    const conversas = await prisma.conversa.findMany({
      where: { ultimaMensagemEm: { not: null } },
      orderBy: { ultimaMensagemEm: 'desc' },
      take: 100,
      select: {
        id: true,
        categoria: true,
        ultimaMensagemEm: true,
        lidaPelaRadioEm: true,
        ouvinte: { select: { id: true, nome: true, telefone: true, cidade: true } },
        mensagens: {
          orderBy: { enviadaEm: 'desc' },
          take: 1,
          select: { conteudo: true, direcao: true, tipo: true, enviadaEm: true },
        },
      },
    })

    const lista = conversas.map((c) => ({
      id: c.id,
      categoria: c.categoria,
      ultimaMensagemEm: c.ultimaMensagemEm,
      ouvinte: {
        ...c.ouvinte,
        // O telefone completo não precisa aparecer numa lista que fica aberta na mesa
        // da produção o dia inteiro. Os quatro últimos bastam para conferir com quem
        // ligou; o número inteiro sai quando a conversa é aberta.
        telefone: c.ouvinte.telefone ? `•••• ${c.ouvinte.telefone.slice(-4)}` : null,
      },
      ultima: c.mensagens[0] ?? null,
      esperando:
        !!c.ultimaMensagemEm &&
        c.mensagens[0]?.direcao === 'ouvinte_para_radio' &&
        (!c.lidaPelaRadioEm || c.lidaPelaRadioEm < c.ultimaMensagemEm),
    }))

    res.json({ conversas: lista, esperando: lista.filter((c) => c.esperando).length })
  } catch (e) {
    next(e)
  }
})

rotasChatStudio.get('/conversas/:id', exigirOperador(...PODE_ATENDER), async (req, res, next) => {
  try {
    const conversa = await prisma.conversa.findFirst({
      where: { id: req.params.id },
      select: {
        id: true,
        categoria: true,
        ouvinte: { select: { id: true, nome: true, telefone: true, cidade: true, criadoEm: true } },
      },
    })
    if (!conversa) throw erros.naoEncontrado('Conversa')

    const mensagens = await prisma.mensagem.findMany({
      where: { conversaId: conversa.id },
      orderBy: { enviadaEm: 'asc' },
      take: 300,
      select: {
        id: true, direcao: true, tipo: true, conteudo: true, midiaUrl: true, enviadaEm: true,
        edicao: { select: { programa: { select: { nome: true } } } },
      },
    })

    // Abrir é ler. Marcar como lida num botão separado só cria trabalho manual que a
    // produção esquece de fazer — e o contador do menu deixa de significar algo.
    await prisma.conversa.update({
      where: { id: conversa.id },
      data: { lidaPelaRadioEm: new Date() },
    })

    res.json({ conversa, mensagens })
  } catch (e) {
    next(e)
  }
})

const responder = z.object({ conteudo: z.string().min(1).max(1000) })

rotasChatStudio.post('/conversas/:id/responder', exigirOperador(...PODE_ATENDER), async (req, res, next) => {
  try {
    const { conteudo } = responder.parse(req.body)
    const conversa = await prisma.conversa.findFirst({ where: { id: req.params.id }, select: { id: true } })
    if (!conversa) throw erros.naoEncontrado('Conversa')

    const agora = new Date()
    const edicao = await prisma.edicao.findFirst({
      where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
      select: { id: true },
    })

    const mensagem = await prisma.mensagem.create({
      data: {
        conversaId: conversa.id,
        emissoraId: req.emissora!.id,
        direcao: 'radio_para_ouvinte',
        tipo: 'texto',
        conteudo,
        edicaoId: edicao?.id ?? null,
        enviadaEm: agora,
      },
      select: { id: true, direcao: true, tipo: true, conteudo: true, enviadaEm: true },
    })

    await prisma.conversa.update({
      where: { id: conversa.id },
      data: { ultimaMensagemEm: agora, lidaPelaRadioEm: agora },
    })

    res.status(201).json({ mensagem })
  } catch (e) {
    next(e)
  }
})
