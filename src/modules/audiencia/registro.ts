import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { faixaDe } from '../../lib/tempo.js'

/**
 * O registro de audiência.
 *
 * **Duas naturezas de número, e não dá para misturar.** `noApp` e `ouvindo` contam
 * *pessoas distintas*; `plays`, `momentos`, `mensagens` e `participacoes` contam
 * *eventos*. Cinco cliques de uma pessoa são cinco cliques e uma pessoa — confundir isso
 * é exatamente como se mede audiência errado, e é o tipo de erro que ninguém percebe
 * porque o número simplesmente fica maior.
 *
 * A distinção mora no Redis: um conjunto por faixa que expira sozinho em duas horas. O
 * banco recebe só o incremento, e só quando a pessoa é nova naquela faixa.
 */

type Contadores = Partial<
  Record<'plays' | 'momentos' | 'mensagens' | 'participacoes' | 'minutosOuvidos', number>
>

/**
 * Anota o que aconteceu nesta meia hora.
 *
 * `ouvinteId` liga os contadores de gente: `noApp` sempre que alguém aparece, `ouvindo`
 * só quando o áudio está tocando pelo aplicativo. Os dois deduplicam pelo Redis.
 *
 * Nunca espera e nunca derruba: é telemetria. Uma tela de rádio não pode ficar mais lenta
 * porque o painel de audiência quis um número.
 */
export function anotar(
  emissoraId: string,
  o: { ouvinteId?: string; ouvindo?: boolean; contadores?: Contadores },
) {
  void gravar(emissoraId, o).catch(() => {
    /* audiência que falha vira lacuna no gráfico, não erro na tela de ninguém. */
  })
}

async function gravar(
  emissoraId: string,
  { ouvinteId, ouvindo = false, contadores = {} }: {
    ouvinteId?: string; ouvindo?: boolean; contadores?: Contadores
  },
) {
  const inicioEm = faixaDe()

  let noApp = 0
  let ouvindoNovo = 0
  if (ouvinteId) {
    noApp = (await primeiraVez(emissoraId, inicioEm, 'app', ouvinteId)) ? 1 : 0
    if (ouvindo) {
      ouvindoNovo = (await primeiraVez(emissoraId, inicioEm, 'ouvindo', ouvinteId)) ? 1 : 0
    }
  }

  const nada = noApp === 0 && ouvindoNovo === 0 && Object.values(contadores).every((v) => !v)
  if (nada) return

  const soma = {
    noApp: { increment: noApp },
    ouvindo: { increment: ouvindoNovo },
    minutosOuvidos: { increment: contadores.minutosOuvidos ?? 0 },
    plays: { increment: contadores.plays ?? 0 },
    momentos: { increment: contadores.momentos ?? 0 },
    mensagens: { increment: contadores.mensagens ?? 0 },
    participacoes: { increment: contadores.participacoes ?? 0 },
  }

  // O programa da faixa é resolvido só quando a linha nasce. Depois disso ele não muda —
  // a faixa pertence a quem a abriu, e reabrir essa decisão a cada evento faria a mesma
  // meia hora trocar de dono conforme a ordem em que os eventos chegassem.
  const jaExiste = await prisma.faixaAudiencia.findFirst({
    where: { inicioEm },
    select: { id: true },
  })

  if (jaExiste) {
    await prisma.faixaAudiencia.update({ where: { id: jaExiste.id }, data: soma })
    return
  }

  const noAr = await prisma.edicao.findFirst({
    where: { inicioEm: { lte: inicioEm }, fimEm: { gte: inicioEm } },
    select: { id: true, programaId: true },
  })

  await prisma.faixaAudiencia
    .create({
      data: {
        emissoraId,
        inicioEm,
        edicaoId: noAr?.id ?? null,
        programaId: noAr?.programaId ?? null,
        noApp,
        ouvindo: ouvindoNovo,
        minutosOuvidos: contadores.minutosOuvidos ?? 0,
        plays: contadores.plays ?? 0,
        momentos: contadores.momentos ?? 0,
        mensagens: contadores.mensagens ?? 0,
        participacoes: contadores.participacoes ?? 0,
      },
    })
    .catch(async () => {
      // Duas requisições abriram a mesma faixa no mesmo instante. O índice único recusou
      // a segunda, e ela vira soma — sem isso, o primeiro evento de cada meia hora se
      // perderia em toda rádio com movimento.
      const linha = await prisma.faixaAudiencia.findFirst({
        where: { inicioEm },
        select: { id: true },
      })
      if (linha) await prisma.faixaAudiencia.update({ where: { id: linha.id }, data: soma })
    })
}

/**
 * Esta pessoa é nova nesta faixa?
 *
 * **Se o Redis não responde, a resposta é não.** Perder um pedaço do gráfico é menos
 * grave que inflar o número de pessoas — que é justamente o número que a rádio leva para
 * o anunciante. Erro para menos é lacuna; erro para mais é mentira.
 */
async function primeiraVez(
  emissoraId: string,
  inicioEm: Date,
  tipo: 'app' | 'ouvindo',
  ouvinteId: string,
) {
  const chave = `aud:${emissoraId}:${inicioEm.getTime()}:${tipo}`
  try {
    const novo = await redis.sadd(chave, ouvinteId)
    // Duas horas: a faixa dura trinta minutos e a folga cobre relógio fora de hora e
    // requisição atrasada. Expirar sozinho é o que impede o Redis de virar um histórico.
    if (novo === 1) await redis.expire(chave, 7200)
    return novo === 1
  } catch {
    return false
  }
}
