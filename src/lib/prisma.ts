import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import { env, ehDesenvolvimento } from './env.js'
import { log } from './log.js'
import { MODELOS_ESCOPADOS } from './modelos-escopados.js'

/**
 * ISOLAMENTO POR EMISSORA
 *
 * A regra do produto é dura: nenhuma consulta cruza tenants. Nunca.
 *
 * Confiar em cada desenvolvedor lembrar de escrever `where: { emissoraId }` é o caminho
 * mais curto para um vazamento entre rádios. Então o escopo é aplicado aqui, uma vez,
 * para todas as consultas de todos os modelos que pertencem a uma emissora.
 *
 * O `emissoraId` viaja pelo contexto assíncrono da requisição — quem chama o Prisma não
 * precisa saber que isso existe.
 *
 * NOTA SOBRE `create`: os tipos gerados pelo Prisma exigem `emissoraId` em tempo de
 * compilação, então nas criações ele é escrito à mão. Isso não enfraquece o isolamento:
 * a extensão sobrescreve o valor com o do contexto, de modo que um id errado nunca chega
 * ao banco. Leituras, atualizações e exclusões continuam escopadas sozinhas.
 */

type ContextoEmissora = { emissoraId: string }

const contexto = new AsyncLocalStorage<ContextoEmissora>()

/** Roda `fn` com todas as consultas presas a esta emissora. */
export function comEmissora<T>(emissoraId: string, fn: () => Promise<T>): Promise<T> {
  return contexto.run({ emissoraId }, fn)
}

/** A emissora do contexto atual, ou `null` fora de uma requisição de tenant. */
export function emissoraAtual(): string | null {
  return contexto.getStore()?.emissoraId ?? null
}

const base = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: ehDesenvolvimento ? ['warn', 'error'] : ['error'],
})

export const prisma = base.$extends({
  name: 'escopo-por-emissora',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!MODELOS_ESCOPADOS.has(model)) return query(args)

        const emissoraId = emissoraAtual()
        if (!emissoraId) {
          // Falhar alto é melhor que devolver dado de todas as rádios. Se algum trabalho
          // de fundo precisa varrer várias emissoras, ele usa `prismaSemEscopo` e assume
          // a responsabilidade explicitamente.
          throw new Error(
            `Consulta em ${model}.${operation} sem emissora no contexto. ` +
              `Envolva a chamada em comEmissora(), ou use prismaSemEscopo() se for ` +
              `mesmo uma rotina que atravessa tenants.`,
          )
        }

        const a = (args ?? {}) as Record<string, any>

        switch (operation) {
          // `findUnique` só aceita campos únicos no `where`, então vira `findFirst`
          // para conseguir somar o filtro da emissora.
          case 'findUnique':
            return (query as any)({ ...a, where: { ...a.where, emissoraId } }, 'findFirst')

          case 'findFirst':
          case 'findFirstOrThrow':
          case 'findMany':
          case 'count':
          case 'aggregate':
          case 'groupBy':
          case 'updateMany':
          case 'deleteMany':
          case 'update':
          case 'delete':
            return query({ ...a, where: { ...a.where, emissoraId } })

          case 'findUniqueOrThrow':
            return (query as any)({ ...a, where: { ...a.where, emissoraId } }, 'findFirstOrThrow')

          case 'create':
            return query({ ...a, data: { ...a.data, emissoraId } })

          case 'createMany':
            return query({
              ...a,
              data: Array.isArray(a.data)
                ? a.data.map((d: any) => ({ ...d, emissoraId }))
                : { ...a.data, emissoraId },
            })

          case 'upsert':
            return query({
              ...a,
              where: { ...a.where, emissoraId },
              create: { ...a.create, emissoraId },
            })

          default:
            return query(args)
        }
      },
    },
  },
})

/**
 * Acesso sem escopo. Use apenas para o que é genuinamente da plataforma: resolver o
 * tenant a partir do domínio, rotinas de manutenção, migrações de dados.
 *
 * Toda chamada aqui é uma decisão consciente de atravessar a fronteira entre emissoras.
 */
export const prismaSemEscopo = base

export async function conectarBanco(): Promise<void> {
  await base.$connect()
  log.info('banco conectado')
}

export async function desconectarBanco(): Promise<void> {
  await base.$disconnect()
}
