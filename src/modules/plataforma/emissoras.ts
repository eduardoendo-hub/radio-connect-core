import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prismaSemEscopo, comEmissora, prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirPlataforma } from '../../middleware/sessao.js'

export const rotasPlataformaEmissoras = Router()

/**
 * Criar rádio e dar a chave para quem vai operá-la.
 *
 * Até aqui, subir uma emissora era rodar um script com o nome da Band FM escrito
 * dentro. Com outras rádios entrando, isso deixaria de ser dívida e viraria processo —
 * e processo que depende de mim é processo que trava numa sexta à noite.
 *
 * **A TechNow cria a rádio e o primeiro administrador. O resto do time é com ela.**
 * Fazer todo usuário passar por nós pareceria mais controle e seria menos: quando
 * adicionar gente é burocrático, aparece login compartilhado — e aí não se sabe mais
 * quem publicou o quê. O admin da emissora administra o time da emissora dele, e nós
 * enxergamos todos para dar suporte.
 */

const TEMA_PADRAO = {
  primaria: '#F6821F',
  fundo: '#0B0B0C',
  superficie: '#151517',
  aoVivo: '#E0342A',
  pulso: 'forte',
}

const CONFIGURACAO_PADRAO = {
  modulos: { chat: true, promocoes: true, indiceConexao: true, publicidade: true },
  anuncios: {
    bannerNoAr: true,
    bannerChatACadaMensagens: 12,
    prerollMinutosEntre: 30,
    maxImpressoesPorSessao: 6,
  },
  momento: { duracaoPadraoSegundos: 180 },
}

const CONTEUDO_PADRAO = {
  saudacaoManha: 'Bom dia!',
  rotuloConexao: 'Sua conexão com a rádio',
  vivendoMomento: 'ouvintes vivendo este momento',
}

rotasPlataformaEmissoras.get('/emissoras-detalhe', exigirPlataforma(), async (_req, res, next) => {
  try {
    const emissoras = await prismaSemEscopo.emissora.findMany({
      orderBy: { nome: 'asc' },
      select: {
        id: true, slug: true, nome: true, streamUrl: true, criadaEm: true,
        _count: { select: { operadores: true, ouvintes: true, programas: true } },
      },
    })
    res.json({
      emissoras: emissoras.map((e) => ({
        id: e.id,
        slug: e.slug,
        nome: e.nome,
        streamUrl: e.streamUrl,
        criadaEm: e.criadaEm.toISOString(),
        operadores: e._count.operadores,
        ouvintes: e._count.ouvintes,
        programas: e._count.programas,
      })),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Nasce uma rádio.
 *
 * O `slug` é permanente: ele vira o `X-Tenant` de toda chamada e entra na compilação do
 * aplicativo daquela emissora. Trocar depois quebraria os aplicativos já instalados, e
 * por isso ele é validado com rigor aqui e não pode ser editado adiante.
 *
 * A rádio nasce com um administrador, na mesma transação. Emissora sem ninguém que
 * consiga entrar é um registro morto que alguém vai ter que consertar à mão depois.
 */
rotasPlataformaEmissoras.post('/emissoras', exigirPlataforma(), async (req, res, next) => {
  try {
    const d = z
      .object({
        nome: z.string().trim().min(2, 'Escreva o nome da rádio.').max(80),
        slug: z
          .string()
          .trim()
          .toLowerCase()
          .min(3, 'O identificador tem pelo menos 3 letras.')
          .max(30)
          .regex(/^[a-z0-9-]+$/, 'Use só letras minúsculas, números e hífen.'),
        streamUrl: z.string().trim().max(500).optional(),
        admin: z.object({
          nome: z.string().trim().min(2).max(80),
          email: z.string().trim().toLowerCase().email('Confira o e-mail do administrador.'),
          senha: z.string().min(6, 'A senha do administrador tem pelo menos 6 caracteres.'),
        }),
      })
      .parse(req.body)

    const jaExiste = await prismaSemEscopo.emissora.findFirst({ where: { slug: d.slug } })
    if (jaExiste) {
      throw new ErroDaApi(409, 'slug_em_uso',
        `Já existe uma rádio com o identificador "${d.slug}".`)
    }

    const senhaHash = await bcrypt.hash(d.admin.senha, 10)

    const emissora = await prismaSemEscopo.$transaction(async (tx) => {
      const nova = await tx.emissora.create({
        data: {
          slug: d.slug,
          nome: d.nome,
          streamUrl: d.streamUrl || null,
          tema: TEMA_PADRAO,
          configuracao: CONFIGURACAO_PADRAO,
          conteudo: CONTEUDO_PADRAO,
        },
      })
      await tx.operador.create({
        data: {
          emissoraId: nova.id,
          nome: d.admin.nome,
          email: d.admin.email,
          senhaHash,
          papel: 'ADMIN',
        },
      })
      return nova
    })

    res.status(201).json({
      emissora: { id: emissora.id, slug: emissora.slug, nome: emissora.nome },
    })
  } catch (e) {
    next(e)
  }
})

/** Quem opera cada rádio. Existe para suporte: "não consigo entrar". */
rotasPlataformaEmissoras.get('/emissoras/:emissoraId/operadores', exigirPlataforma(), async (req, res, next) => {
  try {
    const emissoraId = req.params.emissoraId!
    const operadores = await comEmissora(emissoraId, () =>
      prisma.operador.findMany({
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, email: true, papel: true, ativo: true, ultimoLogin: true },
      }),
    )
    res.json({
      operadores: operadores.map((o) => ({
        ...o,
        ultimoLogin: o.ultimoLogin?.toISOString() ?? null,
      })),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * A própria senha de quem é da TechNow.
 *
 * Existe desde o primeiro dia porque a primeira conta nasce com uma senha combinada por
 * fora — e senha combinada por fora precisa de um caminho para deixar de existir.
 */
rotasPlataformaEmissoras.post('/senha', exigirPlataforma(), async (req, res, next) => {
  try {
    const d = z
      .object({
        atual: z.string().min(1, 'Digite a senha atual.'),
        nova: z.string().min(8, 'A nova senha tem pelo menos 8 caracteres.'),
      })
      .parse(req.body)
    const s = req.sessao as { operadorId: string }

    const op = await prismaSemEscopo.operadorPlataforma.findFirst({ where: { id: s.operadorId } })
    if (!op) throw erros.naoEncontrado('Operador')

    if (!(await bcrypt.compare(d.atual, op.senhaHash))) {
      throw new ErroDaApi(401, 'senha_incorreta', 'A senha atual não confere.')
    }

    await prismaSemEscopo.operadorPlataforma.update({
      where: { id: op.id },
      data: { senhaHash: await bcrypt.hash(d.nova, 10) },
    })
    res.json({ trocada: true })
  } catch (e) {
    next(e)
  }
})
