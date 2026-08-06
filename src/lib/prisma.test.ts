import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { MODELOS_ESCOPADOS } from './modelos-escopados.js'

/**
 * O teste mais importante deste repositório.
 *
 * O isolamento entre emissoras depende de uma lista escrita à mão. No dia em que alguém
 * criar um modelo novo com `emissoraId` e esquecer de incluí-lo nessa lista, as consultas
 * daquele modelo passam a enxergar TODAS as rádios — em silêncio, sem erro, sem log.
 *
 * Este teste torna esse esquecimento impossível: ele compara a lista com o que o schema
 * realmente declara, e quebra o build se as duas divergirem.
 */

const modelosComEmissoraId = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'emissoraId'))
    .map((m) => m.name),
)

test('todo modelo com emissoraId está na lista de escopo automático', () => {
  const faltando = [...modelosComEmissoraId].filter((m) => !MODELOS_ESCOPADOS.has(m)).sort()
  assert.deepEqual(
    faltando,
    [],
    `Estes modelos têm emissoraId mas NÃO são escopados automaticamente — ` +
      `consultas neles veriam dado de todas as rádios: ${faltando.join(', ')}`,
  )
})

test('a lista de escopo não contém modelo que não tem emissoraId', () => {
  const sobrando = [...MODELOS_ESCOPADOS].filter((m) => !modelosComEmissoraId.has(m)).sort()
  assert.deepEqual(
    sobrando,
    [],
    `Estes modelos estão na lista de escopo mas não têm emissoraId — ` +
      `toda consulta neles vai falhar: ${sobrando.join(', ')}`,
  )
})

test('a lista não está vazia', () => {
  // Protege contra o caso em que uma refatoração esvazia a lista e os dois testes
  // acima passam trivialmente.
  assert.ok(MODELOS_ESCOPADOS.size >= 15, 'a lista de modelos escopados encolheu demais')
})
