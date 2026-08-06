import type { NextFunction, Request, Response } from 'express'
import { comEmissora, prismaSemEscopo } from '../lib/prisma.js'
import { erros } from '../lib/erros.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      emissora?: { id: string; slug: string; nome: string; configuracao: unknown }
      appVersao?: string
      plataforma?: string
    }
  }
}

/**
 * Cache do par slug → emissora.
 *
 * Resolver o tenant é a primeira coisa que acontece em TODA requisição — inclusive nas
 * de telemetria, que chegam em lote. Ir ao banco toda vez seria a consulta mais frequente
 * do sistema, para um dado que muda quase nunca.
 */
const cache = new Map<string, { valor: NonNullable<Request['emissora']>; expiraEm: number }>()
const TTL_MS = 60_000

async function resolver(slug: string) {
  const agora = Date.now()
  const emCache = cache.get(slug)
  if (emCache && emCache.expiraEm > agora) return emCache.valor

  // Sem escopo de propósito: é justamente aqui que descobrimos qual é o escopo.
  const e = await prismaSemEscopo.emissora.findFirst({
    where: { slug, ativa: true },
    select: { id: true, slug: true, nome: true, configuracao: true },
  })
  if (!e) return null

  cache.set(slug, { valor: e, expiraEm: agora + TTL_MS })
  return e
}

/** Descarta o cache de uma emissora — usar quando o Studio alterar a configuração. */
export function invalidarCacheEmissora(slug: string): void {
  cache.delete(slug)
}

/**
 * Descobre a emissora e prende toda a requisição ao escopo dela.
 *
 * Duas formas, nessa ordem:
 *   1. cabeçalho `X-Tenant` — como o app manda
 *   2. subdomínio — como o Studio vai mandar quando cada rádio tiver o seu
 */
export function exigirEmissora() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const doCabecalho = String(req.headers['x-tenant'] ?? '').trim().toLowerCase()
      const doHost = String(req.hostname ?? '').split('.')[0]?.toLowerCase() ?? ''
      const slug = doCabecalho || (doHost && !['api', 'studio', 'localhost'].includes(doHost) ? doHost : '')

      if (!slug) return next(erros.emissoraNaoEncontrada())

      const emissora = await resolver(slug)
      if (!emissora) return next(erros.emissoraNaoEncontrada())

      req.emissora = emissora
      // O app se identifica em toda requisição. É o que permite medir a distribuição
      // real de versões em campo — e decidir com dado, não com achismo, quando é seguro
      // aposentar uma versão de API que alguma rádio nunca atualizou.
      req.appVersao = String(req.headers['x-app-version'] ?? '') || undefined
      req.plataforma = String(req.headers['x-platform'] ?? '') || undefined

      // A partir daqui, nenhuma consulta consegue ver outra emissora.
      comEmissora(emissora.id, async () => next()).catch(next)
    } catch (e) {
      next(e)
    }
  }
}
