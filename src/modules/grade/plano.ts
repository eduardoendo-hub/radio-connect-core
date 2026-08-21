/**
 * O que a grade manda fazer, sem tocar no banco.
 *
 * A decisão é toda daqui: o que nasce, o que morre, o que fica de pé. A função que fala
 * com o Prisma só executa a lista.
 *
 * **Isto existe para poder ser testado.** Aqui moram as três regras que quebram em
 * silêncio — a faixa que atravessa a meia-noite, a edição que já começou e a edição órfã
 * — e cada uma delas, quando erra, coloca o programa errado no ar de uma rádio inteira
 * sem gerar um único erro no log.
 */
export type SlotDaGrade = {
  id: string
  programaId: string
  diaSemana: number
  horaInicio: string
  horaFim: string
  locutorTitularId: string | null
}

export type EdicaoExistente = {
  id: string
  slotId: string | null
  programaId: string
  inicioEm: Date
  temMomento: boolean
}

export type Plano = {
  criar: { slotId: string; programaId: string; inicioEm: Date; fimEm: Date; locutorId: string | null }[]
  apagar: string[]
  /** Edição que é daquela faixa mas perdeu o vínculo: volta a ser da grade. */
  adotar: { edicaoId: string; slotId: string }[]
}

export function horaDe(hhmm: string, dia: Date) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(dia)
  d.setHours(h ?? 0, m ?? 0, 0, 0)
  return d
}

export function planejarDia(
  slots: SlotDaGrade[],
  existentes: EdicaoExistente[],
  dia: Date,
  agora: Date,
): Plano {
  const doDia = slots.filter((s) => s.diaSemana === dia.getDay())
  const plano: Plano = { criar: [], apagar: [], adotar: [] }

  // Edição órfã: veio de uma faixa que sumiu ou mudou de horário. Some — a menos que já
  // tenha Momento ou já tenha começado. Deixá-la encheria a grade de programa fantasma
  // que ninguém sabe de onde veio.
  for (const e of existentes) {
    if (!e.slotId) continue // especial, criada à mão: não é da grade
    if (e.temMomento) continue
    if (e.inicioEm <= agora) continue
    const aindaVale = doDia.some(
      (s) => s.id === e.slotId && horaDe(s.horaInicio, dia).getTime() === e.inicioEm.getTime(),
    )
    if (!aindaVale) plano.apagar.push(e.id)
  }

  for (const s of doDia) {
    const inicioEm = horaDe(s.horaInicio, dia)
    const fimEm = horaDe(s.horaFim, dia)
    // Faixa que atravessa a meia-noite — "23h às 2h". Sem isto o fim ficaria antes do
    // início e a edição nasceria com duração negativa.
    if (fimEm <= inicioEm) fimEm.setDate(fimEm.getDate() + 1)

    // Rodar isto ao meio-dia não deve inventar a edição das 6h da manhã de hoje, que não
    // aconteceu neste sistema.
    if (fimEm <= agora) continue

    const jaTem = existentes.find(
      (e) =>
        e.programaId === s.programaId &&
        e.inicioEm.getTime() === inicioEm.getTime() &&
        !plano.apagar.includes(e.id),
    )
    if (jaTem) {
      // **Órfã que voltou para casa.** Mesmo programa, mesmo minuto, mas sem vínculo com
      // faixa nenhuma: é esta edição, só que desligada da grade. Sem adotá-la, ela ocupa
      // o horário para sempre — bloqueia a criação da edição certa e sobrevive a toda
      // remoção de faixa, porque a varredura de órfãs a confunde com edição especial.
      //
      // Isso não é hipótese: a produção ficou com uma dessas, de quando apagar a faixa
      // zerava o `slotId` em vez de levar a edição junto. Adotar é o que cura o passado
      // sem precisar de migração escrita à mão.
      if (!jaTem.slotId) plano.adotar.push({ edicaoId: jaTem.id, slotId: s.id })
      continue
    }

    plano.criar.push({
      slotId: s.id,
      programaId: s.programaId,
      inicioEm,
      fimEm,
      locutorId: s.locutorTitularId,
    })
  }

  return plano
}
