import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * As migrações só podem tocar em tabelas que existem.
 *
 * Isto nasceu de um prejuízo real: uma migração escrita à mão dizia
 * `ALTER TABLE "Programa"` quando a tabela se chama `programas` — o schema usa `@@map`
 * e o nome do modelo não é o nome da tabela. Nada acusou. O TypeScript compilou, os
 * testes passaram, o build passou, a imagem subiu — e o container morreu no start,
 * porque é ali que `prisma migrate deploy` roda. A API ficou fora do ar até alguém
 * olhar.
 *
 * O erro é fácil de cometer sempre que não há banco local para o `migrate dev` gerar o
 * SQL. Então a checagem é textual mesmo, e roda no CI antes de qualquer deploy: mais
 * barato descobrir o nome errado aqui do que num container que não sobe.
 */

const RAIZ = join(import.meta.dirname, '../../prisma')

/** Os nomes de tabela que o schema declara — o que estiver fora disto não existe. */
function tabelasDoSchema(): Set<string> {
  const schema = readFileSync(join(RAIZ, 'schema.prisma'), 'utf8')
  const nomes = new Set<string>()
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) nomes.add(m[1])
  // Tabelas de relação N-N não têm modelo e portanto não têm `@@map`: o Prisma as
  // nomeia `_NomeDaRelacao`.
  for (const m of schema.matchAll(/@relation\("([^"]+)"\)/g)) nomes.add(`_${m[1]}`)
  return nomes
}

/** Toda tabela citada em ALTER/DROP — as que precisam já existir. */
function tabelasAlteradas(sql: string): string[] {
  return [...sql.matchAll(/(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)].map(
    (m) => m[1],
  )
}

test('nenhuma migração altera tabela que não existe no schema', () => {
  const conhecidas = tabelasDoSchema()
  const problemas: string[] = []

  for (const dir of readdirSync(join(RAIZ, 'migrations'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const sql = readFileSync(join(RAIZ, 'migrations', dir.name, 'migration.sql'), 'utf8')
    for (const tabela of tabelasAlteradas(sql)) {
      // Migração antiga pode mexer numa tabela que foi renomeada ou removida depois;
      // o `CREATE TABLE` dentro da própria série cobre esse caso.
      const criadaAntes = readdirSync(join(RAIZ, 'migrations'))
        .filter((d) => d <= dir.name)
        .some((d) => {
          try {
            return readFileSync(join(RAIZ, 'migrations', d, 'migration.sql'), 'utf8')
              .includes(`CREATE TABLE "${tabela}"`)
          } catch {
            return false
          }
        })
      if (!conhecidas.has(tabela) && !criadaAntes) {
        problemas.push(`${dir.name}: "${tabela}"`)
      }
    }
  }

  assert.deepEqual(
    problemas,
    [],
    `migração altera tabela inexistente (o nome vem do @@map, não do modelo):\n  ${problemas.join('\n  ')}`,
  )
})
