/**
 * A identidade do ouvinte: o que a promoção exige para valer.
 *
 * Concorrer a prêmio não é curtir uma música. Sorteio tem regulamento, tem maioridade e
 * tem gente que tenta ganhar cinco vezes — e essas três coisas só existem se alguém as
 * verificar. É aqui.
 */

/** O que falta para a pessoa poder concorrer. Vazio = está pronta. */
export type Pendencia = 'nome' | 'email' | 'cpf' | 'dataNascimento' | 'menor'

export type Identidade = {
  nome: string | null
  email: string | null
  cpf: string | null
  dataNascimento: Date | null
}

/**
 * Só dígitos.
 *
 * A pessoa digita com ponto e traço porque é assim que ela conhece o próprio CPF. O
 * banco guarda sem, senão "111.444.777-35" e "11144477735" viram duas pessoas — e aí a
 * unicidade que justifica pedir o CPF deixa de existir.
 */
export function soDigitos(valor: string) {
  return valor.replace(/\D/g, '')
}

/**
 * O CPF é válido?
 *
 * Dígito verificador de verdade, não `length === 11`. Sem isto, "12345678901" entra, a
 * pessoa concorre, ganha, e a rádio descobre na hora de entregar o prêmio — que é o
 * pior momento possível para descobrir.
 *
 * A sequência repetida (000…, 111…) passa no cálculo dos dígitos e é rejeitada à parte:
 * é o CPF que todo mundo inventa quando não quer dar o próprio.
 */
export function cpfValido(bruto: string) {
  const cpf = soDigitos(bruto)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digito = (ate: number) => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10])
}

/** "***.456.789-**" — o suficiente para a pessoa reconhecer o próprio, e mais nada. */
export function mascarar(cpf: string | null) {
  const d = cpf ? soDigitos(cpf) : ''
  if (d.length !== 11) return null
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

/**
 * Idade completa hoje.
 *
 * Duas armadilhas, e as duas custam caro num sorteio.
 *
 * A primeira: ano menos ano erra por até 365 dias, e o erro cai justamente em quem tem
 * 17 e faz 18 em dezembro — o caso que a regra existe para pegar.
 *
 * A segunda: **a data de nascimento é uma data de calendário, não um instante.**
 * `@db.Date` volta do banco como meia-noite UTC, e ler `getDate()` nela num servidor em
 * Brasília devolve o dia anterior. Quem nasceu em 10 de agosto vira 9 de agosto e
 * completa 18 anos um dia antes do que deveria. Por isso o nascimento é lido em UTC e o
 * "hoje" no relógio de parede da emissora: cada um na régua em que foi escrito.
 */
export function idade(nascimento: Date, hoje = new Date()) {
  const anoN = nascimento.getUTCFullYear()
  const mesN = nascimento.getUTCMonth()
  const diaN = nascimento.getUTCDate()

  let anos = hoje.getFullYear() - anoN
  const mes = hoje.getMonth() - mesN
  if (mes < 0 || (mes === 0 && hoje.getDate() < diaN)) anos--
  return anos
}

/**
 * O que ainda falta para esta pessoa concorrer.
 *
 * Devolve a lista, e não um booleano, porque a tela precisa dizer **o que** falta. "Seus
 * dados estão incompletos" é o tipo de recado que faz a pessoa desistir; "falta o CPF"
 * ela resolve em dez segundos.
 */
export function pendencias(quem: Identidade, hoje = new Date()): Pendencia[] {
  const faltando: Pendencia[] = []
  if (!quem.nome?.trim()) faltando.push('nome')
  if (!quem.email?.trim()) faltando.push('email')
  if (!quem.cpf || !cpfValido(quem.cpf)) faltando.push('cpf')
  if (!quem.dataNascimento) faltando.push('dataNascimento')
  else if (idade(quem.dataNascimento, hoje) < 18) faltando.push('menor')
  return faltando
}

/** A frase que a tela mostra. Uma pendência por vez, na ordem em que se resolve. */
export function explicar(faltando: Pendencia[]) {
  if (faltando.includes('menor')) {
    return 'As promoções da rádio são para maiores de 18 anos.'
  }
  const nomes: Record<Exclude<Pendencia, 'menor'>, string> = {
    nome: 'seu nome',
    email: 'seu e-mail',
    cpf: 'seu CPF',
    dataNascimento: 'sua data de nascimento',
  }
  const lista = faltando
    .filter((f): f is Exclude<Pendencia, 'menor'> => f !== 'menor')
    .map((f) => nomes[f])
  if (lista.length === 0) return ''
  if (lista.length === 1) return `Para concorrer, a rádio precisa de ${lista[0]}.`
  return `Para concorrer, a rádio precisa de ${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}.`
}
