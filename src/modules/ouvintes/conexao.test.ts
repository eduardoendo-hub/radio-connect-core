import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nivelDe, porqueDe, lerRegua, REGUA_PADRAO,
  type Componentes, type Degrau,
} from './conexao.js'

const zerado: Componentes = {
  diasNaSemana: 0, diasNoMes: 0, minutosNaSemana: 0,
  momentosNoMes: 0, promocoes: 0, conversou: false, diasDeCasa: 0,
}
const com = (p: Partial<Componentes>): Componentes => ({ ...zerado, ...p })
const rotulo = (c: Componentes, r: Degrau[] = REGUA_PADRAO) => r[nivelDe(c, r)]!.rotulo

// ── A régua de fábrica ───────────────────────────────────────

test('quem acabou de chegar está descobrindo', () => {
  assert.equal(rotulo(zerado), 'Descobrindo')
})

test('só aparecer não passa de "Ouvinte presente"', () => {
  // Presença todo dia do mês e horas de rádio, sem nunca ter feito nada. Chamar isso de
  // "Muito conectado" esvaziaria a palavra para quem participa.
  const so_presenca = com({ diasNaSemana: 7, diasNoMes: 30, minutosNaSemana: 900, diasDeCasa: 90 })
  assert.equal(rotulo(so_presenca), 'Ouvinte presente')
})

test('uma participação já vira Participante', () => {
  assert.equal(rotulo(com({ momentosNoMes: 1 })), 'Participante')
  assert.equal(rotulo(com({ promocoes: 1 })), 'Participante')
})

test('Muito conectado pede presença na semana e engajamento', () => {
  assert.equal(rotulo(com({ diasNaSemana: 4, momentosNoMes: 3 })), 'Muito conectado')
  assert.equal(rotulo(com({ diasNaSemana: 4, momentosNoMes: 1 })), 'Participante')
})

test('Embaixador não se alcança numa semana intensa', () => {
  // Tudo no talo, mas chegou anteontem: o topo pede constância, não intensidade.
  const recem = com({ diasNaSemana: 7, diasNoMes: 7, momentosNoMes: 20, diasDeCasa: 7 })
  assert.equal(rotulo(recem), 'Muito conectado')

  const antigo = com({ diasNaSemana: 5, diasNoMes: 15, momentosNoMes: 8, diasDeCasa: 30 })
  assert.equal(rotulo(antigo), 'Embaixador')
})

test('a conexão diminui sozinha quando a pessoa some', () => {
  // As janelas são móveis: quem parou de aparecer volta a degraus de baixo sem que
  // ninguém precise "expirar" nada — e sem nenhum aviso ao ouvinte.
  const sumiu = com({ diasNaSemana: 0, diasNoMes: 1, promocoes: 2, diasDeCasa: 200 })
  assert.equal(rotulo(sumiu), 'Participante')
})

// ── A régua da rádio ─────────────────────────────────────────

test('cada rádio mede o próprio hábito', () => {
  // Uma FM que fica ligada a manhã inteira: o que vale é hora de rádio, não visita.
  const fm: Degrau[] = [
    { rotulo: 'Sintonizando' },
    { rotulo: 'Companhia', minutosNaSemana: 120 },
    { rotulo: 'Da casa', minutosNaSemana: 600 },
    { rotulo: 'Grude', minutosNaSemana: 1200, participacoes: 1 },
    { rotulo: 'Da família', minutosNaSemana: 2000, diasDeCasa: 60 },
  ]
  const ouviuMuito = com({ minutosNaSemana: 700, diasNaSemana: 1 })
  assert.equal(rotulo(ouviuMuito, fm), 'Da casa')
  // A mesma pessoa, na régua de fábrica, mal sai do lugar: são réguas diferentes de
  // propósito, e é isso que a rádio configura.
  assert.equal(rotulo(ouviuMuito), 'Descobrindo')
})

test('a rádio renomeia os degraus sem mudar a metodologia', () => {
  const minha = lerRegua([
    { rotulo: 'Chegando' }, { rotulo: 'Presente', diasNaSemana: 2 },
    { rotulo: 'Torcida', participacoes: 1 }, { rotulo: 'Fiel', diasNaSemana: 4, participacoes: 3 },
    { rotulo: 'Da casa', diasNoMes: 15, diasDeCasa: 30, participacoes: 8 },
  ])
  assert.equal(rotulo(com({ momentosNoMes: 1 }), minha), 'Torcida')
})

test('régua torta não derruba a tela do ouvinte', () => {
  // O que vem do banco é JSON livre e um dia alguém grava número como texto. O campo
  // inválido deixa de ser condição — degrada para régua mais frouxa, não para erro.
  const torta = lerRegua([
    { rotulo: 'A' }, { rotulo: 'B', diasNaSemana: '2' },
    { rotulo: '', participacoes: -3 }, { rotulo: 'D', diasNaSemana: null },
    { rotulo: 'E', diasNoMes: 1.5 },
  ])
  assert.equal(torta[1]!.diasNaSemana, undefined)
  assert.equal(torta[2]!.participacoes, undefined)
  assert.equal(torta[2]!.rotulo, 'Participante', 'rótulo vazio cai no de fábrica')
  assert.equal(torta[4]!.diasNoMes, undefined)
  assert.doesNotThrow(() => nivelDe(zerado, torta))
})

test('régua com número errado de degraus é ignorada inteira', () => {
  // Cinco degraus é decisão de produto, não de operação: o desenho da escada depende
  // disso. Uma régua com três seria desenhada errada em silêncio.
  assert.deepEqual(lerRegua([{ rotulo: 'A' }, { rotulo: 'B' }]), REGUA_PADRAO)
  assert.deepEqual(lerRegua(null), REGUA_PADRAO)
  assert.deepEqual(lerRegua('qualquer coisa'), REGUA_PADRAO)
})

// ── Os porquês ───────────────────────────────────────────────

test('os porquês são fatos, e no máximo três', () => {
  const p = porqueDe(com({ diasNaSemana: 4, minutosNaSemana: 180, momentosNoMes: 3, conversou: true }))
  assert.equal(p.length, 3)
  assert.deepEqual(p, [
    'voltou em quatro dias desta semana',
    'ouviu três horas pelo aplicativo',
    'participou de três Momentos',
  ])
})

test('menos de uma hora não vira "ouviu zero horas"', () => {
  const p = porqueDe(com({ minutosNaSemana: 45, momentosNoMes: 1 }))
  assert.deepEqual(p, ['participou de um Momento'])
})

test('números viram palavra: é alguém falando, não contabilidade', () => {
  assert.match(porqueDe(com({ momentosNoMes: 1 }))[0]!, /um Momento/)
  assert.match(porqueDe(com({ momentosNoMes: 7 }))[0]!, /sete Momentos/)
  // Acima de dez a palavra atrapalha mais do que ajuda.
  assert.match(porqueDe(com({ momentosNoMes: 23 }))[0]!, /23 Momentos/)
})

test('um e dois concordam em gênero — "duas promoções", "uma hora"', () => {
  // Do três em diante o português não flexiona, o que faz o descuido passar batido em
  // quase todo teste. Este cobre justamente os dois números onde ele aparece.
  assert.match(porqueDe(com({ promocoes: 2 }))[0]!, /duas promoções/)
  assert.match(porqueDe(com({ minutosNaSemana: 130 }))[0]!, /duas horas/)
  assert.match(porqueDe(com({ minutosNaSemana: 70 }))[0]!, /uma hora\b/)
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
