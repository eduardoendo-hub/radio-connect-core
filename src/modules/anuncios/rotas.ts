import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { exigirOuvinte } from '../../middleware/sessao.js'

/**
 * Decisão de anúncio.
 *
 * O inventário é requisito de MVP, não fase dois: a receita do Radio Connect vem de
 * mídia, e uma rádio que não vê o anúncio na tela não entende como o produto se paga.
 *
 * ## As regras de convivência
 *
 * O capítulo do inventário é explícito em que **publicidade não pode ferir a
 * experiência**, e isso vira código aqui, não boa vontade:
 *
 *   · **Momento no ar mata o banner.** A interação tem prioridade absoluta; anúncio
 *     nenhum compete com a pergunta que a rádio acabou de fazer.
 *   · **Teto por sessão.** Passou do limite, para de servir — mesmo com campanha ativa
 *     e inventário sobrando.
 *   · **Intervalo mínimo no pré-roll.** Ninguém ouve anúncio duas vezes por ter apertado
 *     pausa e play.
 *
 * ## Por que a impressão é registrada aqui, e não no aplicativo
 *
 * Sem registro no servidor não existe cálculo de revenue share, e o extrato do mês vira
 * discussão com cada emissora. O aplicativo confirma depois se o anúncio ficou visível e
 * se o pré-roll foi ouvido até o fim — mas quem cria a linha é quem decidiu servir.
 */

export const rotasAnuncios = Router()

/** Onde um anúncio pode aparecer. */
const POSICOES = ['no_ar_banner', 'chat_inline', 'preroll'] as const
type Posicao = (typeof POSICOES)[number]

const pedido = z.object({
  posicao: z.enum(POSICOES),
})

type ConfigAnuncios = {
  bannerNoAr?: boolean
  prerollMinutosEntre?: number
  maxImpressoesPorSessao?: number
}

rotasAnuncios.get('/', exigirOuvinte(), async (req, res, next) => {
  try {
    const { posicao } = pedido.parse({ posicao: req.query.posicao })
    const s = req.sessao as { ouvinteId: string }
    const agora = new Date()

    const cfg = ((req.emissora!.configuracao as { anuncios?: ConfigAnuncios } | null)?.anuncios ??
      {}) as ConfigAnuncios

    // A emissora pode desligar o banner por configuração, sem tocar em código.
    if (posicao === 'no_ar_banner' && cfg.bannerNoAr === false) {
      return res.json({ anuncio: null, motivo: 'desligado' })
    }

    // O programa no ar pode não aceitar publicidade.
    //
    // Vale para banner E pré-roll: no horário político eleitoral, no religioso ou no
    // especial vendido com exclusividade, servir qualquer anúncio é problema jurídico
    // ou quebra de contrato — não receita. A decisão é do servidor porque o app não
    // pode ser o guardião de uma regra que custa caro errar.
    const noAr = await prisma.edicao.findFirst({
      where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
      select: { programa: { select: { anunciosAtivos: true } } },
    })
    if (noAr && !noAr.programa.anunciosAtivos) {
      return res.json({ anuncio: null, motivo: 'programa_sem_publicidade' })
    }

    // Momento no ar? Então o banner não entra.
    if (posicao === 'no_ar_banner') {
      const momentoAtivo = await prisma.momento.count({
        where: { estado: 'ATIVO', inicioEm: { lte: agora }, fimEm: { gte: agora } },
      })
      if (momentoAtivo > 0) {
        return res.json({ anuncio: null, motivo: 'momento_no_ar' })
      }
    }

    // Teto por sessão, contado nas últimas duas horas — que é uma sessão de rádio
    // generosa. Sem janela, o teto valeria para a vida inteira do ouvinte.
    const teto = cfg.maxImpressoesPorSessao ?? 6
    const desde = new Date(agora.getTime() - 2 * 60 * 60 * 1000)
    const jaViu = await prisma.impressaoAnuncio.count({
      where: { ouvinteId: s.ouvinteId, posicao, ocorridaEm: { gte: desde } },
    })
    if (jaViu >= teto) {
      return res.json({ anuncio: null, motivo: 'teto_da_sessao' })
    }

    // Pré-roll tem intervalo próprio: apertar pausa e play não pode render anúncio.
    if (posicao === 'preroll') {
      const minutos = cfg.prerollMinutosEntre ?? 30
      const ultimo = await prisma.impressaoAnuncio.findFirst({
        where: { ouvinteId: s.ouvinteId, posicao: 'preroll' },
        orderBy: { ocorridaEm: 'desc' },
        select: { ocorridaEm: true },
      })
      if (ultimo && agora.getTime() - ultimo.ocorridaEm.getTime() < minutos * 60 * 1000) {
        return res.json({ anuncio: null, motivo: 'intervalo' })
      }
    }

    const criativo = await escolherCriativo(posicao, agora)
    if (!criativo) return res.json({ anuncio: null, motivo: 'sem_inventario' })

    const edicao = await prisma.edicao.findFirst({
      where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
      select: { id: true },
    })

    // A linha nasce agora, marcada como não vista. O aplicativo confirma depois.
    const impressao = await prisma.impressaoAnuncio.create({
      data: {
        emissoraId: req.emissora!.id,
        posicao,
        origem: 'DIRETA',
        vendidoPor: criativo.campanha.vendidoPor,
        campanhaId: criativo.campanhaId,
        ouvinteId: s.ouvinteId,
        edicaoId: edicao?.id ?? null,
      },
      select: { id: true },
    })

    res.json({
      anuncio: {
        impressaoId: impressao.id,
        anunciante: criativo.campanha.anunciante.nome,
        tipo: criativo.tipo,
        url: criativo.url,
        clickUrl: criativo.clickUrl,
        duracao: criativo.duracao,
      },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Qual criativo entra.
 *
 * Sorteio simples entre os elegíveis. Quando existir programática de verdade, é aqui
 * que a chamada externa entra — e o resto do caminho, incluindo o registro da
 * impressão, continua igual. É por isso que `origem` existe em cada linha desde o
 * primeiro dia.
 */
async function escolherCriativo(posicao: Posicao, agora: Date) {
  const criativos = await prisma.criativo.findMany({
    where: {
      campanha: { status: 'ATIVA', inicioEm: { lte: agora }, fimEm: { gte: agora } },
    },
    include: {
      campanha: {
        select: { id: true, vendidoPor: true, anunciante: { select: { nome: true } } },
      },
    },
  })

  // `posicoes` é Json: filtrar em memória custa nada num punhado de criativos e evita
  // um índice GIN só para isso.
  const elegiveis = criativos.filter((c) => {
    const p = (c.posicoes as string[] | null) ?? []
    return p.length === 0 || p.includes(posicao)
  })
  if (elegiveis.length === 0) return null

  return elegiveis[Math.floor(Math.random() * elegiveis.length)]!
}

const confirmacao = z.object({
  visivel: z.boolean().optional(),
  clicado: z.boolean().optional(),
  /** Pré-roll ouvido até o fim. É o que separa impressão de impressão paga. */
  concluido: z.boolean().optional(),
})

rotasAnuncios.post('/:id/confirmar', exigirOuvinte(), async (req, res, next) => {
  try {
    const d = confirmacao.parse(req.body)
    const s = req.sessao as { ouvinteId: string }

    // O ouvinte da sessão precisa ser o dono da impressão: sem isso qualquer pessoa
    // marcaria as impressões de qualquer outra como vistas e clicadas.
    await prisma.impressaoAnuncio.updateMany({
      where: { id: req.params.id, ouvinteId: s.ouvinteId },
      data: d,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})
