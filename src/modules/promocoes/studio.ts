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
  publicada: z.boolean().optional(),
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
        publicada: dados.publicada ?? true,
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
          // `regras` e a campanha vêm na lista de propósito: é o que o editor precisa
          // para abrir já preenchido. Uma chamada a menos entre clicar e ver o texto.
          regras: p.regras,
          campanhaPatrocinadoraId: p.campanhaPatrocinadoraId,
          imagemUrl: p.imagemUrl,
          seloUrl: p.seloUrl,
          inicioEm: p.inicioEm.toISOString(),
          fimEm: p.fimEm.toISOString(),
          sorteioEm: p.sorteioEm?.toISOString() ?? null,
          resultado: p.resultado,
          publicada: p.publicada,
          participantes: p._count.participacoes,
          patrocinador: p.campanhaPatrocinadora?.anunciante.nome ?? null,
          // "Preparada" vem antes de tudo: uma promoção despublicada não está no ar
          // nem encerrada — ela ainda nem aconteceu, por decisão de quem opera.
          estado: p.resultado
            ? ('sorteada' as const)
            : !p.publicada
              ? ('preparada' as const)
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

/**
 * Editar uma promoção que já está no ar.
 *
 * Corrigir texto, trocar a arte, adiar o sorteio — coisas que acontecem entre o
 * produtor publicar e o locutor ler no ar. Antes só dava para encerrar e criar de novo,
 * o que jogava fora quem já tinha se inscrito.
 *
 * Adiar o sorteio move o fim das inscrições junto, porque são a mesma coisa aqui.
 */
const editar = criar.partial()

rotasPromocoesStudio.patch('/promocoes/:id', exigirOperador(), async (req, res, next) => {
  try {
    const dados = editar.parse(req.body)
    const promocao = await prisma.promocao.findFirst({ where: { id: req.params.id } })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    let sorteioEm: Date | undefined
    if (dados.sorteioEm) {
      sorteioEm = new Date(dados.sorteioEm)
      if (Number.isNaN(sorteioEm.getTime())) {
        throw erros.dadosInvalidos([{ campo: 'sorteioEm', problema: 'data inválida' }])
      }
      // Antecipar para o passado encerra na hora — e quem já se inscreveu fica sem
      // sorteio. Se a intenção é essa, existe o botão de encerrar, que diz o que faz.
      if (sorteioEm <= new Date()) {
        throw new ErroDaApi(422, 'sorteio_no_passado',
          'Para tirar do ar agora, use Encerrar — assim fica claro para quem se inscreveu.')
      }
    }

    await prisma.promocao.update({
      where: { id: promocao.id },
      data: {
        titulo: dados.titulo ?? undefined,
        descricao: dados.descricao ?? undefined,
        regras: dados.regras ?? undefined,
        imagemUrl: dados.imagemUrl ?? undefined,
        seloUrl: dados.seloUrl ?? undefined,
        ...(sorteioEm ? { sorteioEm, fimEm: sorteioEm } : {}),
        publicada: dados.publicada ?? undefined,
        campanhaPatrocinadoraId: dados.campanhaPatrocinadoraId ?? undefined,
      },
    })
    await recalcular(req.emissora!)
    res.json({ atualizada: true })
  } catch (e) {
    next(e)
  }
})

/**
 * Pôr no ar e tirar do ar, sem encerrar.
 *
 * Criar e publicar eram a mesma coisa, e não são: a produção monta a promoção com
 * calma, confere a arte, lê o regulamento em voz alta, e só então coloca no ar.
 *
 * Despublicar **não encerra**. As inscrições de quem já entrou continuam valendo e o
 * sorteio ainda vai acontecer — a promoção só sai da tela. É o que a rádio faz quando
 * descobre um erro no texto no meio da tarde.
 */
