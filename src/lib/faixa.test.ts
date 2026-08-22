import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faixaDe } from './tempo.js'

/**
 * A faixa começa sempre em :00 ou :30.
 *
 * Toda a tela de Audiência depende disso: duas requisições no mesmo minuto precisam cair
 * na mesma linha, senão a contagem de pessoas distintas deixa de significar alguma coisa
 * — cada uma teria seu próprio conjunto no Redis e a mesma pessoa contaria várias vezes.
 */
test('a faixa é sempre a cheia ou a meia', () => {
  assert.equal(faixaDe(new Date(2026, 7, 22, 9, 14, 37, 500)).getMinutes(), 0)
  assert.equal(faixaDe(new Date(2026, 7, 22, 9, 29, 59, 999)).getMinutes(), 0)
  assert.equal(faixaDe(new Date(2026, 7, 22, 9, 30, 0, 0)).getMinutes(), 30)
  assert.equal(faixaDe(new Date(2026, 7, 22, 9, 59, 59, 0)).getMinutes(), 30)
})

test('segundos e milissegundos são zerados', () => {
  // Sem isto, cada requisição criaria a própria faixa: `new Date()` carrega
  // milissegundos, e duas chamadas no mesmo segundo nunca dariam o mesmo instante.
  const f = faixaDe(new Date(2026, 7, 22, 9, 14, 37, 812))
  assert.equal(f.getSeconds(), 0)
  assert.equal(f.getMilliseconds(), 0)
})

test('a mesma meia hora sempre dá a mesma faixa', () => {
  const a = faixaDe(new Date(2026, 7, 22, 18, 31, 2, 100))
  const b = faixaDe(new Date(2026, 7, 22, 18, 58, 44, 900))
  assert.equal(a.getTime(), b.getTime())
})

test('a hora não escorrega na virada', () => {
  const f = faixaDe(new Date(2026, 7, 22, 23, 47, 0))
  assert.equal(f.getHours(), 23)
  assert.equal(f.getMinutes(), 30)
  assert.equal(f.getDate(), 22)
})
