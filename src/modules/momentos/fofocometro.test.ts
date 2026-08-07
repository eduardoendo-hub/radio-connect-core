import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { paraOOuvinte, jaRevelou, conferirAntesDePublicar } from './fofocometro.js'

/**
 * O Fofocômetro tem uma única regra que, se quebrar, mata o formato: **a revelação não
 * pode sair do servidor antes da hora**.
 *
 * Este teste existe porque a regra já foi quebrada uma vez. O `/no-ar` estava protegido
 * e a rota da revelação também, mas a listagem de Momentos devolvia o `config` cru — e
 * com ele a fofoca e a fonte, minutos antes da abertura. O erro não foi de lógica: foi
 * um `...m` espalhando tudo o que vinha do banco numa rota em que ninguém lembrou de
 * pensar no assunto.
 *
 * Testar a intenção ("não vaza") em vez da rota específica é o que faz este teste pegar
 * a próxima porta que alguém abrir sem querer.
 */

const REVELACAO = { texto: 'Foi com a Ana Castela.', imagemUrl: null }

function fofoca(revelarEm: Date) {
  return {
    tipo: 'FOFOCOMETRO',
    config: {
      revelarEm: revelarEm.toISOString(),
      revelacao: REVELACAO,
      fonte: 'assessoria',
    },
  }
}

describe('Fofocômetro: a revelação antes da hora', () => {
  test('não sai, nem como campo nulo', () => {
    const daquiCincoMinutos = new Date(Date.now() + 5 * 60_000)
    const visto = paraOOuvinte(fofoca(daquiCincoMinutos)) as Record<string, unknown>

    assert.equal(visto.revelado, false)
    assert.equal('revelacao' in visto, false, 'a chave não pode nem existir')

    // A prova que importa: o texto não aparece em lugar nenhum do que trafega.
    const serializado = JSON.stringify(visto)
    assert.equal(serializado.includes('Ana Castela'), false, 'a fofoca vazou')
    assert.equal(serializado.includes('assessoria'), false, 'a fonte vazou')
  })

  test('sai depois da hora — mas a fonte nunca', () => {
    const cincoMinutosAtras = new Date(Date.now() - 5 * 60_000)
    const visto = paraOOuvinte(fofoca(cincoMinutosAtras)) as Record<string, unknown>

    assert.equal(visto.revelado, true)
    assert.deepEqual(visto.revelacao, REVELACAO)
    // A fonte é rastro editorial: serve para a emissora responder de onde veio a
    // informação, não para publicar.
    assert.equal(JSON.stringify(visto).includes('assessoria'), false, 'a fonte vazou')
  })

  test('momento comum passa intacto', () => {
    const comum = { tipo: 'ESCOLHA', config: { qualquer: 'coisa' } }
    assert.deepEqual(paraOOuvinte(comum), { qualquer: 'coisa' })
  })

  test('config vazio ou quebrado não derruba nada', () => {
    assert.equal(jaRevelou(null), false)
    assert.equal(jaRevelou({}), false)
    assert.equal(jaRevelou({ revelarEm: 'não é data' }), false)
  })
})

describe('Fofocômetro: o que impede o furo', () => {
  test('sem revelação escrita, não publica', () => {
    const problemas = conferirAntesDePublicar({
      revelarEm: new Date(Date.now() + 300_000).toISOString(),
    })
    assert.ok(problemas.some((p) => p.includes('revelação')))
  })

  test('revelação instantânea não é Fofocômetro', () => {
    // Sem espera não há formato: o gancho e a revelação apareceriam juntos.
    const problemas = conferirAntesDePublicar({
      revelarEm: new Date(Date.now() + 5_000).toISOString(),
      revelacao: REVELACAO,
    })
    assert.ok(problemas.some((p) => p.includes('30 segundos')))
  })

  test('espera longa demais também não', () => {
    const problemas = conferirAntesDePublicar({
      revelarEm: new Date(Date.now() + 5 * 60 * 60_000).toISOString(),
      revelacao: REVELACAO,
    })
    assert.ok(problemas.some((p) => p.includes('2 horas')))
  })

  test('gancho completo passa', () => {
    const problemas = conferirAntesDePublicar({
      revelarEm: new Date(Date.now() + 300_000).toISOString(),
      revelacao: REVELACAO,
    })
    assert.deepEqual(problemas, [])
  })
})
