import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { assinar } from '../../lib/token.js'
import { env, smsEmModoDemo } from '../../lib/env.js'
import { erros } from '../../lib/erros.js'
import { log } from '../../lib/log.js'
import { exigirOuvinte } from '../../middleware/sessao.js'

export const rotasAuth = Router()

/** Normaliza para só dígitos — o app pode mandar com máscara. */
function soDigitos(t: string) {
  return t.replace(/\D/g, '')
}

const pedirCodigo = z.object({
  telefone: z.string().min(10).max(20),
})

/**
 * O cadastro é a primeira barreira que o ouvinte encontra, então precisa ser o mais
 * curto que a tecnologia permite: telefone e um código. Nome, cidade e preferências
 * são pedidos depois, dentro da experiência.
 */
rotasAuth.post('/codigo', async (req, res, next) => {
  try {
    const { telefone } = pedirCodigo.parse(req.body)
    const numero = soDigitos(telefone)
    if (numero.length < 10) throw erros.dadosInvalidos([{ campo: 'telefone', problema: 'número incompleto' }])

    const chave = `otp:${req.emissora!.id}:${numero}`
    const tentativas = `otp:tent:${req.emissora!.id}:${numero}`

    const n = await redis.incr(tentativas)
    if (n === 1) await redis.expire(tentativas, 600)
    if (n > 5) throw erros.muitasTentativas()

    // Sem gateway configurado, o código é fixo e sai no log. É o modo da demonstração.
    const codigo = smsEmModoDemo ? '000000' : String(Math.floor(100000 + Math.random() * 900000))
    await redis.set(chave, codigo, 'EX', 300)

    if (smsEmModoDemo) {
      log.warn({ numero, codigo }, 'modo demonstração: código de verificação não enviado por SMS')
    }

    res.json({ enviado: true, modoDemo: smsEmModoDemo, expiraEmSegundos: 300 })
  } catch (e) {
    next(e)
  }
})

const entrar = z.object({
  telefone: z.string().min(10).max(20),
  codigo: z.string().length(6),
  nome: z.string().min(1).max(80).optional(),
})

rotasAuth.post('/entrar', async (req, res, next) => {
  try {
    const { telefone, codigo, nome } = entrar.parse(req.body)
    const numero = soDigitos(telefone)
    const chave = `otp:${req.emissora!.id}:${numero}`

    const esperado = await redis.get(chave)
    if (!esperado || esperado !== codigo) {
      throw new (await import('../../lib/erros.js')).ErroDaApi(
        401,
        'codigo_invalido',
        'Código incorreto ou expirado. Peça um novo.',
      )
    }
    await redis.del(chave)

    // O ouvinte pertence à emissora. A mesma pessoa em outra rádio é outro cadastro —
    // não somos agregador, e o isolamento vira estrutura em vez de disciplina.
    const ouvinte = await prisma.ouvinte.upsert({
      where: { emissoraId_telefone: { emissoraId: req.emissora!.id, telefone: numero } },
      create: {
        emissoraId: req.emissora!.id,
        telefone: numero,
        nome: nome ?? null,
        provedorAuth: 'telefone',
        ultimoAcesso: new Date(),
      },
      update: { ultimoAcesso: new Date(), ...(nome ? { nome } : {}) },
      select: { id: true, nome: true, cidade: true, avatarUrl: true },
    })

    const token = await assinar(
      { tipo: 'ouvinte', ouvinteId: ouvinte.id, emissoraId: req.emissora!.id },
      env.JWT_OUVINTE_EXPIRA,
    )

    res.json({ token, ouvinte })
  } catch (e) {
    next(e)
  }
})

/** Quem sou eu — o app chama no boot para saber se a sessão ainda vale. */
rotasAuth.get('/eu', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const ouvinte = await prisma.ouvinte.findFirst({
      where: { id: s.ouvinteId },
      select: { id: true, nome: true, cidade: true, avatarUrl: true, preferencias: true, criadoEm: true },
    })
    if (!ouvinte) throw erros.naoAutenticado()
    res.json({ ouvinte })
  } catch (e) {
    next(e)
  }
})
