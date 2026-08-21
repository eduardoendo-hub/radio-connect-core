import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erros } from './erros.js'

/**
 * A mensagem que a rádio mostra para o anunciante concorda em gênero.
 *
 * A terminação não decide: "Programa" termina em -a e é masculino, "Fofocômetro" termina
 * em -o e também. As duas palavras mais nossas são exatamente as que uma regra por
 * sufixo erraria — daí a lista à mão, e daí este teste, que quebra no dia em que alguém
 * criar uma entidade feminina e esquecer de incluí-la.
 */
test('concorda em gênero', () => {
  assert.match(erros.naoEncontrado('Campanha').message, /não encontrada/)
  assert.match(erros.naoEncontrado('Promoção').message, /não encontrada/)
  assert.match(erros.naoEncontrado('Edição').message, /não encontrada/)
  assert.match(erros.naoEncontrado('Programa').message, /não encontrado/)
  assert.match(erros.naoEncontrado('Fofocômetro').message, /não encontrado/)
  assert.match(erros.naoEncontrado().message, /Conteúdo não encontrado/)
})
