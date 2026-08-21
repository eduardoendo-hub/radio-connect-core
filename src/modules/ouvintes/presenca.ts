import { prisma } from '../../lib/prisma.js'
import { diaLocal } from '../../lib/tempo.js'

/**
 * Registra que esta pessoa apareceu hoje.
 *
 * Roda no guarda de sessão do ouvinte, então **qualquer** uso do aplicativo conta — não
 * só quem toca o áudio. Quem abre para ver o que está no ar e fecha esteve presente, e
 * uma régua que só enxergasse minutos ouvidos classificaria essa pessoa como ausente.
 *
 * **O índice único não basta como filtro.** O aplicativo consulta o No Ar de quinze em
 * quinze segundos: sem a memória abaixo seriam quatro gravações por minuto por ouvinte,
 * todas batendo no banco para não mudar nada. Com dez mil pessoas ouvindo, quarenta mil
 * por minuto — o custo de um dado que muda uma vez por dia.
 *
 * O conjunto guarda só o dia corrente e é trocado quando a data vira, então não cresce
 * sem parar. Se o processo reinicia, no máximo se tenta uma gravação a mais por pessoa: o
 * índice único continua sendo a garantia, isto aqui é só economia.
 *
 * Não espera e não derruba nada: presença é telemetria, e telemetria que atrapalha a tela
 * é pior que telemetria que falta.
 */
export function registrarPresenca(emissoraId: string, ouvinteId: string) {
  const hoje = diaLocal()

  if (visto.dia !== hoje) {
    visto.dia = hoje
    visto.ids = new Set()
  }
  if (visto.ids.has(ouvinteId)) return
  visto.ids.add(ouvinteId)

  // `create` e não `upsert`: se a linha já existe, o dia dela já está contado e não há
  // nada a somar. O conflito é o resultado esperado, não um erro.
  void prisma.diaDoOuvinte
    .create({ data: { emissoraId, ouvinteId, data: new Date(hoje) } })
    .catch(() => {
      /* já apareceu hoje, ou o banco está ocupado. Nos dois casos, seguir. */
    })
}

const visto: { dia: string; ids: Set<string> } = { dia: '', ids: new Set() }
