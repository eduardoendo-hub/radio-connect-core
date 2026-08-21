import { prisma, prismaSemEscopo, comEmissora } from '../../lib/prisma.js'
import { log } from '../../lib/log.js'
import { planejarDia, type SlotDaGrade } from './plano.js'

/**
 * Transforma a grade semanal em edições concretas.
 *
 * O `SlotGrade` diz "A Hora do Ronco vai ao ar de segunda a sexta, das 6h às 9h". A
 * `Edicao` é "A Hora do Ronco de hoje" — e é a ela que os Momentos se ligam, é ela que o
 * Studio abre no Ao Vivo, é ela que o aplicativo mostra.
 *
 * **Até aqui, quem criava edição era o seed da demonstração**, para hoje e amanhã. Isso
 * funcionava por acidente: o contêiner reinicia com frequência e o seed roda de novo. Um
 * fim de semana sem deploy e o aplicativo mostraria uma rádio sem programa nenhum — e a
 * emissora não teria como saber por quê.
 *
 * Agora é rotina: sete dias à frente, recalculada de hora em hora e no instante em que
 * alguém mexe na grade.
 */

const DIAS_A_FRENTE = 7

/**
 * Gera as edições que faltam para os próximos dias.
 *
 * **Não toca no passado, e não toca em edição que já tem Momento.** A edição de ontem é
 * história: tem Momentos publicados, votos contados, mensagens ligadas a ela. Se alguém
 * corrigir o horário de um programa numa quarta, o que já foi ao ar continua tendo
 * acontecido no horário em que aconteceu.
 */
export async function materializarEdicoes(emissoraId: string, dias = DIAS_A_FRENTE) {
  return comEmissora(emissoraId, async () => {
    const agora = new Date()
    const slots = await prisma.slotGrade.findMany({
      where: { ativo: true, programa: { ativo: true } },
      include: { programa: { select: { id: true, locutorTitularId: true } } },
    })
    if (slots.length === 0) return { criadas: 0, removidas: 0, adotadas: 0 }

    const daGrade: SlotDaGrade[] = slots.map((s) => ({
      id: s.id,
      programaId: s.programaId,
      diaSemana: s.diaSemana,
      horaInicio: s.horaInicio,
      horaFim: s.horaFim,
      locutorTitularId: s.programa.locutorTitularId,
    }))

    let criadas = 0
    let removidas = 0
    let adotadas = 0

    for (let desloc = 0; desloc < dias; desloc++) {
      const dia = new Date(agora)
      dia.setDate(dia.getDate() + desloc)

      const inicioDoDia = new Date(dia); inicioDoDia.setHours(0, 0, 0, 0)
      const fimDoDia = new Date(dia); fimDoDia.setHours(23, 59, 59, 999)

      const existentes = await prisma.edicao.findMany({
        where: { inicioEm: { gte: inicioDoDia, lte: fimDoDia } },
        include: { _count: { select: { momentos: true } } },
      })

      const plano = planejarDia(
        daGrade,
        existentes.map((e) => ({
          id: e.id,
          slotId: e.slotId,
          programaId: e.programaId,
          inicioEm: e.inicioEm,
          temMomento: e._count.momentos > 0,
        })),
        dia,
        agora,
      )

      if (plano.apagar.length > 0) {
        const r = await prisma.edicao.deleteMany({ where: { id: { in: plano.apagar } } })
        removidas += r.count
      }
      for (const ad of plano.adotar) {
        await prisma.edicao.update({ where: { id: ad.edicaoId }, data: { slotId: ad.slotId } })
        adotadas++
      }
      for (const c of plano.criar) {
        await prisma.edicao.create({ data: { emissoraId, ...c } })
        criadas++
      }
    }

    return { criadas, removidas, adotadas }
  })
}

/**
 * Roda para todas as emissoras.
 *
 * Rotina de fundo atravessa tenants de propósito — daí `prismaSemEscopo` para listar e
 * `comEmissora` dentro de cada uma. O escopo não é contornado: é escolhido, uma rádio
 * por vez.
 */
export async function materializarTodas() {
  const emissoras = await prismaSemEscopo.emissora.findMany({
    where: { ativa: true },
    select: { id: true, slug: true },
  })
  for (const e of emissoras) {
    try {
      const r = await materializarEdicoes(e.id)
      if (r.criadas || r.removidas) log.info({ emissora: e.slug, ...r }, 'grade materializada')
    } catch (erro) {
      // Uma rádio com grade problemática não pode deixar as outras sem programação.
      log.error({ err: erro, emissora: e.slug }, 'falha ao materializar a grade')
    }
  }
}
