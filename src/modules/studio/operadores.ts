import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'

export const rotasOperadores = Router()

/**
 * O time da rádio, administrado pela rádio.
 *
 * A TechNow cria a emissora e o primeiro administrador; daí em diante quem entra e quem
 * sai é decisão de quem opera. Fazer cada usuário passar por nós pareceria mais controle
 * e seria menos: um produtor sai numa sexta e o acesso precisa cair na sexta. Quando
 * adicionar gente é burocrático, aparece login compartilhado — e aí ninguém sabe mais
 * quem publicou o quê.
 */

const PAPEIS = [
  'ADMIN', 'DIRETOR', 'PRODUTOR', 'PROGRAMACAO',
  'LOCUTOR', 'MARKETING', 'ATENDIMENTO', 'VISUALIZADOR',
] as const

rotasOperadores.get('/operadores', exigirOperador('ADMIN', 'DIRETOR'), async (_req, res, next) => {
  try {
    const operadores = await prisma.operador.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      select: { id: true, nome: true, email: true, papel: true, ativo: true, ultimoLogin: true, criadoEm: true },
    })
    res.json({
      operadores: operadores.map((o) => ({
        ...o,
        ultimoLogin: o.ultimoLogin?.toISOString() ?? null,
        criadoEm: o.criadoEm.toISOString(),
      })),
      papeis: PAPEIS,
    })
  } catch (e) {
    next(e)
  }
})

rotasOperadores.post('/operadores', exigirOperador('ADMIN'), async (req, res, next) => {
  try {
    const d = z
      .object({
        nome: z.string().trim().min(2, 'Escreva o nome.').max(80),
        email: z.string().trim().toLowerCase().email('Confira o e-mail.'),
        papel: z.enum(PAPEIS),
        // Senha inicial definida por quem cadastra, porque não há envio de e-mail ainda.
        // A pessoa troca no primeiro acesso — e a troca existe, ver `/senha`.
        senha: z.string().min(6, 'A senha inicial tem pelo menos 6 caracteres.'),
      })
      .parse(req.body)

    try {
      const novo = await prisma.operador.create({
        data: {
          emissoraId: req.emissora!.id,
          nome: d.nome,
          email: d.email,
          papel: d.papel,
          senhaHash: await bcrypt.hash(d.senha, 10),
        },
        select: { id: true, nome: true, email: true, papel: true, ativo: true },
      })
      res.status(201).json({ operador: novo })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroDaApi(409, 'email_em_uso', 'Já existe alguém com este e-mail nesta rádio.')
      }
      throw e
    }
  } catch (e) {
    next(e)
  }
})

rotasOperadores.patch('/operadores/:id', exigirOperador('ADMIN'), async (req, res, next) => {
  try {
    const d = z
      .object({
        nome: z.string().trim().min(2).max(80).optional(),
        papel: z.enum(PAPEIS).optional(),
        ativo: z.boolean().optional(),
        /// Redefinir a senha de outra pessoa: acontece quando alguém esquece.
        senha: z.string().min(6).optional(),
      })
      .parse(req.body)
    const id = req.params.id!
    const s = req.sessao as { operadorId: string }

    const alvo = await prisma.operador.findFirst({ where: { id } })
    if (!alvo) throw erros.naoEncontrado('Operador')

    // Desligar a si mesmo é o caminho mais curto para ficar de fora da própria rádio, e
    // acontece por engano de clique numa lista.
    if (id === s.operadorId && d.ativo === false) {
      throw new ErroDaApi(422, 'nao_pode_se_desativar',
        'Você não pode desativar o próprio acesso. Peça a outro administrador.')
    }

    // A rádio precisa continuar tendo dono. Tirar o último administrador deixa a
    // emissora sem quem gerencie ninguém — e aí só a TechNow desfaz.
    const perdeAdmin =
      alvo.papel === 'ADMIN' && (d.ativo === false || (d.papel && d.papel !== 'ADMIN'))
    if (perdeAdmin) {
      const outros = await prisma.operador.count({
        where: { papel: 'ADMIN', ativo: true, id: { not: id } },
      })
      if (outros === 0) {
        throw new ErroDaApi(422, 'ultimo_admin',
          'Esta é a única pessoa com acesso de administrador. Promova outra antes.')
      }
    }

    await prisma.operador.update({
      where: { id },
      data: {
        nome: d.nome ?? undefined,
        papel: d.papel ?? undefined,
        ativo: d.ativo ?? undefined,
        ...(d.senha ? { senhaHash: await bcrypt.hash(d.senha, 10) } : {}),
      },
    })
    res.json({ atualizado: true })
  } catch (e) {
    next(e)
  }
})

/**
 * A própria senha.
 *
 * Toda conta nasce com uma senha que outra pessoa escolheu — é assim que funciona sem
 * envio de e-mail. Sem este caminho, essa senha combinada por fora seria a senha para
 * sempre.
 */
rotasOperadores.post('/senha', exigirOperador(), async (req, res, next) => {
  try {
    const d = z
      .object({
        atual: z.string().min(1, 'Digite a senha atual.'),
        nova: z.string().min(8, 'A nova senha tem pelo menos 8 caracteres.'),
      })
      .parse(req.body)
    const s = req.sessao as { operadorId: string }

    const eu = await prisma.operador.findFirst({ where: { id: s.operadorId } })
    if (!eu) throw erros.naoEncontrado('Operador')
    if (!(await bcrypt.compare(d.atual, eu.senhaHash))) {
      throw new ErroDaApi(401, 'senha_incorreta', 'A senha atual não confere.')
    }

    await prisma.operador.update({
      where: { id: eu.id },
      data: { senhaHash: await bcrypt.hash(d.nova, 10) },
    })
    res.json({ trocada: true })
  } catch (e) {
    next(e)
  }
})
