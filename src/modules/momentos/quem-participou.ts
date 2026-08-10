import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import { erros } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'

export const rotasQuemParticipou = Router()

/**
 * Quem votou — para o locutor chamar pelo nome.
 *
 * "O João, do Jardim Ângela, votou na Ana Castela. Vamos para você, João." Isso é
 * rádio, e é a coisa que o produto inteiro existe para permitir: até aqui a operação
 * via um número, e número não se cita no ar.
 *
 * **Traz três, não uma lista.** Com o microfone aberto ninguém rola tela: o produtor
 * aperta e recebe gente pronta para ser citada. Três porque um pode não atender, dois é
 * pouco para escolher e dez vira leitura.
 *
 * **E traz os mais engajados, não os mais recentes.** O valor não está em citar alguém
 * aleatório — está em citar quem acompanha a rádio há meses. É esse gesto que a pessoa
 * conta para os amigos, e é ele que transforma audiência em relação.
 */
rotasQuemParticipou.get('/momentos/:id/quem', exigirOperador(), async (req, res, next) => {
  try {
    const momento = await prisma.momento.findFirst({
      where: { id: req.params.id },
      select: { id: true, titulo: true, opcoes: { select: { id: true, rotulo: true, emoji: true } } },
    })
    if (!momento) throw erros.naoEncontrado('Momento')

    const respostas = await prisma.respostaMomento.findMany({
      where: { momentoId: momento.id },
      orderBy: { respondidoEm: 'desc' },
      // Teto alto o bastante para a conta de engajamento fazer sentido e baixo o
      // bastante para a tela responder no meio do ao vivo. Momento com mais de 300
      // respostas não muda quem são os três mais fiéis.
      take: 300,
      select: {
        opcaoId: true,
        respondidoEm: true,
        ouvinte: {
          select: {
            id: true, nome: true, telefone: true, cidade: true, criadoEm: true,
            _count: { select: { respostas: true, participacoes: true } },
          },
        },
      },
    })

    const rotulos = new Map(momento.opcoes.map((o) => [o.id, o]))

    const gente = respostas
      .filter((r) => r.ouvinte.nome?.trim())
      .map((r) => {
        const o = r.ouvinte
        const meses = Math.max(
          0,
          Math.floor((Date.now() - o.criadoEm.getTime()) / (30 * 24 * 60 * 60 * 1000)),
        )
        const opcao = r.opcaoId ? rotulos.get(r.opcaoId) : null
        return {
          nome: o.nome!,
          telefone: o.telefone,
          cidade: o.cidade,
          opcao: opcao ? `${opcao.emoji ?? ''} ${opcao.rotulo}`.trim() : null,
          respondeuEm: r.respondidoEm.toISOString(),
          mesesDeCasa: meses,
          momentos: o._count.respostas,
          promocoes: o._count.participacoes,
          engajamento: engajamento({ meses, momentos: o._count.respostas, promocoes: o._count.participacoes }),
        }
      })
      .sort((a, b) => b.engajamento - a.engajamento)

    res.json({
      momento: { id: momento.id, titulo: momento.titulo },
      total: respostas.length,
      // Quem tem nome pode ser citado; quem entrou só com telefone, não. Dizer o número
      // evita o produtor achar que a votação foi menor do que foi.
      semNome: respostas.length - gente.length,
      destaques: gente.slice(0, 3),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * O quanto esta pessoa é da casa.
 *
 * Não é ciência e não precisa ser — é uma ordem de preferência para o locutor escolher
 * quem citar. Tempo de casa pesa mais que volume de propósito: quem está há um ano vale
 * mais no ar que quem votou trinta vezes esta semana, e é essa a mensagem que a rádio
 * quer passar ao citar alguém.
 *
 * Fica aqui, e não numa consulta com `ORDER BY`, porque é regra de produto: quando o
 * Índice de Conexão existir de verdade, é esta função que ele substitui.
 */
function engajamento({ meses, momentos, promocoes }: { meses: number; momentos: number; promocoes: number }) {
  return meses * 10 + momentos * 2 + promocoes * 3
}
