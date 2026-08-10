import test from 'node:test'
import assert from 'node:assert/strict'
import { cpfValido, idade, mascarar, pendencias, soDigitos, explicar } from './identidade.js'

/**
 * A identidade tem teste porque é a parte que a rádio vai precisar defender.
 *
 * CPF inválido aceito vira prêmio entregue a ninguém. Menor de idade aceito vira
 * problema com o regulamento. Os dois só aparecem no pior momento — na entrega — e é
 * exatamente por isso que se testa aqui.
 */

test('CPF: aceita o válido e recusa o inventado', () => {
  assert.equal(cpfValido('111.444.777-35'), true, 'com pontuação')
  assert.equal(cpfValido('11144477735'), true, 'só dígitos')

  assert.equal(cpfValido('11144477734'), false, 'dígito verificador errado')
  assert.equal(cpfValido('123456789'), false, 'curto demais')
  assert.equal(cpfValido(''), false, 'vazio')
  // O CPF que todo mundo digita quando não quer dar o próprio. Passa no cálculo dos
  // dígitos e por isso precisa ser recusado à parte.
  assert.equal(cpfValido('111.111.111-11'), false, 'sequência repetida')
  assert.equal(cpfValido('000.000.000-00'), false, 'zeros')
})

test('CPF guardado só com dígitos', () => {
  assert.equal(soDigitos('111.444.777-35'), '11144477735')
})

test('CPF nunca sai inteiro para a tela', () => {
  assert.equal(mascarar('11144477735'), '***.444.777-**')
  assert.equal(mascarar(null), null)
  assert.equal(mascarar('123'), null, 'incompleto não vira máscara falsa')
})

test('idade: quem faz aniversário depois ainda não tem a idade', () => {
  const hoje = new Date('2026-08-09T12:00:00Z')
  assert.equal(idade(new Date('2008-08-08'), hoje), 18, 'fez ontem')
  assert.equal(idade(new Date('2008-08-09'), hoje), 18, 'faz hoje')
  // Ano menos ano diria 18. É este o caso que a regra existe para pegar.
  assert.equal(idade(new Date('2008-08-10'), hoje), 17, 'faz amanhã')
  assert.equal(idade(new Date('2008-12-31'), hoje), 17, 'faz em dezembro')
})

test('pendências dizem o que falta, não só que falta', () => {
  const hoje = new Date('2026-08-09T12:00:00Z')
  const completo = {
    nome: 'Eduardo Endo',
    email: 'eduardo@exemplo.com',
    cpf: '11144477735',
    dataNascimento: new Date('1985-03-02'),
  }
  assert.deepEqual(pendencias(completo, hoje), [])

  assert.deepEqual(pendencias({ ...completo, cpf: null }, hoje), ['cpf'])
  assert.deepEqual(pendencias({ ...completo, cpf: '11144477734' }, hoje), ['cpf'],
    'CPF inválido conta como ausente')
  assert.deepEqual(pendencias({ ...completo, nome: '   ' }, hoje), ['nome'],
    'espaço em branco não é nome')
  assert.deepEqual(pendencias({ ...completo, dataNascimento: new Date('2010-01-01') }, hoje),
    ['menor'])
})

test('a frase da tela nomeia o que falta', () => {
  assert.equal(explicar(['cpf']), 'Para concorrer, a rádio precisa de seu CPF.')
  assert.equal(
    explicar(['nome', 'email', 'cpf']),
    'Para concorrer, a rádio precisa de seu nome, seu e-mail e seu CPF.',
  )
  assert.equal(explicar(['menor']), 'As promoções da rádio são para maiores de 18 anos.')
  assert.equal(
    explicar(['cpf', 'menor']),
    'As promoções da rádio são para maiores de 18 anos.',
    'ser menor cala o resto: não adianta pedir CPF a quem não pode concorrer',
  )
})
