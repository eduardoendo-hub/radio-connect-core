import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { recalcular } from '../noar/servico.js'

export const rotasPromocoesStudio = Router()

/**
 * Promoções, do lado de quem opera.
 *
 * A promoção sempre foi o formato de maior audiência da rádio, e até agora só existia
 * se alguém a escrevesse no seed. Aqui ela vira trabalho de produção: criar, conferir
 * quantos entraram, encerrar.
 */

/**
 * O fim das inscrições é o próprio sorteio.
 *
 * Poderiam ser duas datas — fechar às 14h e sortear às 15h — mas na rádio não são: o
 * locutor abre o microfone, diz "última chance" e sorteia. Uma data só é como a coisa
 * acontece, e é um campo a menos para o produtor errar com o ao vivo rodando.
 */
const criar = z.object({
  titulo: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(300).optional(),
  regras: z.string().trim().max(4000).optional(),
  imagemUrl: z.string().trim().max(500).optional(),
  seloUrl: z.string().trim().max(500).optional(),
  sorteioEm: z.string(),
  campanhaPatrocinadoraId: z.string().optional(),
  /// Elegibilidade por Índice de Conexão. Vazio = todo mundo concorre.
  scoreMinimo: z.number().int().min(0).max(100).optional(),
})

rotasPromocoesStudio.post('/promocoes', exigirOperador(), async (req, res, next) => {
  try {
    const dados = criar.parse(req.body)
    const sorteioEm = new Date(dados.sorteioEm)
    const agora = new Date()

    if (Number.isNaN(sorteioEm.getTime())) {
      throw erros.dadosInvalidos([{ campo: 'sorteioEm', problema: 'data inválida' }])
    }
    // Sorteio no passado não é engano de digitação inofensivo: a promoção nasceria
    // encerrada, sumiria do No Ar na hora e o produtor acharia que não publicou.
    if (sorteioEm <= agora) {
      throw new ErroDaApi(422, 'sorteio_no_passado',
        'O sorteio precisa ser depois de agora — senão a promoção já nasce encerrada.')
    }

    const promocao = await prisma.promocao.create({
      data: {
        // A extensão do Prisma escopa leitura por emissora sozinha, mas escrita não —
        // de propósito: criar registro sem dono é o erro caro, então ele fica explícito.
        emissoraId: req.emissora!.id,
        titulo: dados.titulo,
        descricao: dados.descricao || null,
        regras: dados.regras || null,
        imagemUrl: dados.imagemUrl || null,
        seloUrl: dados.seloUrl || null,
        inicioEm: agora,
        fimEm: sorteioEm,
        sorteioEm,
        campanhaPatrocinadoraId: dados.campanhaPatrocinadoraId || null,
        scoreMinimo: dados.scoreMinimo ?? null,
      },
    })

    // O No Ar é projeção: sem recalcular, a promoção só apareceria no próximo ciclo do
    // agendador. Publicar e não ver na tela é o jeito mais rápido de o produtor achar
    // que não funcionou.
    await recalcular(req.emissora!)

    res.status(201).json({ promocao })
  } catch (e) {
    next(e)
  }
})

/** A lista da produção: no ar primeiro, depois agendadas, depois o que já passou. */
rotasPromocoesStudio.get('/promocoes', exigirOperador(), async (req, res, next) => {
  try {
    const agora = new Date()
    const promocoes = await prisma.promocao.findMany({
      orderBy: { sorteioEm: 'asc' },
      take: 50,
      include: {
        _count: { select: { participacoes: true } },
        campanhaPatrocinadora: { select: { nome: true, anunciante: { select: { nome: true } } } },
      },
    })

    res.json({
      promocoes: promocoes
        .map((p) => ({
          id: p.id,
          titulo: p.titulo,
          descricao: p.descricao,
          imagemUrl: p.imagemUrl,
          seloUrl: p.seloUrl,
          inicioEm: p.inicioEm.toISOString(),
          fimEm: p.fimEm.toISOString(),
          sorteioEm: p.sorteioEm?.toISOString() ?? null,
          resultado: p.resultado,
          participantes: p._count.participacoes,
          patrocinador: p.campanhaPatrocinadora?.anunciante.nome ?? null,
          estado: p.resultado
            ? ('sorteada' as const)
            : p.fimEm < agora
              ? ('encerrada' as const)
              : p.inicioEm > agora
                ? ('agendada' as const)
                : ('no_ar' as const),
        }))
        // No ar primeiro: é a que o produtor está operando agora e a que ele veio ver.
        .sort((a, b) => ordem(a.estado) - ordem(b.estado)),
    })
  } catch (e) {
    next(e)
  }
})

/** Encerrar antes da hora — desistência, problema com o prêmio, erro de publicação. */
rotasPromocoesStudio.post('/promocoes/:id/encerrar', exigirOperador(), async (req, res, next) => {
  try {
    const promocao = await prisma.promocao.findFirst({ where: { id: req.params.id } })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    await prisma.promocao.update({
      where: { id: promocao.id },
      data: { fimEm: new Date() },
    })
    await recalcular(req.emissora!)
    res.json({ encerrada: true })
  } catch (e) {
    next(e)
  }
})

const ORDEM = { no_ar: 0, agendada: 1, encerrada: 2, sorteada: 3 } as const
function ordem(estado: keyof typeof ORDEM) {
  return ORDEM[estado]
}
