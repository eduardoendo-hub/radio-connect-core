import { prisma } from '../../lib/prisma.js'
import { diaLocal } from '../../lib/tempo.js'

/**
 * Registra que esta pessoa apareceu hoje.
 *
 * **Uma linha por ouvinte por dia, e o banco garante isso.** A chave de idempotência é
 * `presenca:{ouvinte}:{dia}` num índice único, então o aplicativo pode chamar isto a cada
 * consulta do No Ar — de quinze em quinze segundos — sem que a segunda do dia escreva
 * coisa alguma. Contar de outro jeito exigiria ler antes de escrever, e a leitura sairia
 * mais cara que a gravação que ela tenta evitar.
 *
 * **O dia é o do fuso da emissora, não o UTC.** Quem ouve rádio às onze da noite em São
 * Paulo está no mesmo dia de quem ouviu de manhã, e em UTC já é amanhã: sem isto, uma
 * noite de segunda contaria como terça e "voltou em quatro dias" viraria ficção com
 * aparência de dado.
 *
 * Não bloqueia nada e não derruba nada: presença é telemetria, e telemetria que atrapalha
 * a tela é pior do que telemetria que falta.
 */
export function registrarPresenca(emissoraId: string, ouvinteId: string) {
  const hoje = diaLocal()

  // **O índice único não basta como filtro.** O aplicativo consulta o No Ar de quinze em
  // quinze segundos, e este guarda roda em toda chamada autenticada: sem a memória
  // abaixo seriam quatro INSERTs por minuto por ouvinte, todos batendo no índice para
  // não gravar nada. Com dez mil pessoas ouvindo, quarenta mil gravações recusadas por
  // minuto — o custo de um dado que muda uma vez por dia.
  //
  // O conjunto guarda só o dia corrente e é trocado quando a data vira, então ele não
  // cresce sem parar. Se o processo reinicia, no máximo se tenta uma gravação a mais por
  // pessoa — o índice único continua sendo a garantia; isto aqui é só economia.
  if (visto.dia !== hoje) {
    visto.dia = hoje
    visto.ids = new Set()
  }
  if (visto.ids.has(ouvinteId)) return
  visto.ids.add(ouvinteId)

  void prisma.evento
    .create({
      data: {
        emissoraId,
        ouvinteId,
        nome: 'presenca',
        chaveIdempotencia: `presenca:${ouvinteId}:${hoje}`,
        payload: { dia: hoje },
      },
    })
    .catch(() => {
      /* já apareceu hoje, ou o banco está ocupado. Nos dois casos, seguir. */
    })
}

const visto: { dia: string; ids: Set<string> } = { dia: '', ids: new Set() }


/**
 * Em quantos dias distintos a pessoa apareceu na janela.
 *
 * Conta dias, não visitas: quem abre o aplicativo trinta vezes numa terça apareceu numa
 * terça. É a diferença entre medir hábito e medir ansiedade.
 */
export async function diasComPresenca(ouvinteId: string, dias: number) {
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  const linhas = await prisma.evento.findMany({
    where: { ouvinteId, nome: 'presenca', ocorridoEmServidor: { gte: desde } },
    select: { payload: true },
  })
  const distintos = new Set(
    linhas.map((l) => (l.payload as { dia?: string })?.dia).filter(Boolean),
  )
  return distintos.size
}
