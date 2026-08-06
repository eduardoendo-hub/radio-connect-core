import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma.js'
import { assinar } from '../../lib/token.js'
import { env } from '../../lib/env.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { recalcular } from '../noar/servico.js'

export const rotasStudio = Router()

// ─────────────────────────────────────────────────────────────
// Entrada
// ─────────────────────────────────────────────────────────────

rotasStudio.post('/entrar', async (req, res, next) => {
  try {
    const { email, senha } = z.object({ email: z.string().email(), senha: z.string().min(6) }).parse(req.body)

    const op = await prisma.operador.findFirst({ where: { email: email.toLowerCase(), ativo: true } })
    if (!op || !(await bcrypt.compare(senha, op.senhaHash))) {
      throw new ErroDaApi(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.')
    }

    await prisma.operador.update({ where: { id: op.id }, data: { ultimoLogin: new Date() } })

    const token = await assinar(
      { tipo: 'operador', operadorId: op.id, emissoraId: req.emissora!.id, papel: op.papel },
      env.JWT_OPERADOR_EXPIRA,
    )
    res.json({
      token,
      operador: { id: op.id, nome: op.nome, email: op.email, papel: op.papel },
      emissora: { slug: req.emissora!.slug, nome: req.emissora!.nome },
    })
  } catch (e) {
    next(e)
  }
})

// ─────────────────────────────────────────────────────────────
// Hoje — o Studio abre com o trabalho do dia, não com gráficos
// ─────────────────────────────────────────────────────────────

rotasStudio.get('/hoje', exigirOperador(), async (req, res, next) => {
  try {
    const agora = new Date()
    const inicio = new Date(agora); inicio.setHours(0, 0, 0, 0)
    const fim = new Date(agora); fim.setHours(23, 59, 59, 999)

    const edicoes = await prisma.edicao.findMany({
      where: { inicioEm: { gte: inicio, lte: fim } },
      orderBy: { inicioEm: 'asc' },
      include: {
        programa: { select: { id: true, nome: true, imagemUrl: true, corDestaque: true } },
        locutor: { select: { id: true, nome: true, imagemUrl: true } },
        _count: { select: { momentos: true } },
      },
    })

    const aoVivo = edicoes.find((e) => e.inicioEm <= agora && e.fimEm >= agora) ?? null

    const [momentosAgendados, promocoesAtivas, naoLidas] = await Promise.all([
      prisma.momento.count({ where: { estado: { in: ['AGENDADO', 'PRONTO'] }, inicioEm: { gte: agora } } }),
      prisma.promocao.count({ where: { inicioEm: { lte: agora }, fimEm: { gte: agora } } }),
      // Conversas esperando resposta. O menu do Studio mostra esse número de qualquer
      // tela: quem está operando o ao vivo não deixa de saber que tem ouvinte na fila.
      prisma.conversa.count({
        where: {
          ultimaMensagemEm: { not: null },
          OR: [
            { lidaPelaRadioEm: null },
            { lidaPelaRadioEm: { lt: prisma.conversa.fields.ultimaMensagemEm } },
          ],
        },
      }),
    ])

    res.json({
      edicoes,
      aoVivoId: aoVivo?.id ?? null,
      naoLidas,
      resumo: { programas: edicoes.length, momentosAgendados, promocoesAtivas },
    })
  } catch (e) {
    next(e)
  }
})

/** A operação Ao Vivo: a edição corrente com sua linha do tempo de Momentos. */
rotasStudio.get('/edicoes/:id', exigirOperador(), async (req, res, next) => {
  try {
    const edicao = await prisma.edicao.findFirst({
      where: { id: req.params.id },
      include: {
        programa: true,
        locutor: true,
        momentos: {
          orderBy: { inicioEm: 'asc' },
          include: { opcoes: { orderBy: { ordem: 'asc' } } },
        },
      },
    })
    if (!edicao) throw erros.naoEncontrado('Edição')
    res.json({ edicao })
  } catch (e) {
    next(e)
  }
})

rotasStudio.get('/templates', exigirOperador(), async (req, res, next) => {
  try {
    const templates = await prisma.templateMomento.findMany({ orderBy: [{ favorito: 'desc' }, { nome: 'asc' }] })
    res.json({ templates })
  } catch (e) {
    next(e)
  }
})

// ─────────────────────────────────────────────────────────────
// Momentos — meta de UX: criar em menos de 20 segundos
// ─────────────────────────────────────────────────────────────

const criarMomento = z.object({
  edicaoId: z.string(),
  tipo: z.enum(['REACAO', 'ESCOLHA', 'ENQUETE', 'AVISO', 'CHAMADA_PROMOCAO', 'RESULTADO']),
  titulo: z.string().min(1).max(120),
  texto: z.string().max(500).optional(),
  opcoes: z.array(z.object({ rotulo: z.string().min(1).max(60), emoji: z.string().max(8).optional() })).max(6).optional(),
  duracaoSegundos: z.number().int().min(30).max(1800).default(180),
  publicarAgora: z.boolean().default(true),
  templateId: z.string().optional(),
  campanhaPatrocinadoraId: z.string().optional(),
  promocaoId: z.string().optional(),
})

rotasStudio.post('/momentos', exigirOperador('PRODUTOR', 'MARKETING', 'DIRETOR'), async (req, res, next) => {
  try {
    const d = criarMomento.parse(req.body)
    const s = req.sessao as { operadorId: string }
    const agora = new Date()

    const edicao = await prisma.edicao.findFirst({ where: { id: d.edicaoId }, select: { id: true } })
    if (!edicao) throw erros.naoEncontrado('Edição')

    const momento = await prisma.momento.create({
      data: {
        emissoraId: req.emissora!.id,
        edicaoId: d.edicaoId,
        tipo: d.tipo,
        titulo: d.titulo,
        texto: d.texto ?? null,
        estado: d.publicarAgora ? 'ATIVO' : 'PRONTO',
        inicioEm: agora,
        fimEm: new Date(agora.getTime() + d.duracaoSegundos * 1000),
        templateId: d.templateId ?? null,
        campanhaPatrocinadoraId: d.campanhaPatrocinadoraId ?? null,
        promocaoId: d.promocaoId ?? null,
        criadoPorId: s.operadorId,
        opcoes: d.opcoes?.length
          ? { create: d.opcoes.map((o, i) => ({ ordem: i, rotulo: o.rotulo, emoji: o.emoji ?? null })) }
          : undefined,
      },
      include: { opcoes: { orderBy: { ordem: 'asc' } } },
    })

    // O app precisa ver isso agora. É esta linha que faz o Momento aparecer no celular
    // no instante em que o produtor clica.
    if (momento.estado === 'ATIVO') await recalcular(req.emissora!)

    res.status(201).json({ momento })
  } catch (e) {
    next(e)
  }
})

/** Encerra e publica o resultado — sem fechamento, a interação parece vazia. */
rotasStudio.post('/momentos/:id/encerrar', exigirOperador('PRODUTOR', 'MARKETING', 'DIRETOR'), async (req, res, next) => {
  try {
    const momento = await prisma.momento.findFirst({ where: { id: req.params.id } })
    if (!momento) throw erros.naoEncontrado('Momento')

    await prisma.momento.update({
      where: { id: momento.id },
      data: { estado: 'RESULTADO_PUBLICADO', fimEm: new Date() },
    })
    await recalcular(req.emissora!)

    const opcoes = await prisma.opcaoMomento.findMany({
      where: { momentoId: momento.id },
      orderBy: { votos: 'desc' },
    })
    res.json({ encerrado: true, opcoes })
  } catch (e) {
    next(e)
  }
})

/** Audiência ao vivo — o admin vê o que está acontecendo agora. */
rotasStudio.get('/audiencia', exigirOperador('ADMIN', 'DIRETOR'), async (req, res, next) => {
  try {
    const { contarPresenca } = await import('../noar/servico.js')
    const agora = new Date()
    const [ouvintesAgora, totalCadastrados, novosHoje] = await Promise.all([
      contarPresenca(req.emissora!.id),
      prisma.ouvinte.count(),
      prisma.ouvinte.count({ where: { criadoEm: { gte: new Date(agora.getTime() - 86400000) } } }),
    ])
    res.json({ ouvintesAgora, totalCadastrados, novosHoje })
  } catch (e) {
    next(e)
  }
})
