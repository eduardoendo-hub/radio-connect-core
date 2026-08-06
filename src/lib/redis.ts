import Redis from 'ioredis'
import { env } from './env.js'
import { log } from './log.js'

/**
 * O Redis guarda três coisas, todas quentes e todas descartáveis:
 *
 *   · Estado No Ar — a projeção por emissora, lida a cada abertura de app
 *   · Presença — quem está "vivendo este momento" agora
 *   · Filas BullMQ — eventos e trabalhos de fundo
 *
 * Nada aqui é fonte de verdade. Se o Redis sumir, tudo se reconstrói do Postgres —
 * e é justamente isso que permite o app degradar com elegância em vez de cair.
 */

function criar(nome: string): Redis {
  const cliente = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // exigência do BullMQ
    // Nunca deixar a API travada esperando o Redis: o Estado No Ar tem plano B no banco.
    connectTimeout: 5_000,
    lazyConnect: false,
  })
  cliente.on('error', (e) => log.error({ err: e, cliente: nome }, 'erro no redis'))
  cliente.on('connect', () => log.info({ cliente: nome }, 'redis conectado'))
  return cliente
}

/** Conexão geral: cache, presença, contadores. */
export const redis = criar('geral')

/** Conexão dedicada às filas — o BullMQ exige a sua própria. */
export const redisFilas = criar('filas')

/** Publicação de eventos entre instâncias da API (mudança no Estado No Ar). */
export const redisPub = criar('pub')

/** Assinatura: uma conexão em modo subscriber não pode fazer mais nada. */
export const redisSub = criar('sub')

export const chaves = {
  noAr: (emissoraId: string) => `noar:${emissoraId}`,
  noArVersao: (emissoraId: string) => `noar:${emissoraId}:v`,
  presenca: (emissoraId: string) => `presenca:${emissoraId}`,
  votos: (momentoId: string) => `votos:${momentoId}`,
  canalNoAr: (emissoraId: string) => `canal:noar:${emissoraId}`,
  tetoAnuncio: (ouvinteId: string, posicao: string) => `ad:${ouvinteId}:${posicao}`,
} as const

export async function desconectarRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisFilas.quit(), redisPub.quit(), redisSub.quit()])
}
