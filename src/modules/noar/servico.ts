import { prisma } from '../../lib/prisma.js'
import { redis, redisPub, chaves } from '../../lib/redis.js'
import { env } from '../../lib/env.js'

/**
 * ESTADO NO AR
 *
 * A leitura mais quente do sistema: todo mundo que abre o app pergunta a mesma coisa.
 *
 * O Postgres continua sendo a verdade; isto aqui é uma projeção materializada no Redis,
 * recalculada por evento e não por consulta. Uma leitura de cache por abertura de app,
 * em vez de meia dúzia de junções.
 *
 * A `versao` existe para o app saber se mudou alguma coisa sem baixar o estado inteiro.
 */

export type EstadoNoAr = {
  emissora: { slug: string; nome: string }
  aoVivo: boolean
  programa: { id: string; nome: string; imagemUrl: string | null; corDestaque: string | null } | null
  locutor: { id: string; nome: string; imagemUrl: string | null } | null
  /// Quem mais está no microfone. O titular vem em `locutor`; aqui vem a equipe
  /// inteira, na ordem em que a rádio escala — inclusive ele.
  equipe: { id: string; nome: string; imagemUrl: string | null }[]
  edicaoId: string | null
  termina: string | null
  momento: {
    id: string
    tipo: string
    titulo: string
    texto: string | null
    imagemUrl: string | null
    terminaEm: string
    opcoes: { id: string; rotulo: string; emoji: string | null }[]
    patrocinada: boolean
  } | null
  promocao: { id: string; titulo: string; imagemUrl: string | null } | null
  proxima: { nome: string; comeca: string } | null
  ouvintes: number
  versao: number
  calculadoEm: string
}

/** Monta o estado a partir do banco. Chamado só quando algo muda. */
export async function calcular(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const agora = new Date()

  const edicao = await prisma.edicao.findFirst({
    where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
    orderBy: { inicioEm: 'desc' },
    include: {
      programa: {
        select: {
          id: true, nome: true, imagemUrl: true, corDestaque: true,
          equipe: { select: { id: true, nome: true, imagemUrl: true } },
        },
      },
      locutor: { select: { id: true, nome: true, imagemUrl: true } },
    },
  })

  const momento = edicao
    ? await prisma.momento.findFirst({
        where: { edicaoId: edicao.id, estado: 'ATIVO', inicioEm: { lte: agora }, fimEm: { gte: agora } },
        orderBy: { inicioEm: 'desc' },
        include: { opcoes: { orderBy: { ordem: 'asc' }, select: { id: true, rotulo: true, emoji: true } } },
      })
    : null

  const promocao = await prisma.promocao.findFirst({
    where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
    orderBy: { inicioEm: 'desc' },
    select: { id: true, titulo: true, imagemUrl: true },
  })

  const proxima = await prisma.edicao.findFirst({
    where: { inicioEm: { gt: agora } },
    orderBy: { inicioEm: 'asc' },
    include: { programa: { select: { nome: true } } },
  })

  const ouvintes = await contarPresenca(emissora.id)
  const versao = Number(await redis.incr(chaves.noArVersao(emissora.id)))

  return {
    emissora: { slug: emissora.slug, nome: emissora.nome },
    aoVivo: Boolean(edicao),
    programa: edicao?.programa ?? null,
    locutor: edicao?.locutor ?? null,
    // O titular abre a lista: "A Hora do Ronco, com Tadeu, Emerson e Pedro Luiz" —
    // quem assina vem primeiro, sempre.
    equipe: edicao
      ? [
          ...(edicao.locutor ? [edicao.locutor] : []),
          ...(edicao.programa?.equipe ?? []).filter((p) => p.id !== edicao.locutorId),
        ]
      : [],
    edicaoId: edicao?.id ?? null,
    termina: edicao?.fimEm.toISOString() ?? null,
    momento: momento
      ? {
          id: momento.id,
          tipo: momento.tipo,
          titulo: momento.titulo,
          texto: momento.texto,
          imagemUrl: momento.imagemUrl,
          terminaEm: momento.fimEm.toISOString(),
          opcoes: momento.opcoes,
          patrocinada: Boolean(momento.campanhaPatrocinadoraId),
        }
      : null,
    promocao: promocao ?? null,
    proxima: proxima ? { nome: proxima.titulo ?? proxima.programa.nome, comeca: proxima.inicioEm.toISOString() } : null,
    ouvintes,
    versao,
    calculadoEm: agora.toISOString(),
  }
}

/** Recalcula, guarda no cache e avisa quem estiver ouvindo. */
export async function recalcular(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const estado = await calcular(emissora)
  await redis.set(chaves.noAr(emissora.id), JSON.stringify(estado), 'EX', 300)
  await redisPub.publish(chaves.canalNoAr(emissora.id), JSON.stringify(estado))
  return estado
}

/**
 * Lê do cache; se não houver, reconstrói.
 *
 * Se o Redis cair, isto continua funcionando pelo Postgres — mais lento, mas de pé.
 * É o que sustenta a promessa de degradação elegante do capítulo do No Ar.
 */
export async function obter(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const bruto = await redis.get(chaves.noAr(emissora.id)).catch(() => null)
  if (bruto) {
    try {
      const estado = JSON.parse(bruto) as EstadoNoAr
      // A contagem de ouvintes muda o tempo todo e não vale recalcular o estado inteiro.
      estado.ouvintes = await contarPresenca(emissora.id)
      return estado
    } catch {
      /* cache corrompido: recalcula */
    }
  }
  return recalcular(emissora)
}

/**
 * "15.432 ouvintes vivendo este momento."
 *
 * Contagem aproximada de propósito: precisa ser verossímil e estável, não exata. Um
 * número que oscila loucamente destrói a sensação de coletivo que o capítulo quer criar.
 */
export async function marcarPresenca(emissoraId: string, ouvinteId: string): Promise<void> {
  const chave = chaves.presenca(emissoraId)
  const agora = Date.now()
  await redis.zadd(chave, agora, ouvinteId)
  await redis.expire(chave, env.PRESENCA_TTL_SEGUNDOS * 4)
}

export async function contarPresenca(emissoraId: string): Promise<number> {
  const chave = chaves.presenca(emissoraId)
  const limite = Date.now() - env.PRESENCA_TTL_SEGUNDOS * 1000
  await redis.zremrangebyscore(chave, 0, limite).catch(() => 0)
  return redis.zcard(chave).catch(() => 0)
}
