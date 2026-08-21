/**
 * O Índice de Conexão.
 *
 * **A metodologia é a mesma para todas as rádios; os números são de cada uma.** Uma rádio
 * de notícia em que a pessoa entra três vezes por dia por cinco minutos e uma FM que fica
 * ligada a manhã inteira medem o mesmo hábito com réguas diferentes — e quem sabe qual é
 * a régua é a emissora, não nós. Por isso a estrutura vive aqui, no código, e os limiares
 * vivem em `Emissora.configuracao`, editáveis no Studio.
 *
 * O que **não** é configurável é o formato: cinco degraus, sem número, sem ranking, sem
 * contagem regressiva e sem ameaça de perda. Isso é decisão de produto, não de operação.
 */

/** Do que a conexão é feita — as contagens cruas, sem julgamento. */
export type Componentes = {
  /// Dias distintos com presença nos últimos 7.
  diasNaSemana: number
  /// Dias distintos com presença nos últimos 30.
  diasNoMes: number
  /// Minutos de rádio ouvidos **dentro do aplicativo** nos últimos 7 dias.
  minutosNaSemana: number
  /// Momentos respondidos nos últimos 30 dias.
  momentosNoMes: number
  /// Promoções em que entrou, desde sempre.
  promocoes: number
  /// Já falou com a rádio pelo chat.
  conversou: boolean
  /// Dias desde o cadastro.
  diasDeCasa: number
}

/**
 * A régua da emissora.
 *
 * Cada degrau é uma linha de condições que precisam valer **todas juntas**. Ler a régua
 * de cima para baixo e parar no primeiro degrau que fecha é o que faz "Embaixador" exigir
 * mais que "Participante" sem nenhuma aritmética escondida — não há pontuação, há
 * condição. Foi assim de propósito: pontuação é impossível de explicar para o dono da
 * rádio, e esta régua precisa caber numa tela que ele lê e entende.
 */
export type Degrau = {
  /// O nome que o ouvinte lê. A linguagem pertence à emissora.
  rotulo: string
  /// `null` e `undefined` querem dizer a mesma coisa aqui: não é condição. Os dois
  /// existem porque o JSON guardado carrega `null` e o objeto escrito à mão omite.
  diasNaSemana?: number | null
  diasNoMes?: number | null
  minutosNaSemana?: number | null
  /// Momentos respondidos + promoções, somados.
  participacoes?: number | null
  diasDeCasa?: number | null
}

/**
 * A régua de fábrica.
 *
 * Duas decisões estão embutidas nela, e as duas são discutíveis — é justamente por serem
 * discutíveis que a rádio pode mudar:
 *
 * **Só aparecer não passa do segundo degrau.** Do terceiro em diante é preciso ter feito
 * alguma coisa. Chamar quem nunca participou de "Muito conectado" esvazia a palavra para
 * quem participa.
 *
 * **O topo pede tempo.** Trinta dias de casa e presença em quinze deles. Sem isso,
 * "Embaixador" viraria prêmio de fim de semana intenso e deixaria de significar relação.
 */
export const REGUA_PADRAO: Degrau[] = [
  { rotulo: 'Descobrindo' },
  { rotulo: 'Ouvinte presente', diasNaSemana: 2 },
  { rotulo: 'Participante', participacoes: 1 },
  { rotulo: 'Muito conectado', diasNaSemana: 4, participacoes: 3 },
  { rotulo: 'Embaixador', diasNoMes: 15, diasDeCasa: 30, participacoes: 8 },
]

/** Em que degrau a pessoa está: o mais alto cujas condições ela cumpre. */
export function nivelDe(c: Componentes, regua: Degrau[] = REGUA_PADRAO): number {
  for (let i = regua.length - 1; i > 0; i--) {
    if (cumpre(c, regua[i]!)) return i
  }
  return 0
}

function cumpre(c: Componentes, d: Degrau) {
  const participacoes = c.momentosNoMes + c.promocoes
  // `?? 0` cobre `null` e `undefined` de uma vez: os dois querem dizer "não é condição",
  // e qualquer contagem é `>= 0`.
  return (
    c.diasNaSemana >= (d.diasNaSemana ?? 0) &&
    c.diasNoMes >= (d.diasNoMes ?? 0) &&
    c.minutosNaSemana >= (d.minutosNaSemana ?? 0) &&
    participacoes >= (d.participacoes ?? 0) &&
    c.diasDeCasa >= (d.diasDeCasa ?? 0)
  )
}

