import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diaLocal } from './tempo.js'

/**
 * O dia é o da rádio, não o do UTC.
 *
 * Quem ouve às onze da noite em São Paulo está no mesmo dia de quem ouviu de manhã — e
 * em UTC já é amanhã. Sem isto, uma noite de segunda contaria como terça, e "voltou em
 * quatro dias desta semana" viraria ficção com aparência de dado. É a terceira vez que
 * fuso horário morde este produto; por isso tem teste.
 */
test('onze da noite em São Paulo ainda é o mesmo dia', () => {
  // 2026-08-22T02:00:00Z é 21/08 às 23h em São Paulo (UTC-3).
  assert.equal(diaLocal(new Date('2026-08-22T02:00:00Z')), '2026-08-21')
})

test('a virada do dia acompanha o fuso da rádio', () => {
  // 03:30Z é 00:30 do dia seguinte em São Paulo — aí sim virou.
  assert.equal(diaLocal(new Date('2026-08-22T03:30:00Z')), '2026-08-22')
})

test('meio-dia é o dia que parece', () => {
  assert.equal(diaLocal(new Date('2026-08-21T15:00:00Z')), '2026-08-21')
})