rotasPromocoesStudio.post('/promocoes/:id/publicacao', exigirOperador(), async (req, res, next) => {
  try {
    const { publicada } = z.object({ publicada: z.boolean() }).parse(req.body)
    const promocao = await prisma.promocao.findFirst({ where: { id: req.params.id } })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    await prisma.promocao.update({ where: { id: promocao.id }, data: { publicada } })
    await recalcular(req.emissora!)
    res.json({ publicada })
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

/**
 * O sorteio.
 *
 * É o momento que a promoção inteira existe para chegar: o locutor abre o microfone e
 * diz um nome. Antes disso tudo é expectativa; sem isso, a promoção termina em
 * "concorrendo" e nunca vira história.
 *
 * Três decisões que valem mais que o código:
 *
 * **Sortear encerra.** Não são dois passos. Na rádio o locutor fecha as inscrições e
 * sorteia no mesmo fôlego, e separar isso criaria a janela em que alguém se inscreve
 * depois do nome já ter sido escolhido.
 *
 * **Não se sorteia duas vezes.** Um segundo sorteio invalidaria o primeiro nome — que
 * já pode ter ido ao ar. Se a rádio precisar de outro contemplado (o primeiro não
 * atendeu, por exemplo), isso é uma decisão editorial com registro próprio, não um
 * botão que qualquer um aperta de novo.
 *
 * **O sorteio é do servidor.** Nunca do navegador de quem opera: prêmio decidido no
 * cliente é prêmio que alguém pode escolher.
 */
rotasPromocoesStudio.post('/promocoes/:id/sortear', exigirOperador(), async (req, res, next) => {
  try {
    const promocao = await prisma.promocao.findFirst({ where: { id: req.params.id } })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    if (promocao.resultado) {
      throw new ErroDaApi(409, 'ja_sorteada',
        `Esta promoção já foi sorteada — o contemplado é ${promocao.resultado}.`)
    }

    const participacoes = await prisma.participacaoPromocao.findMany({
      where: { promocaoId: promocao.id },
      include: { ouvinte: { select: { id: true, nome: true, telefone: true } } },
    })

    if (participacoes.length === 0) {
      throw new ErroDaApi(422, 'sem_inscritos',
        'Ninguém se inscreveu nesta promoção. Não há quem sortear.')
    }

    const escolhida = participacoes[Math.floor(Math.random() * participacoes.length)]!
    const nome = escolhida.ouvinte.nome?.trim() || 'Ouvinte'

    await prisma.$transaction([
      prisma.participacaoPromocao.update({
        where: { id: escolhida.id },
        data: { vencedor: true },
      }),
      prisma.promocao.update({
        where: { id: promocao.id },
        data: { resultado: nome, fimEm: new Date() },
      }),
    ])
    await recalcular(req.emissora!)

    // O telefone volta só aqui, para o Studio: é como a produção chama a pessoa depois
    // do ar. No aplicativo ele nunca aparece — ver `paraTela` nas rotas do ouvinte.
    res.json({
      vencedor: {
        nome,
        telefone: escolhida.ouvinte.telefone,
        inscritoEm: escolhida.participouEm.toISOString(),
      },
      concorreram: participacoes.length,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Apagar — só o que ninguém tocou.
 *
 * Promoção com inscrito não se apaga: aquilo é registro de gente que participou, e
 * sumir com ele é o tipo de coisa que a emissora vai precisar provar depois. Para tirar
 * do ar existe o Encerrar.
 *
 * Já a promoção criada errada — título trocado, publicada por engano, teste — não
 * merece ficar no histórico para sempre. Com zero inscritos não há o que perder.
 */
rotasPromocoesStudio.delete('/promocoes/:id', exigirOperador(), async (req, res, next) => {
  try {
    const promocao = await prisma.promocao.findFirst({
      where: { id: req.params.id },
      include: { _count: { select: { participacoes: true } } },
    })
    if (!promocao) throw erros.naoEncontrado('Promoção')

    if (promocao._count.participacoes > 0) {
      throw new ErroDaApi(409, 'tem_inscritos',
        `${promocao._count.participacoes} pessoa(s) já se inscreveram — esta promoção não pode ser apagada. Use Encerrar.`)
    }

    await prisma.promocao.delete({ where: { id: promocao.id } })
    await recalcular(req.emissora!)
    res.json({ apagada: true })
  } catch (e) {
    next(e)
  }
})

const ORDEM = { no_ar: 0, preparada: 1, agendada: 2, encerrada: 3, sorteada: 4 } as const
function ordem(estado: keyof typeof ORDEM) {
  return ORDEM[estado]
}
