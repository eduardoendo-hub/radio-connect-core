import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOuvinte } from '../../middleware/sessao.js'
import { cpfValido, explicar, mascarar, pendencias, soDigitos } from './identidade.js'
import { nivelDe, porqueDe, lerRegua, type Componentes } from './conexao.js'
import { diaLocal } from '../../lib/tempo.js'

export const rotasOuvintes = Router()

/**
 * Os dados de quem ouve.
 *
 * Existem por causa das promoções: sorteio precisa de nome, contato, CPF e maioridade.
 * Fora disso o produto não pede nada — quem só quer ouvir rádio entra com o telefone e
 * pronto, que é a promessa da tela de entrada.
 */

/** O próprio cadastro, do jeito que a tela mostra. */
rotasOuvintes.get('/perfil', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const quem = await prisma.ouvinte.findFirst({
      where: { id: s.ouvinteId },
      select: {
        nome: true, email: true, telefone: true, cidade: true,
        cpf: true, dataNascimento: true, criadoEm: true,
      },
    })
    if (!quem) throw erros.naoEncontrado('Ouvinte')

    const faltando = pendencias(quem)
    res.json({
      perfil: {
        nome: quem.nome,
        email: quem.email,
        telefone: quem.telefone,
        cidade: quem.cidade,
        // Mascarado até para o dono. Ele não precisa ler o próprio CPF na tela: precisa
        // saber que a rádio já tem. E CPF em resposta de API é CPF em log, em cache de
        // navegador e em captura de tela.
        cpf: mascarar(quem.cpf),
        temCpf: Boolean(quem.cpf),
        dataNascimento: quem.dataNascimento
          ? quem.dataNascimento.toISOString().slice(0, 10)
          : null,
        desde: quem.criadoEm.toISOString(),
      },
      podeConcorrer: faltando.length === 0,
      faltando,
      explicacao: explicar(faltando),
    })
  } catch (e) {
    next(e)
  }
})

const atualizar = z.object({
  nome: z.string().trim().min(2, 'Escreva seu nome completo.').max(80).optional(),
  email: z.string().trim().toLowerCase().email('Confira o e-mail: parece faltar algo.').optional(),
  cidade: z.string().trim().max(60).optional(),
  cpf: z.string().trim().max(20).optional(),
  /// "1985-03-02" — data de calendário, sem hora e sem fuso.
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').optional(),
})