/**
 * Lê a régua guardada, caindo na de fábrica quando não há uma.
 *
 * **Uma régua quebrada não pode derrubar a tela do ouvinte.** O que vem do banco é JSON
 * livre, e um dia alguém vai gravar ali um número como texto. Cada campo é conferido um a
 * um: o que não for número inteiro positivo simplesmente não conta como condição, o que
 * degrada para uma régua mais frouxa em vez de para um erro.
 */
export function lerRegua(bruto: unknown): Degrau[] {
  if (!Array.isArray(bruto) || bruto.length !== REGUA_PADRAO.length) return REGUA_PADRAO
  const lida = bruto.map((d, i) => {
    const o = (d ?? {}) as Record<string, unknown>
    const rotulo = typeof o.rotulo === 'string' && o.rotulo.trim() ? o.rotulo.trim() : REGUA_PADRAO[i]!.rotulo
    return {
      rotulo,
      diasNaSemana: inteiro(o.diasNaSemana),
      diasNoMes: inteiro(o.diasNoMes),
      minutosNaSemana: inteiro(o.minutosNaSemana),
      participacoes: inteiro(o.participacoes),
      diasDeCasa: inteiro(o.diasDeCasa),
    }
  })
  return lida
}

function inteiro(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
}

/**
 * O que torna uma régua inutilizável sem dar erro.
 *
 * As duas configurações abaixo não quebram nada: elas simplesmente produzem uma escada em
 * que ninguém sobe, e o dono da rádio passa semanas achando que o aplicativo não engaja.
 * Recusar na hora é mais barato que explicar depois.
 *
 * Mora aqui, e não na rota, porque o seed também escreve régua — direto no banco, sem
 * passar por rota nenhuma. A régua de fábrica de cada emissora nova precisa passar pelo
 * mesmo crivo que a régua editada à mão, senão a rádio nasce com uma escada que o próprio
 * Studio recusaria salvar.
 */
export function conferirRegua(regua: Degrau[]): string | null {
  if (regua.length !== REGUA_PADRAO.length) {
    return `A escada tem ${REGUA_PADRAO.length} degraus, não ${regua.length}.`
  }

  const primeiro = regua[0]!
  if (CONDICOES.some((c) => primeiro[c])) {
    return `"${primeiro.rotulo}" é onde a pessoa começa. Ele não pode exigir nada — só o nome muda.`
  }

  for (let i = 2; i < regua.length; i++) {
    const antes = regua[i - 1]!
    const agora = regua[i]!
    const frouxo = CONDICOES.find((c) => (agora[c] ?? 0) > 0 && (antes[c] ?? 0) > (agora[c] ?? 0))
    if (frouxo) {
      return `"${agora.rotulo}" pede menos que "${antes.rotulo}" em ${NOMES[frouxo]}. ` +
        'Cada degrau precisa ser mais difícil que o de baixo, senão ninguém sobe.'
    }
  }
  return null
}

const CONDICOES = ['diasNaSemana', 'diasNoMes', 'minutosNaSemana', 'participacoes', 'diasDeCasa'] as const

const NOMES: Record<(typeof CONDICOES)[number], string> = {
  diasNaSemana: 'dias na semana',
  diasNoMes: 'dias no mês',
  minutosNaSemana: 'minutos ouvidos',
  participacoes: 'participações',
  diasDeCasa: 'tempo de casa',
}

/**
 * Por que a conexão é o que é — em fatos sobre esta pessoa.
 *
 * Frase só entra se for verdade sobre ela hoje. A lista sai curta de propósito: três
 * fatos são uma explicação, sete são um relatório, e ninguém lê o relatório da própria
 * vida numa tela de rádio.
 */
export function porqueDe(c: Componentes): string[] {
  const fatos: string[] = []

  if (c.diasNaSemana >= 2) {
    fatos.push(`voltou em ${porExtenso(c.diasNaSemana)} dias desta semana`)
  }
  if (c.minutosNaSemana >= 60) {
    const horas = Math.floor(c.minutosNaSemana / 60)
    fatos.push(`ouviu ${porExtenso(horas, 'f')} ${horas === 1 ? 'hora' : 'horas'} pelo aplicativo`)
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
 * Do três em diante o português não flexiona, o que faz o descuido passar despercebido em
 * quase todo teste — foi assim que "dois promoções" quase foi para a tela do ouvinte.
 */
const PALAVRAS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
const FEMININO: Record<number, string> = { 1: 'uma', 2: 'duas' }

function porExtenso(n: number, genero: 'm' | 'f' = 'm') {
  if (n > 10) return String(n)
  return (genero === 'f' ? FEMININO[n] : undefined) ?? PALAVRAS[n]!
}
