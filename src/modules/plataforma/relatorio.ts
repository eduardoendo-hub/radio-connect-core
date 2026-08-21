import { Router } from 'express'
import { z } from 'zod'
import { comEmissora, prisma } from '../../lib/prisma.js'
import { exigirPlataforma } from '../../middleware/sessao.js'

export const rotasRelatorio = Router()

/**
 * O relatório de entrega.
 *
 * Este é o documento com que a TechNow cobra, e é por isso que ele responde **duas
 * perguntas e não doze**: quanto foi entregue, e quanto disso é nosso.
 *
 * A tentação num painel comercial é encher de gráfico. Mas quem abre isto no fim do mês
 * quer conferir uma fatura, e conferência não se faz com dashboard — se faz com uma
 * linha por campanha, o número entregue ao lado, e o total separado por quem vendeu.
 *
 * **`vendidoPor` é copiado para cada impressão no momento em que ela acontece**, e não
 * lido da campanha na hora do relatório. Parece redundância e não é: se a campanha
 * mudar de mãos no meio do mês, o que já foi entregue continua pertencendo a quem
 * vendeu quando entregou. Relatório que muda o passado não fecha com nota fiscal.
 */
rotasRelatorio.get('/emissoras/:emissoraId/relatorio', exigirPlataforma(), async (req, res, next) => {
  try {
    const { de, ate } = z
      .object({ de: z.string().optional(), ate: z.string().optional() })
      .parse(req.query)

    // Padrão: os últimos 30 dias. É a janela de fechamento da maioria dos contratos, e
    // abrir num período vazio faria o painel parecer quebrado.
    const fim = ate ? new Date(`${ate}T23:59:59`) : new Date()
    const inicio = de
      ? new Date(`${de}T00:00:00`)
      : new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000)

    const emissoraId = req.params.emissoraId!

    const { impressoes, campanhas } = await comEmissora(emissoraId, async () => {
      const impressoes = await prisma.impressaoAnuncio.findMany({
        where: { ocorridaEm: { gte: inicio, lte: fim } },
        select: {
          campanhaId: true, posicao: true, vendidoPor: true, origem: true,
          visivel: true, clicado: true, concluido: true, ocorridaEm: true,
        },
      })
      const campanhas = await prisma.campanha.findMany({
        select: {
          id: true, nome: true, formato: true,
          anunciante: { select: { id: true, nome: true } },
        },
      })
      return { impressoes, campanhas }
    })

    const nomeDe = new Map(campanhas.map((c) => [c.id, c]))

    type Linha = {
      campanhaId: string | null
      campanha: string
      anunciante: string
      vendidoPor: string
      servidas: number
      vistas: number
      cliques: number
      concluidas: number
      porPosicao: Record<string, number>
    }
    const porCampanha = new Map<string, Linha>()

    for (const i of impressoes) {
      const chave = i.campanhaId ?? 'sem-campanha'
      const c = i.campanhaId ? nomeDe.get(i.campanhaId) : null
      const linha = porCampanha.get(chave) ?? {
        campanhaId: i.campanhaId,
        campanha: c?.nome ?? 'Sem campanha',
        anunciante: c?.anunciante.nome ?? '—',
        vendidoPor: i.vendidoPor,
        servidas: 0, vistas: 0, cliques: 0, concluidas: 0,
        porPosicao: {},
      }
      linha.servidas++
      if (i.visivel) linha.vistas++
      if (i.clicado) linha.cliques++
      if (i.concluido) linha.concluidas++
      linha.porPosicao[i.posicao] = (linha.porPosicao[i.posicao] ?? 0) + 1
      porCampanha.set(chave, linha)
    }

    // A curva por dia responde a pergunta que o número total esconde: a entrega foi
    // constante ou concentrada num dia? Campanha que entregou tudo numa terça é
    // campanha que não apareceu no resto da semana.
    const porDia = new Map<string, number>()
    for (const i of impressoes) {
      const dia = i.ocorridaEm.toISOString().slice(0, 10)
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1)
    }

    const linhas = [...porCampanha.values()].sort((a, b) => b.servidas - a.servidas)

    // ── Por anunciante, que é como o comercial pensa ──────────
    //
    // Uma marca vive em vários lugares ao mesmo tempo: banner na rolagem, pré-roll no
    // play, assinatura no programa, patrocínio de um Momento. Somar por campanha
    // responde "quanto entregou aquele contrato"; somar por anunciante responde "quanto
    // a Soneda apareceu neste mês" — que é a pergunta que ele faz ao telefone.
    type PorMarca = {
      anuncianteId: string
      anunciante: string
      servidas: number
      cliques: number
      porPosicao: Record<string, number>
      campanhas: string[]
    }
    const porAnunciante = new Map<string, PorMarca>()

    for (const i of impressoes) {
      const c = i.campanhaId ? nomeDe.get(i.campanhaId) : null
      const id = c?.anunciante.id ?? 'sem-anunciante'
      const marca = porAnunciante.get(id) ?? {
        anuncianteId: id,
        anunciante: c?.anunciante.nome ?? 'Sem anunciante',
        servidas: 0,
        cliques: 0,
        porPosicao: {},
        campanhas: [],
      }
      marca.servidas++
      if (i.clicado) marca.cliques++
      marca.porPosicao[i.posicao] = (marca.porPosicao[i.posicao] ?? 0) + 1
      if (c && !marca.campanhas.includes(c.nome)) marca.campanhas.push(c.nome)
      porAnunciante.set(id, marca)
    }

    // ── Por posição, no total ─────────────────────────────────
    const porPosicao: Record<string, number> = {}
    for (const i of impressoes) porPosicao[i.posicao] = (porPosicao[i.posicao] ?? 0) + 1

    // ── A curva por dia, por anunciante ───────────────────────
    //
    // O total esconde a pergunta que interessa: a entrega foi constante ou concentrada?
    // Campanha que entregou tudo numa terça é campanha que não apareceu no resto da
    // semana — e é isso que o anunciante percebe sem precisar de relatório.
    const diasDoPeriodo: string[] = []
    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      diasDoPeriodo.push(d.toISOString().slice(0, 10))
    }
    const curva = new Map<string, Map<string, number>>()
    for (const i of impressoes) {
      const c = i.campanhaId ? nomeDe.get(i.campanhaId) : null
      const id = c?.anunciante.id ?? 'sem-anunciante'
      const dia = i.ocorridaEm.toISOString().slice(0, 10)
      const linha = curva.get(id) ?? new Map<string, number>()
      linha.set(dia, (linha.get(dia) ?? 0) + 1)
      curva.set(id, linha)
    }

    res.json({
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      total: {
        servidas: impressoes.length,
        vistas: impressoes.filter((i) => i.visivel).length,
        cliques: impressoes.filter((i) => i.clicado).length,
        concluidas: impressoes.filter((i) => i.concluido).length,
      },
      // A divisão que interessa para a fatura.
      porQuemVendeu: {
        TECHNOW: impressoes.filter((i) => i.vendidoPor === 'TECHNOW').length,
        RADIO: impressoes.filter((i) => i.vendidoPor === 'RADIO').length,
      },
      porPosicao,
      campanhas: linhas,
      anunciantes: [...porAnunciante.values()]
        .sort((a, b) => b.servidas - a.servidas)
        .map((m) => ({
          ...m,
          // A série vem com **todos os dias do período**, inclusive os zerados. Buraco
          // no gráfico é o dado mais importante que existe aqui — é o dia em que a
          // marca não apareceu.
          porDia: diasDoPeriodo.map((dia) => ({
            dia,
            total: curva.get(m.anuncianteId)?.get(dia) ?? 0,
          })),
        })),
      porDia: diasDoPeriodo.map((dia) => ({ dia, total: porDia.get(dia) ?? 0 })),
    })
  } catch (e) {
    next(e)
  }
})
