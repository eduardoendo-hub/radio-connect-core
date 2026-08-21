import type { NextFunction, Request, Response } from 'express'
import { verificar, type Sessao } from '../lib/token.js'
import { erros } from '../lib/erros.js'
import { registrarPresenca } from '../modules/ouvintes/presenca.js'

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
    // Apareceu hoje. Registrar aqui, e não em cada rota, é o que garante que qualquer
    // uso do aplicativo conte como presença — inclusive a consulta do No Ar, que é a
    // única coisa que quem só escuta chega a fazer. Não espera e não falha: presença é
    // telemetria, e telemetria que atrapalha a tela é pior que telemetria que falta.
    registrarPresenca(s.emissoraId, s.ouvinteId)
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
 *
 * Lê o token aqui dentro, como os outros dois guardas. A primeira versão consultava
 * `req.sessao` — que só existe depois que outro guarda o preenche, e nenhum roda antes
 * destas rotas. O efeito era toda a área da TechNow respondendo 401, com o login
 * funcionando (não tem guarda) e nada mais.
 */
export function exigirPlataforma() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = await ler(req)
    if (!s || s.tipo !== 'plataforma') return next(erros.naoAutenticado())
    req.sessao = s
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
