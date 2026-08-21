import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGUA_DA_BAND } from './regua-band.js'
import { conferirRegua, nivelDe, type Componentes } from '../modules/ouvintes/conexao.js'

/**
 * A escada da Band FM precisa passar no mesmo crivo da escada editada à mão.
 *
 * O seed escreve a régua **direto no banco**, sem passar por rota nenhuma. Sem este teste,
 * uma rádio poderia nascer com uma escada que o próprio Studio se recusaria a salvar — e
 * o defeito só apareceria no dia em que alguém abrisse a tela para mudar um número.
 */
test('a escada da Band é válida pelas regras do Studio', () => {
  assert.equal(conferirRegua(REGUA_DA_BAND), null)
})

const zerado: Componentes = {
  diasNaSemana: 0, diasNoMes: 0, minutosNaSemana: 0,
  momentosNoMes: 0, promocoes: 0, conversou: false, diasDeCasa: 0,
}
const com = (p: Partial<Componentes>): Componentes => ({ ...zerado, ...p })
const onde = (c: Componentes) => REGUA_DA_BAND[nivelDe(c, REGUA_DA_BAND)]!.rotulo

test('quem instalou agora está Sintonizando', () => {
  assert.equal(onde(zerado), 'Sintonizando')
})

test('duas aberturas na semana já colocam a pessoa Na escuta', () => {
  // O degrau da maioria precisa ser fácil: o capítulo do Índice proíbe punir quem prefere
  // a experiência passiva, e numa FM popular a maioria só ouve.
  assert.equal(onde(com({ diasNaSemana: 2 })), 'Na escuta')
})

test('quem ouve pelo rádio do carro e vota pelo telefone sobe igual', () => {
  // **A decisão mais importante desta régua.** A Band toca no carro e na cozinha; quem
  // ouve assim não tem minuto nenhum registrado no aplicativo. Se minutos fossem
  // condição, o ouvinte mais tradicional da rádio ficaria preso embaixo.
  const semNenhumMinuto = com({ diasNaSemana: 5, momentosNoMes: 6, diasDeCasa: 90 })
  assert.equal(semNenhumMinuto.minutosNaSemana, 0)
  assert.equal(onde(semNenhumMinuto), 'Time da Band')
})

test('uma participação basta para Chega junto', () => {
  assert.equal(onde(com({ momentosNoMes: 1 })), 'Chega junto')
  assert.equal(onde(com({ promocoes: 1 })), 'Chega junto')
})

test('Família Band não se alcança na primeira semana', () => {
  const intenso = com({ diasNaSemana: 7, diasNoMes: 7, momentosNoMes: 30, diasDeCasa: 7 })
  assert.equal(onde(intenso), 'Time da Band')
})

test('quem é da Família Band pode viajar uma semana sem cair', () => {
  // O topo não pede presença **nesta** semana de propósito. "Um usuário antigo que
  // retorna não deve recomeçar do zero."
  const viajou = com({ diasNaSemana: 0, diasNoMes: 15, momentosNoMes: 12, diasDeCasa: 60 })
  assert.equal(onde(viajou), 'Família Band')
})

test('nem os nomes nem as frases flexionam em gênero', () => {
  // A audiência da Band é majoritariamente feminina. "Ouvinte conectado" deixaria metade
  // do público de fora, e é o tipo de coisa que ninguém percebe até estar na tela.
  //
  // A lista inclui `bem-vindo` porque essa é a armadilha mais comum em texto de
  // boas-vindas — e porque ela já tinha escapado uma vez, na tela Sua Rádio.
  const FLEXIONA = /\b(bem-vindo|obrigado|\w+(ado|ido|oso|eiro))\b/i
  for (const d of REGUA_DA_BAND) {
    assert.doesNotMatch(d.rotulo, FLEXIONA, `nome "${d.rotulo}" flexiona`)
    assert.doesNotMatch(d.frase ?? '', FLEXIONA, `frase de "${d.rotulo}" flexiona`)
  }
})

test('toda frase cabe no telefone', () => {
  // Duas linhas no cartão da conexão. Acima disso a frase vira parágrafo, o cartão estica
  // e a escada some abaixo da dobra — a pessoa deixa de ver para onde a coisa vai.
  for (const d of REGUA_DA_BAND) {
    assert.ok(d.frase, `"${d.rotulo}" ficou sem frase`)
    assert.ok(d.frase!.length <= 62, `frase de "${d.rotulo}" tem ${d.frase!.length} caracteres`)
  }
})

test('os nomes cabem na escada do aplicativo', () => {
  // A escada desenha os cinco degraus numa coluna estreita de telefone. Acima de dezoito
  // caracteres o nome quebra em duas linhas e a escada perde o alinhamento.
  for (const d of REGUA_DA_BAND) {
    assert.ok(d.rotulo.length <= 18, `"${d.rotulo}" tem ${d.rotulo.length} caracteres`)
  }
})
