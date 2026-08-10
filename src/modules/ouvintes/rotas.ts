import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOuvinte } from '../../middleware/sessao.js'
import { cpfValido, explicar, mascarar, pendencias, soDigitos } from './identidade.js'

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
