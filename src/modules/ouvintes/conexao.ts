/**
 * O Índice de Conexão.
 *
 * **A tela Sua Rádio mostrava números inventados.** "3h20 de escuta nesta semana", "12
 * Momentos no mês", "voltou em quatro dias" — nada disso vinha do banco, e o produto
 * nunca mediu tempo de escuta. Numa tela que o ouvinte lê como sendo sobre ele, número
 * inventado é a pior coisa que se pode colocar: no dia em que a pessoa reparar que o
 * número não muda, tudo o mais na tela vira suspeito.
 *
 * Aqui só entra o que o banco sabe de verdade. O que não dá para saber saiu da tela —
 * tempo de escuta não voltou como zero, voltou como nada, porque a rádio toca no
 * chuveiro e no carro e este aplicativo não tem como contar isso.
 */

/**
 * Do que a conexão é feita.
 *
 * Os quatro componentes vêm do capítulo do Índice: presença, participação,
 * relacionamento, constância. São contagens cruas — a régua que os transforma em nível
 * mora em `nivelDe`, separada de propósito, porque é a parte que vai mudar quando as
 * rádios disserem o que consideram um ouvinte presente.
 */
export type Componentes = {
  /// Dias distintos com presença nos últimos 7.
  diasNaSemana: number
  /// Dias distintos com presença nos últimos 30.
  diasNoMes: number
  /// Momentos respondidos nos últimos 30 dias.
  momentosNoMes: number
  /// Promoções em que entrou, desde sempre.
  promocoes: number
  /// Já falou com a rádio pelo chat.
  conversou: boolean
  /// Dias desde o cadastro.
  diasDeCasa: number
}

export const NIVEIS = [
  'Descobrindo',
  'Ouvinte presente',
  'Participante',
  'Muito conectado',
  'Embaixador',
] as const

/**
 * Em que degrau a pessoa está.
 *
 * **Presença sobe até "Ouvinte presente" e para.** Daí em diante é preciso ter feito
 * alguma coisa — responder, participar, falar. Quem só abre o aplicativo é um ouvinte, e
 * chamar isso de "Muito conectado" esvaziaria a palavra para quem de fato participa.
 *
 * **Embaixador exige tempo, e exige tempo de propósito.** É o único degrau que não se
 * alcança numa semana intensa: pede constância — trinta dias de casa e presença em
 * quinze deles. Sem isso, o topo viraria prêmio de fim de semana e deixaria de
 * significar relação.
 *
 * Ninguém cai de degrau por inatividade nesta função: ela olha janelas móveis, então a
 * conexão diminui sozinha quando a pessoa some. O que o produto nunca faz é **avisar**
 * que caiu — "sentimos sua falta", jamais "sua conexão vai cair".
 */
export function nivelDe(c: Componentes): number {
  const participou = c.momentosNoMes + c.promocoes
  const engajada = participou >= 3 || (participou >= 1 && c.conversou)

  if (c.diasNoMes >= 15 && c.diasDeCasa >= 30 && participou >= 8) return 4
  if (c.diasNaSemana >= 4 && engajada) return 3
  if (participou >= 1) return 2
  if (c.diasNaSemana >= 2 || c.diasNoMes >= 3) return 1
  return 0
}

/**
 * Por que a conexão é o que é — em fatos sobre esta pessoa.
 *
 * Frase só entra se for verdade sobre ela hoje. A lista sai curta de propósito: três
 * fatos são uma explicação, sete são um relatório, e ninguém lê o relatório da própria
 * vida numa tela de rádio.
 *
 * Quem acabou de chegar não recebe uma lista vazia embaixo de um título — recebe o
 * convite, que é o único recado honesto para quem ainda não fez nada.
 */
export function porqueDe(c: Componentes): string[] {
  const fatos: string[] = []

  if (c.diasNaSemana >= 2) {
    fatos.push(`voltou em ${porExtenso(c.diasNaSemana)} ${c.diasNaSemana === 1 ? 'dia' : 'dias'} desta semana`)
  }
  if (c.momentosNoMes > 0) {
    fatos.push(
      c.momentosNoMes === 1
        ? 'participou de um Momento'
        : `participou de ${porExtenso(c.momentosNoMes)} Momentos`,
    )
  }
  if (c.promocoes > 0) {
    fatos.push(
      c.promocoes === 1 ? 'entrou numa promoção' : `entrou em ${porExtenso(c.promocoes, 'f')} promoções`,
    )
  }
  if (c.conversou) fatos.push('conversou com a rádio')

  if (fatos.length === 0) {
    return ['você chegou agora — participe de um Momento para a rádio te conhecer']
  }
  return fatos.slice(0, 3)
}

/**
 * Número em palavra até dez.
 *
 * "participou de 3 Momentos" é contabilidade; "participou de três Momentos" é alguém
 * falando com você. A tela inteira do Índice recusa número frio — a régua é a mesma aqui.
 *
 * **Um e dois concordam em gênero**, e só eles: "duas promoções", não "dois promoções".
 * Do três em diante o português não flexiona, o que faz o descuido passar despercebido
 * em quase todo teste — foi assim que "dois promoções" quase foi para a tela do ouvinte.
 */
const PALAVRAS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
const FEMININO: Record<number, string> = { 1: 'uma', 2: 'duas' }

function porExtenso(n: number, genero: 'm' | 'f' = 'm') {
  if (n > 10) return String(n)
  return (genero === 'f' ? FEMININO[n] : undefined) ?? PALAVRAS[n]!
}
