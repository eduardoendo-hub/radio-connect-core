import type { Degrau } from '../modules/ouvintes/conexao.js'

/**
 * A escada de conexão da Band FM.
 *
 * Os nomes saíram da própria grade da emissora — *Curte Aí*, *Dá Play*, *Tamo Junto*,
 * *Festa da Band* —, que é uma rádio que escreve como o ouvinte fala. A progressão é de
 * distância: sintonizando (chegando) → na escuta (do outro lado da linha) → chega junto
 * (ao lado) → colado (grudado) → família (dentro de casa). É o que faz a pessoa entender
 * para onde a escada vai sem ninguém explicar.
 *
 * Nenhum nome flexiona em gênero: a audiência da Band é majoritariamente feminina, e
 * "Ouvinte conectado" deixaria metade do público de fora.
 *
 * **Minutos ouvidos não abrem porta nenhuma, e isso foi a decisão mais difícil.** A Band
 * toca no rádio do carro e no da cozinha; quem ouve quatro horas por dia assim e vota em
 * todos os Momentos pelo telefone não tem minuto nenhum registrado. Exigir minutos
 * barraria justamente o ouvinte mais tradicional da rádio. Eles entram na explicação —
 * "ouviu três horas pelo aplicativo" — e não no pedágio. Numa rádio que só existe em
 * streaming a conclusão seria a oposta, e é para isso que a régua é configurável.
 *
 * O estudo completo está em `docs/01-produto/06b-a-escada-da-band-fm.md`.
 */
export const REGUA_DA_BAND: Degrau[] = [
  { rotulo: 'Sintonizando' },
  // O degrau da maioria, e por isso fácil: duas aberturas na semana já são hábito, e o
  // capítulo do Índice proíbe punir quem prefere a experiência passiva.
  { rotulo: 'Na escuta', diasNaSemana: 2 },
  // Uma participação, e nada mais. O salto aqui é de natureza, não de volume: entre quem
  // nunca respondeu e quem respondeu uma vez há uma diferença; entre uma e duas, não há.
  { rotulo: 'Chega junto', participacoes: 1 },
  // "Time" e não "Colado": *colado* flexiona — colado, colada —, e a audiência da Band é
  // majoritariamente feminina. Foi o teste de gênero que pegou, depois de o nome já estar
  // escrito no estudo. *Time* é coletivo, não flexiona, e continua sendo um degrau antes
  // de família: primeiro se joga junto, depois se é de casa.
  { rotulo: 'Time da Band', diasNaSemana: 4, participacoes: 4 },
  // O topo não pede presença **nesta** semana de propósito: quem tem 45 dias de casa pode
  // viajar uma semana sem cair. "Um usuário antigo que retorna não deve recomeçar do zero."
  { rotulo: 'Família Band', diasNoMes: 15, participacoes: 12, diasDeCasa: 45 },
]