rotasOuvintes.patch('/perfil', exigirOuvinte(), async (req, res, next) => {
  try {
    const dados = atualizar.parse(req.body)
    const s = req.sessao as { ouvinteId: string }

    const atual = await prisma.ouvinte.findFirst({
      where: { id: s.ouvinteId },
      select: { cpf: true },
    })
    if (!atual) throw erros.naoEncontrado('Ouvinte')

    let cpf: string | undefined
    if (dados.cpf !== undefined && dados.cpf !== '') {
      // **CPF se escreve uma vez.**
      //
      // Não é rigidez: CPF não muda na vida de ninguém, e deixar trocar abriria o
      // caminho mais óbvio de burlar a unicidade — concorro, troco o CPF, concorro de
      // novo. Se a pessoa errou ao digitar, a produção corrige; é raro e é conversa de
      // dois minutos, ao contrário do prêmio entregue duas vezes.
      if (atual.cpf && soDigitos(dados.cpf) !== atual.cpf) {
        throw new ErroDaApi(409, 'cpf_ja_definido',
          'O CPF já está no seu cadastro e não muda por aqui. Se estiver errado, fale com a rádio.')
      }
      if (!cpfValido(dados.cpf)) {
        // Erro próprio e não `dadosInvalidos`: aquele devolve "não conseguimos entender
        // esses dados", que num campo de CPF é inútil — a pessoa não sabe se digitou de
        // menos, de mais ou trocou um número. Dizer que os dígitos não fecham manda ela
        // conferir, que é o que resolve.
        throw new ErroDaApi(422, 'cpf_invalido', 'Confira o CPF: os números não fecham.')
      }
      cpf = soDigitos(dados.cpf)
    }

    try {
      await prisma.ouvinte.update({
        where: { id: s.ouvinteId },
        data: {
          nome: dados.nome ?? undefined,
          email: dados.email ?? undefined,
          cidade: dados.cidade ?? undefined,
          cpf,
          dataNascimento: dados.dataNascimento
            // `new Date('1985-03-02')` é meia-noite UTC, que é exatamente o que uma data
            // de calendário deve ser. Ver o comentário em `idade()`.
            ? new Date(`${dados.dataNascimento}T00:00:00.000Z`)
            : undefined,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // A unicidade é o motivo de o CPF existir aqui. Bater nela não é acidente: é
        // alguém tentando concorrer duas vezes, ou duas pessoas de verdade com um erro
        // de digitação. Os dois casos precisam de gente, não de retentativa.
        throw new ErroDaApi(409, 'cpf_em_uso',
          'Este CPF já está em outro cadastro nesta rádio. Fale com a gente pelo chat.')
      }
      throw e
    }

    const quem = await prisma.ouvinte.findFirst({
      where: { id: s.ouvinteId },
      select: { nome: true, email: true, cpf: true, dataNascimento: true },
    })
    const faltando = pendencias(quem!)
    res.json({ salvo: true, podeConcorrer: faltando.length === 0, faltando, explicacao: explicar(faltando) })
  } catch (e) {
    next(e)
  }
})

/**
 * Apagar o cadastro.
 *
 * Se a rádio pede CPF, precisa existir o caminho de volta — e ele tem que apagar de
 * verdade, não esconder. As participações vão junto por cascata, o que é o certo: são
 * dela.
 *
 * O que **não** some é o voto agregado de um Momento: aquilo já virou número, não é mais
 * dado de ninguém. Apagar contagem de enquete encerrada seria reescrever a história do
 * ar, e não é isso que a pessoa está pedindo.
 */
rotasOuvintes.delete('/perfil', exigirOuvinte(), async (req, res, next) => {
  try {
    const s = req.sessao as { ouvinteId: string }
    const quem = await prisma.ouvinte.findFirst({ where: { id: s.ouvinteId }, select: { id: true } })
    if (!quem) throw erros.naoEncontrado('Ouvinte')

    await prisma.ouvinte.delete({ where: { id: quem.id } })
    res.json({ apagado: true })
  } catch (e) {
    next(e)
  }
})

/**
 * O Índice de Conexão desta pessoa.
 *
 * **Só o que o banco sabe.** Antes, a tela Sua Rádio trazia "3h20 de escuta nesta semana"
 * e "12 Momentos no mês" escritos no aplicativo — ninguém contava nem uma coisa nem
 * outra. Numa tela que o ouvinte lê como sendo sobre ele, número inventado é a pior coisa
 * que se pode pôr: no dia em que a pessoa reparar que o número não muda, tudo o mais ali
 * vira suspeito.
 *
 * As horas ouvidas são as do **aplicativo**, e a tela diz isso. A rádio toca no carro e
 * no chuveiro; nada disso passa por aqui, e chamar o que medimos de "horas de rádio"
 * seria inventar de novo, só que com um número que se move.
 */
rotasOuvintes.get('/minha-conexao', exigirOuvinte(), async (req, res, next) => {
  try {
    const { ouvinteId } = req.sessao as { ouvinteId: string }
    const mesAtras = new Date()
    mesAtras.setDate(mesAtras.getDate() - 30)
    const semanaAtras = new Date()
    semanaAtras.setDate(semanaAtras.getDate() - 7)

    const [eu, dias, momentosNoMes, promocoes, conversa] = await Promise.all([
      prisma.ouvinte.findFirst({ where: { id: ouvinteId }, select: { criadoEm: true } }),
      prisma.diaDoOuvinte.findMany({
        where: { ouvinteId, data: { gte: soData(mesAtras) } },
        select: { data: true, minutosOuvidos: true },
      }),
      prisma.respostaMomento.count({ where: { ouvinteId, respondidoEm: { gte: mesAtras } } }),
      prisma.participacaoPromocao.count({ where: { ouvinteId } }),
      prisma.conversa.findFirst({ where: { ouvinteId }, select: { id: true } }),
    ])

    const daSemana = dias.filter((d) => d.data >= soData(semanaAtras))
    const componentes: Componentes = {
      diasNaSemana: daSemana.length,
      diasNoMes: dias.length,
      minutosNaSemana: daSemana.reduce((soma, d) => soma + d.minutosOuvidos, 0),
      momentosNoMes,
      promocoes,
      conversou: conversa !== null,
      diasDeCasa: eu
        ? Math.floor((Date.now() - eu.criadoEm.getTime()) / (24 * 60 * 60 * 1000))
        : 0,
    }

    const regua = lerRegua((req.emissora!.configuracao as Record<string, unknown>)?.regua)
    const nivel = nivelDe(componentes, regua)

    // O snapshot do dia. O Índice é uma série, não um campo do ouvinte: "sua conexão
    // cresceu esta semana" precisa do valor de antes. Gravando hoje enquanto a tela é
    // aberta, a série começa a existir sem nenhum trabalho de recuperação depois.
    await prisma.snapshotConexao
      .upsert({
        where: { ouvinteId_data: { ouvinteId, data: new Date(diaLocal()) } },
        create: { ouvinteId, data: new Date(diaLocal()), score: nivel, nivel: regua[nivel]!.rotulo, componentes },
        update: { score: nivel, nivel: regua[nivel]!.rotulo, componentes },
      })
      .catch(() => null)

    res.json({
      nivel,
      degraus: regua.map((d) => d.rotulo),
      frases: regua.map((d) => d.frase ?? null),
      porque: porqueDe(componentes),
      desde: eu?.criadoEm ?? null,
      momentosNoMes,
      promocoes,
      minutosNaSemana: componentes.minutosNaSemana,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * Sinal de vida do aplicativo.
 *
 * Chega uma vez por minuto enquanto o áudio toca, e o corpo diz quantos minutos passaram
 * desde o último. **O servidor não confia no número:** um cliente pode mandar mil, e o
 * teto de cinco por chamada é o que impede que o Índice de uma rádio inteira seja
 * inventado por quem sabe abrir o console do navegador.
 *
 * A abertura conta separado dos minutos porque são hábitos diferentes: quem deixa a rádio
 * tocando a manhã inteira e quem volta seis vezes ao dia não são a mesma pessoa, e uma
 * rádio de notícia mede a segunda enquanto uma FM mede a primeira.
 */
rotasOuvintes.post('/sinal-de-vida', exigirOuvinte(), async (req, res, next) => {
  try {
    const { ouvinteId } = req.sessao as { ouvinteId: string }
    const d = z.object({
      minutos: z.number().int().min(0).max(5).default(0),
      abriu: z.boolean().default(false),
    }).parse(req.body ?? {})

    const hoje = new Date(diaLocal())
    await prisma.diaDoOuvinte.upsert({
      where: { ouvinteId_data: { ouvinteId, data: hoje } },
      create: {
        emissoraId: req.emissora!.id,
        ouvinteId,
        data: hoje,
        minutosOuvidos: d.minutos,
        aberturas: 1,
      },
      update: {
        minutosOuvidos: { increment: d.minutos },
        ...(d.abriu ? { aberturas: { increment: 1 } } : {}),
      },
    })
    res.json({ registrado: true })
  } catch (e) {
    next(e)
  }
})

/** A data sem hora, para comparar com a coluna `@db.Date`. */
function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
