import { prismaSemEscopo, comEmissora } from '../../lib/prisma.js'
import { recalcular } from './servico.js'
import { env } from '../../lib/env.js'
import { log } from '../../lib/log.js'

/**
 * O relógio da plataforma.
 *
 * Sem isto, três coisas quebram em silêncio:
 *   · o Momento vencido continua marcado como ATIVO e aparece para sempre no app
 *   · a virada de programa não acontece — o No Ar mostra a atração anterior
 *   · quem não está com o app aberto nunca recebe a mudança
 *
 * Roda em intervalo curto e barato: uma varredura por emissora ativa, e só recalcula
 * o Estado No Ar quando algo de fato mudou.
 */

let timer: NodeJS.Timeout | null = null

async function varrer(): Promise<void> {
  const emissoras = await prismaSemEscopo.emissora.findMany({
    where: { ativa: true },
    select: { id: true, slug: true, nome: true },
  })

  const agora = new Date()

  for (const emissora of emissoras) {
    try {
      await comEmissora(emissora.id, async () => {
        // 1. Encerra o que passou da janela. A janela é ampla de propósito para
        //    absorver o delay entre FM e streaming — mas quando acaba, acabou.
        const encerrados = await prismaSemEscopo.momento.updateMany({
          where: {
            emissoraId: emissora.id,
            estado: 'ATIVO',
            OR: [
              { fimEm: { lt: agora } },
              // O Momento também morre quando o programa dele acaba, mesmo que ainda
              // faltassem minutos no cronômetro.
              //
              // Sem isto, um Momento publicado nos instantes finais de uma edição
              // ficava num limbo: ativo no banco, listado na aba Momentos, e invisível
              // no No Ar — que só mostra o que pertence à edição corrente. O ouvinte
              // via uma pergunta viva numa tela e nenhuma na outra.
              //
              // A regra vem do produto, não da conveniência: o Momento pertence à
              // Edição. Terminou o programa, terminou o que acontecia dentro dele.
              { edicao: { fimEm: { lt: agora } } },
            ],
          },
          data: { estado: 'ENCERRADO' },
        })

        // 2. Publica os agendados cuja hora chegou.
        const publicados = await prismaSemEscopo.momento.updateMany({
          where: {
            emissoraId: emissora.id,
            estado: { in: ['AGENDADO', 'PRONTO'] },
            inicioEm: { lte: agora },
            fimEm: { gt: agora },
          },
          data: { estado: 'ATIVO' },
        })

        // 3. A virada de programa também muda o No Ar, mesmo sem Momento nenhum.
        //    Comparar a edição corrente com a do estado é mais caro do que
        //    simplesmente recalcular — que é uma consulta pequena e indexada.
        if (encerrados.count > 0 || publicados.count > 0) {
          await recalcular(emissora)
          log.info(
            { emissora: emissora.slug, encerrados: encerrados.count, publicados: publicados.count },
            'momentos atualizados pelo agendador',
          )
        } else {
          await recalcular(emissora)
        }
      })
    } catch (e) {
      // Uma emissora com problema não pode parar as outras.
      log.error({ err: e, emissora: emissora.slug }, 'falha na varredura do agendador')
    }
  }
}

export function iniciarAgendador(): void {
  if (timer) return
  const intervalo = env.NO_AR_INTERVALO_SEGUNDOS * 1000
  timer = setInterval(() => void varrer().catch((e) => log.error({ err: e }, 'agendador')), intervalo)
  void varrer().catch((e) => log.error({ err: e }, 'primeira varredura do agendador'))
  log.info({ intervaloSegundos: env.NO_AR_INTERVALO_SEGUNDOS }, 'agendador do No Ar iniciado')
}

export function pararAgendador(): void {
  if (timer) clearInterval(timer)
  timer = null
}
