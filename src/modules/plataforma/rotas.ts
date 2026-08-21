import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prismaSemEscopo, comEmissora, prisma } from '../../lib/prisma.js'
import { assinar } from '../../lib/token.js'
import { env } from '../../lib/env.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirPlataforma } from '../../middleware/sessao.js'

export const rotasPlataforma = Router()

/**
 * A área da TechNow.
 *
 * Anunciante e campanha se cadastram **aqui e só aqui**. O motivo é comercial e não
 * técnico: banner, pré-roll e patrocínio só são entregues se a campanha existir no
 * banco, então concentrar o cadastro é o que garante que toda mídia digital vendida
 * passa pelo contrato — inclusive a que a emissora vende, que divide 70/30.
 *
 * A emissora continua **consumindo** as campanhas: o produtor escolhe o patrocinador ao
 * publicar um Momento ou uma promoção. O que ele não faz é criar o contrato.
 *
 * **Estas rotas ficam acima do `exigirEmissora()`**, porque a TechNow atravessa as
 * rádios. Em compensação, toda escrita entra num `comEmissora()` explícito: aqui é o
 * único lugar do produto que *escolhe* o tenant, e escolher tem que ser um ato visível
 * no código.
 */

rotasPlataforma.post('/entrar', async (req, res, next) => {
  try {
    const { email, senha } = z
      .object({
        email: z.string().trim().toLowerCase().email('Confira o e-mail.'),
        senha: z.string().trim().min(6, 'A senha tem pelo menos 6 caracteres.'),
      })
      .parse(req.body)

    const op = await prismaSemEscopo.operadorPlataforma.findFirst({ where: { email, ativo: true } })
    if (!op || !(await bcrypt.compare(senha, op.senhaHash))) {
      throw new ErroDaApi(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.')
    }

    await prismaSemEscopo.operadorPlataforma.update({
      where: { id: op.id },
      data: { ultimoLogin: new Date() },
    })

    const token = await assinar({ tipo: 'plataforma', operadorId: op.id }, env.JWT_OPERADOR_EXPIRA)
    res.json({ token, operador: { id: op.id, nome: op.nome, email: op.email } })
  } catch (e) {
    next(e)
  }
})

/** As rádios da plataforma. É por aqui que se escolhe para quem se está cadastrando. */
rotasPlataforma.get('/emissoras', exigirPlataforma(), async (_req, res, next) => {
  try {
    const emissoras = await prismaSemEscopo.emissora.findMany({
      orderBy: { nome: 'asc' },
      select: { id: true, slug: true, nome: true },
    })
    res.json({ emissoras })
  } catch (e) {
    next(e)
  }
})

/**
 * A carteira de uma rádio: anunciantes com as campanhas dentro.
 *
 * Numa lista só porque é assim que o comercial pensa — "o que a Soneda tem rodando na
 * Band" —, e não em duas telas que obrigam a cruzar de cabeça.
 */
rotasPlataforma.get('/emissoras/:emissoraId/carteira', exigirPlataforma(), async (req, res, next) => {
  try {
    const emissoraId = req.params.emissoraId!
    const anunciantes = await comEmissora(emissoraId, async () =>
      await prisma.anunciante.findMany({
        orderBy: { nome: 'asc' },
        include: {
          campanhas: {
            orderBy: { inicioEm: 'desc' },
            include: {
              criativos: { select: { id: true, tipo: true, url: true, posicoes: true } },
              _count: { select: { impressoes: true } },
            },
          },
        },
      }),
    )

    const agora = new Date()
    res.json({
      anunciantes: anunciantes.map((a) => ({
        id: a.id,
        nome: a.nome,
        contato: a.contato,
        campanhas: a.campanhas.map((c) => ({
          id: c.id,
          nome: c.nome,
          formato: c.formato,
          status: c.status,
          inicioEm: c.inicioEm.toISOString(),
          fimEm: c.fimEm.toISOString(),
          vendidoPor: c.vendidoPor,
          valorTotal: c.valorTotal?.toString() ?? null,
          criativos: c.criativos,
          impressoes: c._count.impressoes,
          vigente: c.status === 'ATIVA' && c.inicioEm <= agora && c.fimEm >= agora,
        })),
      })),
    })
  } catch (e) {
    next(e)
  }
})

rotasPlataforma.post('/emissoras/:emissoraId/anunciantes', exigirPlataforma(), async (req, res, next) => {
  try {
    const dados = z
      .object({
        nome: z.string().trim().min(2, 'Escreva o nome do anunciante.').max(80),
        contato: z.string().trim().max(120).optional(),
      })
      .parse(req.body)
    const emissoraId = req.params.emissoraId!

    const anunciante = await comEmissora(emissoraId, async () =>
      await prisma.anunciante.create({
        data: { emissoraId, nome: dados.nome, contato: dados.contato || null },
      }),
    )
    res.status(201).json({ anunciante })
  } catch (e) {
    next(e)
  }
})

/**
 * A campanha é o contrato.
 *
 * `vendidoPor` decide a divisão — RADIO é 70/30, TECHNOW é integral — e por isso é o
 * campo mais importante desta tela apesar de ser o menor. Errar aqui é errar o
 * fechamento do mês.
 */
const campanha = z.object({
  anuncianteId: z.string(),
  nome: z.string().trim().min(2).max(120),
  formato: z.enum([
    'banner', 'preroll', 'momento_patrocinado', 'promocao_patrocinada',
    'programa_patrocinado', 'chat_inline',
  ]),
  inicioEm: z.string(),
  fimEm: z.string(),
  vendidoPor: z.enum(['RADIO', 'TECHNOW']).default('TECHNOW'),
  valorTotal: z.number().nonnegative().optional(),
  /// O enum do banco já previa aprovação — `AGUARDANDO_APROVACAO`, `APROVADA`,
  /// `REJEITADA`. É o caminho para a emissora um dia solicitar e a TechNow aprovar sem
  /// que o comercial dela fique parado esperando e-mail. Enquanto essa tela não existe,
  /// quem cadastra aqui já cria como `ATIVA`.
  status: z
    .enum(['RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADA', 'ATIVA', 'ENCERRADA', 'REJEITADA'])
    .default('ATIVA'),
})

rotasPlataforma.post('/emissoras/:emissoraId/campanhas', exigirPlataforma(), async (req, res, next) => {
  try {
    const d = campanha.parse(req.body)
    const emissoraId = req.params.emissoraId!
    const inicioEm = new Date(d.inicioEm)
    const fimEm = new Date(d.fimEm)

    if (Number.isNaN(inicioEm.getTime()) || Number.isNaN(fimEm.getTime())) {
      throw erros.dadosInvalidos([{ campo: 'periodo', problema: 'data inválida' }])
    }
    // Campanha que termina antes de começar não é digitação inofensiva: ela nunca fica
    // vigente, o produtor não a encontra no seletor, e vem a pergunta de por que a mídia
    // vendida não está entrando.
    if (fimEm <= inicioEm) {
      throw new ErroDaApi(422, 'periodo_invalido', 'O fim da campanha precisa ser depois do início.')
    }

    const nova = await comEmissora(emissoraId, async () =>
      await prisma.campanha.create({
        data: {
          emissoraId,
          anuncianteId: d.anuncianteId,
          nome: d.nome,
          formato: d.formato,
          status: d.status,
          inicioEm,
          fimEm,
          vendidoPor: d.vendidoPor,
          valorTotal: d.valorTotal ?? null,
        },
      }),
    )
    res.status(201).json({ campanha: { ...nova, valorTotal: nova.valorTotal?.toString() ?? null } })
  } catch (e) {
    next(e)
  }
})

rotasPlataforma.patch('/emissoras/:emissoraId/campanhas/:id', exigirPlataforma(), async (req, res, next) => {
  try {
    const d = campanha.partial().parse(req.body)
    const { emissoraId, id } = req.params as { emissoraId: string; id: string }

    await comEmissora(emissoraId, async () => {
      const existe = await prisma.campanha.findFirst({ where: { id } })
      if (!existe) throw erros.naoEncontrado('Campanha')
      await prisma.campanha.update({
        where: { id },
        data: {
          nome: d.nome ?? undefined,
          formato: d.formato ?? undefined,
          status: d.status ?? undefined,
          vendidoPor: d.vendidoPor ?? undefined,
          valorTotal: d.valorTotal ?? undefined,
          ...(d.inicioEm ? { inicioEm: new Date(d.inicioEm) } : {}),
          ...(d.fimEm ? { fimEm: new Date(d.fimEm) } : {}),
        },
      })
    })
    res.json({ atualizada: true })
  } catch (e) {
    next(e)
  }
})

/**
 * O criativo — a peça que vai ao ar.
 *
 * `posicoes` vazio significa **"serve em qualquer posição"**, e não "em nenhuma". Já me
 * pegou: um logo de assinatura com posições vazias entraria na rotação de banner. Por
 * isso aqui é obrigatório escolher ao menos uma.
 */
rotasPlataforma.post('/emissoras/:emissoraId/campanhas/:id/criativos', exigirPlataforma(), async (req, res, next) => {
  try {
    const d = z
      .object({
        tipo: z.enum(['imagem', 'audio']),
        url: z.string().trim().min(1).max(500),
        clickUrl: z.string().trim().max(500).optional(),
        duracao: z.number().int().min(1).max(120).optional(),
        posicoes: z.array(z.string()).min(1, 'Escolha ao menos uma posição.'),
      })
      .parse(req.body)
    const { emissoraId, id } = req.params as { emissoraId: string; id: string }

    const criativo = await comEmissora(emissoraId, async () => {
      const alvo = await prisma.campanha.findFirst({ where: { id } })
      if (!alvo) throw erros.naoEncontrado('Campanha')
      return prisma.criativo.create({
        data: {
          campanhaId: id,
          tipo: d.tipo,
          url: d.url,
          clickUrl: d.clickUrl || null,
          duracao: d.duracao ?? null,
          posicoes: d.posicoes,
        },
      })
    })
    res.status(201).json({ criativo })
  } catch (e) {
    next(e)
  }
})

rotasPlataforma.delete('/emissoras/:emissoraId/criativos/:id', exigirPlataforma(), async (req, res, next) => {
  try {
    const { emissoraId, id } = req.params as { emissoraId: string; id: string }
    await comEmissora(emissoraId, async () => {
      const existe = await prisma.criativo.findFirst({ where: { id } })
      if (!existe) throw erros.naoEncontrado('Criativo')
      await prisma.criativo.delete({ where: { id } })
    })
    res.json({ apagado: true })
  } catch (e) {
    next(e)
  }
})
