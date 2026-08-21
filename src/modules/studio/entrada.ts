import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prismaSemEscopo } from '../../lib/prisma.js'
import { assinar } from '../../lib/token.js'
import { env } from '../../lib/env.js'
import { ErroDaApi } from '../../lib/erros.js'

export const rotasStudioEntrada = Router()

/**
 * A entrada do Studio, **sem emissora definida de antemão**.
 *
 * Antes o Studio sabia qual rádio era no momento da compilação — `NEXT_PUBLIC_TENANT`
 * era constante de build. Funcionava com uma emissora e cobrava caro na segunda: cada
 * rádio nova exigia um Studio inteiro, com deploy, domínio e variáveis próprios, e toda
 * correção virava três deploys.
 *
 * Agora quem descobre a rádio é o **e-mail de quem entra**. O servidor já escopa tudo
 * pelo `emissoraId` do token; o que faltava era o Studio parar de chumbar o tenant.
 *
 * O e-mail é único por emissora, e não globalmente — a mesma pessoa pode operar duas
 * rádios. Quando isso acontece, o servidor não escolhe por ela: devolve a lista e
 * pergunta. Escolher sozinho seria colocar alguém para operar o ao vivo da rádio errada.
 */
rotasStudioEntrada.post('/entrar', async (req, res, next) => {
  try {
    // `trim` antes de validar: copiar e-mail de uma mensagem quase sempre traz um espaço
    // junto, e o teclado do celular acrescenta um sozinho ao completar a palavra.
    const { email, senha, emissoraId } = z
      .object({
        email: z.string().trim().toLowerCase().email('Confira o e-mail: parece faltar algo.'),
        senha: z.string().trim().min(6, 'A senha tem pelo menos 6 caracteres.'),
        /// Só quando o mesmo e-mail opera mais de uma rádio.
        emissoraId: z.string().optional(),
      })
      .parse(req.body)

    const candidatos = await prismaSemEscopo.operador.findMany({
      where: { email, ativo: true, ...(emissoraId ? { emissoraId } : {}) },
      include: { emissora: { select: { id: true, slug: true, nome: true } } },
    })

    // A senha é conferida antes de contar quantas rádios existem. Sem isso, a resposta
    // "escolha a emissora" contaria a quem digitou um e-mail qualquer em quantas rádios
    // aquela pessoa trabalha — informação que não é de quem pergunta.
    const validos: typeof candidatos = []
    for (const c of candidatos) {
      if (await bcrypt.compare(senha, c.senhaHash)) validos.push(c)
    }

    if (validos.length === 0) {
      throw new ErroDaApi(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.')
    }

    if (validos.length > 1) {
      return res.status(300).json({
        escolhaEmissora: true,
        emissoras: validos.map((v) => ({
          id: v.emissora.id,
          slug: v.emissora.slug,
          nome: v.emissora.nome,
        })),
      })
    }

    const op = validos[0]!
    await prismaSemEscopo.operador.update({
      where: { id: op.id },
      data: { ultimoLogin: new Date() },
    })

    const token = await assinar(
      { tipo: 'operador', operadorId: op.id, emissoraId: op.emissora.id, papel: op.papel },
      env.JWT_OPERADOR_EXPIRA,
    )
    res.json({
      token,
      operador: { id: op.id, nome: op.nome, email: op.email, papel: op.papel },
      // O `slug` é o que o Studio passa a mandar em `X-Tenant` daqui em diante. Sai do
      // build e entra na sessão.
      emissora: { id: op.emissora.id, slug: op.emissora.slug, nome: op.emissora.nome },
    })
  } catch (e) {
    next(e)
  }
})
