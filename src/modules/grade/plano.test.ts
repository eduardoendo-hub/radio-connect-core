import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarDia, type SlotDaGrade, type EdicaoExistente } from './plano.js'

/**
 * A grade é o que coloca programa no ar.
 *
 * Quando esta decisão erra, ninguém vê erro nenhum: a rádio simplesmente amanhece com o
 * programa errado, ou sem programa. É o tipo de defeito que só aparece pelo ouvido do
 * ouvinte — daí os testes serem sobre as três coisas que quebram calado.
 */

const SEXTA = new Date(2026, 7, 21, 15, 0, 0) // 21/08/2026, uma sexta às 15h
const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const slot = (p: Partial<SlotDaGrade> = {}): SlotDaGrade => ({
  id: 's1',
  programaId: 'p1',
  diaSemana: 5, // sexta
  horaInicio: '20:00',
  horaFim: '21:00',
  locutorTitularId: 'l1',
  ...p,
})

const edicao = (e: Partial<EdicaoExistente> = {}): EdicaoExistente => ({
  id: 'e1',
  slotId: 's1',
  programaId: 'p1',
  inicioEm: new Date(2026, 7, 21, 20, 0, 0),
  temMomento: false,
  ...e,
})

test('cria a edição da faixa que ainda vai acontecer hoje', () => {
  const plano = planejarDia([slot()], [], dia(SEXTA), SEXTA)
  assert.equal(plano.criar.length, 1)
  assert.equal(plano.criar[0]!.inicioEm.getHours(), 20)
  assert.equal(plano.criar[0]!.locutorId, 'l1')
})

test('não inventa a edição da manhã de hoje, que já passou', () => {
  const plano = planejarDia([slot({ horaInicio: '06:00', horaFim: '09:00' })], [], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.criar, [])
})

test('a faixa que atravessa a meia-noite termina no dia seguinte', () => {
  const plano = planejarDia([slot({ horaInicio: '23:00', horaFim: '02:00' })], [], dia(SEXTA), SEXTA)
  const [c] = plano.criar
  assert.ok(c!.fimEm > c!.inicioEm, 'edição nasceu com duração negativa')
  assert.equal(c!.fimEm.getDate(), 22)
})

test('não duplica edição que já existe', () => {
  const plano = planejarDia([slot()], [edicao()], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.criar, [])
  assert.deepEqual(plano.apagar, [])
})

test('a edição órfã some quando a faixa sai da grade', () => {
  const plano = planejarDia([], [edicao()], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, ['e1'])
})

test('a faixa que mudou de horário leva a edição antiga embora e traz a nova', () => {
  const plano = planejarDia([slot({ horaInicio: '22:00', horaFim: '23:00' })], [edicao()], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, ['e1'])
  assert.equal(plano.criar.length, 1)
  assert.equal(plano.criar[0]!.inicioEm.getHours(), 22)
})

test('edição com Momento fica de pé mesmo fora da grade: é história', () => {
  const plano = planejarDia([], [edicao({ temMomento: true })], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, [])
})

test('edição que já começou não é mexida', () => {
  const passada = edicao({ inicioEm: new Date(2026, 7, 21, 6, 0, 0) })
  const plano = planejarDia([], [passada], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, [])
})

test('edição especial, criada à mão, sobrevive à grade', () => {
  const plano = planejarDia([], [edicao({ slotId: null })], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, [])
})

test('a faixa de outro dia da semana não vale para hoje', () => {
  const plano = planejarDia([slot({ diaSemana: 1 })], [], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.criar, [])
})

/**
 * O caso que passou batido em produção: apagar a faixa e a edição continuar de pé.
 *
 * Não é este planejamento que falhava — é que `Edicao.slotId` é opcional, então apagar o
 * `SlotGrade` faz o Prisma zerar o campo (`SetNull`) em vez de levar a edição junto.
 * Chegando aqui com `slotId` nulo, ela passa pela regra da edição especial e nunca é
 * removida. A rota apaga as edições futuras antes de soltar a faixa; este teste registra
 * por que aquela ordem não é detalhe.
 */
test('edição que perdeu o slotId parece especial — por isso a rota apaga antes', () => {
  const plano = planejarDia([], [edicao({ slotId: null })], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.apagar, [], 'se um dia isto apagar, a rota pode parar de apagar antes')
})

test('a órfã do mesmo programa e horário volta a ser da grade', () => {
  const plano = planejarDia([slot()], [edicao({ slotId: null })], dia(SEXTA), SEXTA)
  assert.deepEqual(plano.adotar, [{ edicaoId: 'e1', slotId: 's1' }])
  assert.deepEqual(plano.criar, [], 'adotou, então não duplica')
  assert.deepEqual(plano.apagar, [])
})

test('edição especial em horário que a grade não usa continua intocada', () => {
  const plano = planejarDia(
    [slot({ horaInicio: '22:00', horaFim: '23:00' })],
    [edicao({ slotId: null })],
    dia(SEXTA),
    SEXTA,
  )
  assert.deepEqual(plano.adotar, [], 'não é da faixa: horário diferente')
  assert.deepEqual(plano.apagar, [])
})
