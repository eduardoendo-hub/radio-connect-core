import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nivelDe, porqueDe, NIVEIS, type Componentes } from './conexao.js'

const zerado: Componentes = {
  diasNaSemana: 0, diasNoMes: 0, momentosNoMes: 0,
  promocoes: 0, conversou: false, diasDeCasa: 0,
}
const com = (p: Partial<Componentes>): Componentes => ({ ...zerado, ...p })

test('quem acabou de chegar está descobrindo', () => {
  assert.equal(NIVEIS[nivelDe(zerado)], 'Descobrindo')
})

test('só aparecer não passa de "Ouvinte presente"', () => {
  // Presença todo dia do mês, sem nunca ter feito nada. Chamar isso de "Muito
  // conectado" esvaziaria a palavra para quem participa.
  const so_presenca = com({ diasNaSemana: 7, diasNoMes: 30, diasDeCasa: 90 })
  assert.equal(NIVEIS[nivelDe(so_presenca)], 'Ouvinte presente')
})

test('uma participação já vira Participante', () => {
  assert.equal(NIVEIS[nivelDe(com({ momentosNoMes: 1 }))], 'Participante')
  assert.equal(NIVEIS[nivelDe(com({ promocoes: 1 }))], 'Participante')
})

test('Muito conectado pede presença na semana e engajamento', () => {
  assert.equal(NIVEIS[nivelDe(com({ diasNaSemana: 4, momentosNoMes: 3 }))], 'Muito conectado')
  // Presente na semana mas com uma participação só: ainda Participante.
  assert.equal(NIVEIS[nivelDe(com({ diasNaSemana: 4, momentosNoMes: 1 }))], 'Participante')
  // A conversa conta como engajamento junto de uma participação.
  assert.equal(NIVEIS[nivelDe(com({ diasNaSemana: 4, momentosNoMes: 1, conversou: true }))], 'Muito conectado')
})

test('Embaixador não se alcança numa semana intensa', () => {
  // Tudo no talo, mas chegou anteontem: o topo pede constância, não intensidade.
  const recem = com({ diasNaSemana: 7, diasNoMes: 7, momentosNoMes: 20, diasDeCasa: 7 })
  assert.equal(NIVEIS[nivelDe(recem)], 'Muito conectado')

  const antigo = com({ diasNaSemana: 5, diasNoMes: 15, momentosNoMes: 8, diasDeCasa: 30 })
  assert.equal(NIVEIS[nivelDe(antigo)], 'Embaixador')
})

test('a conexão diminui sozinha quando a pessoa some', () => {
  // As janelas são móveis: quem parou de aparecer volta a degraus de baixo sem que
  // ninguém precise "expirar" nada — e sem nenhum aviso ao ouvinte.
  const sumiu = com({ diasNaSemana: 0, diasNoMes: 1, momentosNoMes: 0, promocoes: 2, diasDeCasa: 200 })
  assert.equal(NIVEIS[nivelDe(sumiu)], 'Participante')
})

test('os porquês são fatos, e no máximo três', () => {
  const p = porqueDe(com({ diasNaSemana: 4, momentosNoMes: 3, promocoes: 2, conversou: true }))
  assert.equal(p.length, 3)
  assert.deepEqual(p, [
    'voltou em quatro dias desta semana',
    'participou de três Momentos',
    'entrou em duas promoções',
  ])
})

test('números viram palavra: é alguém falando, não contabilidade', () => {
  assert.match(porqueDe(com({ momentosNoMes: 1 }))[0]!, /um Momento/)
  assert.match(porqueDe(com({ momentosNoMes: 7 }))[0]!, /sete Momentos/)
  // Acima de dez a palavra atrapalha mais do que ajuda.
  assert.match(porqueDe(com({ momentosNoMes: 23 }))[0]!, /23 Momentos/)
})

test('quem não fez nada recebe convite, não uma lista vazia', () => {
  const p = porqueDe(zerado)
  assert.equal(p.length, 1)
  assert.match(p[0]!, /participe de um Momento/i)
})

test('um dia só de presença não vira "voltou em um dia"', () => {
  // Ter aberto o app hoje não é um fato sobre a relação — é o que a pessoa está fazendo
  // agora. Anunciar isso como conquista soa a deboche.
  assert.deepEqual(porqueDe(com({ diasNaSemana: 1 })), [
    'você chegou agora — participe de um Momento para a rádio te conhecer',
  ])
})

test('um e dois concordam em gênero — "duas promoções"', () => {
  // Do três em diante o português não flexiona, o que faz o descuido passar batido em
  // quase todo teste. Este cobre justamente os dois números onde ele aparece.
  assert.match(porqueDe(com({ promocoes: 2 }))[0]!, /duas promoções/)
  assert.match(porqueDe(com({ promocoes: 1 }))[0]!, /numa promoção/)
  assert.match(porqueDe(com({ promocoes: 3 }))[0]!, /três promoções/)
})
