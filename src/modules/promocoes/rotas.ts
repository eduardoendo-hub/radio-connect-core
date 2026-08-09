import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOuvinte } from '../../middleware/sessao.js'
import { patrocinioDe } from '../momentos/apresentacao.js'

export const rotasPromocoes = Router()

/**
 * Promoções.
 *
 * O card do No Ar sempre existiu; o botão "Quero participar" nunca levou a lugar
 * nenhum. Estas rotas são o caminho que faltava — e a inscrição é o que a rádio vende
 * como audiência, então tem que ser barata de fazer e impossível de duplicar.
 */

const incluirPatrocinio = {
  campanhaPatrocinadora: {
    select: {
      anunciante: { select: { nome: true } },
      criativos: { select: { tipo: true, url: true } },
    },
  },
} as const

/**
 * A promoção inteira, para a tela de detalhe.
 *
 * Diferente do Estado No Ar, que é o mesmo para toda a emissora e por isso fica em
 * cache: aqui entra `participei`, que é de uma pessoa só. É a mesma separação que
 * existe entre `/no-ar` e `/momentos/:id/resultado`, e pelo mesmo motivo.
 */
rotasPromocoes.get('/:id', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const promocao = await prisma.promocao.findFirst({
      where: { id: req.params.id },
      include: { ...incluirPatrocinio, _count: { select: { participacoes: true } } },
    })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    const minha = await prisma.participacaoPromocao.findFirst({
      where: { promocaoId: promocao.id, ouvinteId: s.ouvinteId },
      select: { participouEm: true, vencedor: true },
    })

    res.json({ promocao: paraTela(promocao), participei: !!minha, ...estadoDe(minha) })
  } catch (e) {
    next(e)
  }
})

/**
 * Entrar no sorteio. Um toque, sem formulário.
 *
 * Pedir dados aqui mataria a participação, e não haveria o que ganhar com isso: o
 * telefone e o nome já vieram na entrada do aplicativo. O que a emissora leva desta
 * tela é o número de inscritos — que é o que ela apresenta ao anunciante.
 */
rotasPromocoes.post('/:id/participar', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const agora = new Date()

    const promocao = await prisma.promocao.findFirst({ where: { id: req.params.id } })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    if (promocao.inicioEm > agora || promocao.fimEm < agora) {
      throw new ErroDaApi(410, 'promocao_encerrada', 'As inscrições para esta promoção já fecharam.')
    }

    // Elegibilidade por Índice de Conexão, quando a emissora exigir. A regra é do
    // servidor porque é ela que decide quem concorre — e prêmio dado a quem não tinha
    // direito é problema que não se desfaz com um deploy.
    if (promocao.scoreMinimo != null) {
      // O Índice de Conexão é uma SÉRIE, não um campo do ouvinte — o valor de hoje é o
      // último ponto dela. Quem nunca teve snapshot vale zero, que é honesto: ainda não
      // há histórico para dar direito a nada.
      const ultimo = await prisma.snapshotConexao.findFirst({
        where: { ouvinteId: s.ouvinteId },
        orderBy: { data: 'desc' },
        select: { score: true },
      })
      if ((ultimo?.score ?? 0) < promocao.scoreMinimo) {
        throw new ErroDaApi(403, 'sem_elegibilidade',
          'Esta promoção é para quem já tem mais tempo de casa. Continue ouvindo — falta pouco.')
      }
    }

    try {
      await prisma.participacaoPromocao.create({
        data: { promocaoId: promocao.id, ouvinteId: s.ouvinteId },
      })
    } catch (e) {
      // Unicidade por par (promoção, ouvinte) mora no banco. Tocar duas vezes no botão
      // com a rede ruim não pode virar duas chances de ganhar.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Já estava inscrito: isso não é erro para quem está olhando a tela. O estado
        // final é o mesmo que ela queria.
        const total = await prisma.participacaoPromocao.count({ where: { promocaoId: promocao.id } })
        return res.json({ participei: true, total, sorteioEm: promocao.sorteioEm?.toISOString() ?? null })
      }
      throw e
    }

    const total = await prisma.participacaoPromocao.count({ where: { promocaoId: promocao.id } })
    res.json({
      participei: true,
      total,
      sorteioEm: promocao.sorteioEm?.toISOString() ?? null,
      mensagem: promocao.sorteioEm
        ? 'Você está concorrendo. O resultado sai ao vivo, com o locutor.'
        : 'Você está concorrendo.',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Minhas promoções — o que alimenta Sua Rádio.
 *
 * Em andamento primeiro, encerradas depois. A ordem importa: o que ainda pode acontecer
 * vale mais que o que já passou, e esta tela é a memória da pessoa com a rádio.
 */
rotasPromocoes.get('/', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const agora = new Date()
    const minhas = await prisma.participacaoPromocao.findMany({
      where: { ouvinteId: s.ouvinteId },
      orderBy: { participouEm: 'desc' },
      take: 30,
      include: { promocao: { include: incluirPatrocinio } },
    })

    const emAndamento = minhas.filter((p) => p.promocao.fimEm >= agora && !p.promocao.resultado)
    const encerradas = minhas.filter((p) => !(p.promocao.fimEm >= agora && !p.promocao.resultado))

    res.json({
      promocoes: [...emAndamento, ...encerradas].map((p) => ({
        ...paraTela(p.promocao),
        participeiEm: p.participouEm.toISOString(),
        venci: p.vencedor,
        encerrada: !(p.promocao.fimEm >= agora && !p.promocao.resultado),
      })),
    })
  } catch (e) {
    next(e)
  }
})

type ComPatrocinio = Parameters<typeof patrocinioDe>[0]

function paraTela(p: {
  id: string
  titulo: string
  descricao: string | null
  regras: string | null
  imagemUrl: string | null
  seloUrl?: string | null
  inicioEm: Date
  fimEm: Date
  sorteioEm: Date | null
  resultado: string | null
  _count?: { participacoes: number }
} & ComPatrocinio) {
  return {
    id: p.id,
    titulo: p.titulo,
    descricao: p.descricao,
    regras: p.regras,
    imagemUrl: p.imagemUrl,
    seloUrl: p.seloUrl ?? null,
    inicioEm: p.inicioEm.toISOString(),
    fimEm: p.fimEm.toISOString(),
    sorteioEm: p.sorteioEm?.toISOString() ?? null,
    resultado: p.resultado,
    total: p._count?.participacoes ?? null,
    patrocinio: patrocinioDe(p),
  }
}

function estadoDe(minha: { participouEm: Date; vencedor: boolean } | null) {
  if (!minha) return {}
  return { participeiEm: minha.participouEm.toISOString(), venci: minha.vencedor }
}
