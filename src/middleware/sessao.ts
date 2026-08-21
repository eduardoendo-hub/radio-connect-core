import type { NextFunction, Request, Response } from 'express'
import { verificar, type Sessao } from '../lib/token.js'
import { erros } from '../lib/erros.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessao?: Sessao
    }
  }
}

async function ler(req: Request): Promise<Sessao | null> {
  const cabecalho = req.headers.authorization
  if (!cabecalho?.startsWith('Bearer ')) return null
  return verificar(cabecalho.slice(7))
}

/**
 * Exige ouvinte autenticado.
 *
 * O cadastro é obrigatório desde a entrada (DP-31): a base cadastrada é o ativo que a
 * emissora nunca teve enquanto o relacionamento morava no WhatsApp. Sem identidade
 * também não existe unicidade de voto nem Índice de Conexão.
 */
export function exigirOuvinte() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = await ler(req)
    if (!s || s.tipo !== 'ouvinte') return next(erros.naoAutenticado())
    // Um token emitido para outra emissora não vale aqui. Cada app é um mundo fechado.
    if (s.emissoraId !== req.emissora?.id) return next(erros.naoAutenticado())
    req.sessao = s
    next()
  }
}

/** Exige operador do Studio, opcionalmente com um dos papéis informados. */
/**
 * Exige uma sessão da TechNow.
 *
 * Token de operador de emissora não serve aqui, e token de plataforma não serve nas
 * rotas da emissora — são universos separados desde a assinatura. É por isso que a área
 * comercial não é "uma tela escondida": é uma porta diferente.
 */
export function exigirPlataforma() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const s = req.sessao
    if (!s || s.tipo !== 'plataforma') return next(erros.naoAutenticado())
    next()
  }
}

export function exigirOperador(...papeis: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = await ler(req)
    if (!s || s.tipo !== 'operador') return next(erros.naoAutenticado())
    if (s.emissoraId !== req.emissora?.id) return next(erros.naoAutenticado())
    if (papeis.length && !papeis.includes(s.papel) && s.papel !== 'ADMIN') {
      return next(erros.semPermissao())
    }
    req.sessao = s
    next()
  }
}
