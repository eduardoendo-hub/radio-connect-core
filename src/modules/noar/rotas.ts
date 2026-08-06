import { Router } from 'express'
import { obter, marcarPresenca } from './servico.js'
import { chaves, redisSub } from '../../lib/redis.js'
import { exigirOuvinte } from '../../middleware/sessao.js'
import { comEmissora } from '../../lib/prisma.js'
import { log } from '../../lib/log.js'

export const rotasNoAr = Router()

/**
 * O estado atual da emissora.
 *
 * Responde com ETag: se nada mudou desde a última vez, o app recebe 304 e não transfere
 * nada. Em rede móvel ruim, a maioria das consultas não custa byte nenhum de corpo.
 */
rotasNoAr.get('/', exigirOuvinte(), async (req, res, next) => {
  try {
    const emissora = req.emissora!
    const s = req.sessao as { ouvinteId: string }

    void marcarPresenca(emissora.id, s.ouvinteId).catch(() => {})

    const estado = await obter(emissora)
    const etag = `W/"${estado.versao}"`

    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'no-cache')
    res.json(estado)
  } catch (e) {
    next(e)
  }
})

/**
 * Fluxo de mudanças por SSE.
 *
 * Escolhido em vez de WebSocket porque um app de rádio fica horas aberto tocando áudio,
 * e aqui o tráfego é quase todo numa direção só: o servidor avisa, o cliente escuta.
 * SSE faz isso com uma fração do custo, reconecta sozinho e atravessa proxy sem drama.
 */
rotasNoAr.get('/stream', exigirOuvinte(), async (req, res) => {
  const emissora = req.emissora!
  const s = req.sessao as { ouvinteId: string }
  const canal = chaves.canalNoAr(emissora.id)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const enviar = (evento: string, dado: unknown) => {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`)
  }

  // Estado inicial: quem conecta já recebe a foto do momento, sem precisar de outra
  // requisição.
  try {
    const estado = await comEmissora(emissora.id, () => obter(emissora))
    enviar('noar', estado)
  } catch (e) {
    log.error({ err: e }, 'falha ao enviar estado inicial do SSE')
  }

  const aoReceber = (c: string, mensagem: string) => {
    if (c !== canal) return
    res.write(`event: noar\ndata: ${mensagem}\n\n`)
  }

  await redisSub.subscribe(canal).catch((e) => log.error({ err: e }, 'falha ao assinar canal'))
  redisSub.on('message', aoReceber)

  // Mantém a conexão viva e serve de heartbeat de presença: enquanto o app estiver
  // aberto, o ouvinte conta como "vivendo este momento".
  const pulso = setInterval(() => {
    res.write(': pulso\n\n')
    void marcarPresenca(emissora.id, s.ouvinteId).catch(() => {})
  }, 25_000)

  req.on('close', () => {
    clearInterval(pulso)
    redisSub.off('message', aoReceber)
    void redisSub.unsubscribe(canal).catch(() => {})
  })
})
