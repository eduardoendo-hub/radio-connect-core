import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { materializarEdicoes } from './materializar.js'
import { recalcular } from '../noar/servico.js'

export const rotasGrade = Router()

/**
 * Programas, locutores e a grade da semana.
 *
 * Até aqui a grade da Band FM veio escrita num script. Uma rádio nova não tinha como
 * montar a dela, e a Band não tinha como mudar a escala — que muda toda semana.
 *
 * **Quem manda na grade é o slot; a edição é consequência.** Mexeu na grade,
 * as edições futuras são refeitas na hora — sem esperar o próximo ciclo, porque quem
 * acabou de arrastar um programa quer ver a mudança na tela do dia.
 */

const OPERA_GRADE = ['ADMIN', 'PROGRAMACAO', 'DIRETOR'] as const
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

// ── Locutores ────────────────────────────────────────────────

rotasGrade.get('/locutores', exigirOperador(), async (_req, res, next) => {
  try {
    const locutores = await prisma.locutor.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      select: { id: true, nome: true, bio: true, imagemUrl: true, ativo: true },
    })
    res.json({ locutores })
  } catch (e) {
    next(e)
  }
})

rotasGrade.post('/locutores', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const d = z
      .object({
        nome: z.string().trim().min(2, 'Escreva o nome do locutor.').max(80),
        bio: z.string().trim().max(200).optional(),
        imagemUrl: z.string().trim().max(500).optional(),
      })
      .parse(req.body)
    const locutor = await prisma.locutor.create({
      data: {
        emissoraId: req.emissora!.id,
        nome: d.nome,
        bio: d.bio || null,
        imagemUrl: d.imagemUrl || null,
      },
    })
    res.status(201).json({ locutor })
  } catch (e) {
    next(e)
  }
})

rotasGrade.patch('/locutores/:id', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const d = z
      .object({
        nome: z.string().trim().min(2).max(80).optional(),
        bio: z.string().trim().max(200).nullable().optional(),
        // `nullable` e não só `optional`: sem isso dá para trocar a foto do locutor e
        // nunca tirar a que está lá — a pessoa saiu da rádio e o rosto fica.
        imagemUrl: z.string().trim().max(500).nullable().optional(),
        ativo: z.boolean().optional(),
      })
      .parse(req.body)
    const existe = await prisma.locutor.findFirst({ where: { id: req.params.id! } })
    if (!existe) throw erros.naoEncontrado('Locutor')

    await prisma.locutor.update({
      where: { id: existe.id },
      // **`?? undefined` não serve aqui.** Ele achata `null` em `undefined`, e o Prisma
      // lê `undefined` como "não mexe neste campo" — então limpar a foto ou a bio era
      // silenciosamente ignorado. `undefined` só quando o campo não veio no corpo.
      data: {
        nome: d.nome ?? undefined,
        bio: d.bio === undefined ? undefined : d.bio,
        imagemUrl: d.imagemUrl === undefined ? undefined : d.imagemUrl,
        ativo: d.ativo ?? undefined,
      },
    })
    res.json({ atualizado: true })
  } catch (e) {
    next(e)
  }
})

// ── Programas ────────────────────────────────────────────────

rotasGrade.get('/programas', exigirOperador(), async (_req, res, next) => {
  try {
    const programas = await prisma.programa.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: {
        locutorTitular: { select: { id: true, nome: true } },
        equipe: { select: { id: true, nome: true } },
        _count: { select: { slots: true } },
      },
    })
    res.json({
      programas: programas.map((p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        corDestaque: p.corDestaque,
        anunciosAtivos: p.anunciosAtivos,
        ativo: p.ativo,
        locutorTitular: p.locutorTitular,
        equipe: p.equipe,
        faixas: p._count.slots,
      })),
    })
  } catch (e) {
    next(e)
  }
})

const programa = z.object({
  nome: z.string().trim().min(2, 'Escreva o nome do programa.').max(80),
  descricao: z.string().trim().max(300).optional(),
  corDestaque: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.').optional(),
  locutorTitularId: z.string().nullable().optional(),
  /// Quem divide o microfone. O titular entra aqui também — ele assina e apresenta.
  equipeIds: z.array(z.string()).optional(),
  /// Nem todo horário pode ser vendido: político eleitoral, religioso, exclusividade.
  anunciosAtivos: z.boolean().optional(),
  ativo: z.boolean().optional(),
})

rotasGrade.post('/programas', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const d = programa.parse(req.body)
    const novo = await prisma.programa.create({
      data: {
        emissoraId: req.emissora!.id,
        nome: d.nome,
        descricao: d.descricao || null,
        corDestaque: d.corDestaque || null,
        locutorTitularId: d.locutorTitularId || null,
        anunciosAtivos: d.anunciosAtivos ?? true,
        ...(d.equipeIds?.length
          ? { equipe: { connect: d.equipeIds.map((id) => ({ id })) } }
          : {}),
      },
    })
    res.status(201).json({ programa: novo })
  } catch (e) {
    next(e)
  }
})

rotasGrade.patch('/programas/:id', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const d = programa.partial().parse(req.body)
    const existe = await prisma.programa.findFirst({ where: { id: req.params.id! } })
    if (!existe) throw erros.naoEncontrado('Programa')

    await prisma.programa.update({
      where: { id: existe.id },
      data: {
        nome: d.nome ?? undefined,
        descricao: d.descricao ?? undefined,
        corDestaque: d.corDestaque ?? undefined,
        locutorTitularId: d.locutorTitularId === undefined ? undefined : d.locutorTitularId,
        anunciosAtivos: d.anunciosAtivos ?? undefined,
        ativo: d.ativo ?? undefined,
        // `set` e não `connect`: a equipe é a lista inteira, não um acréscimo. Quem sai
        // do programa precisa sair de verdade.
        ...(d.equipeIds ? { equipe: { set: d.equipeIds.map((id) => ({ id })) } } : {}),
      },
    })

    await materializarEdicoes(req.emissora!.id)
    await recalcular(req.emissora!)
    res.json({ atualizado: true })
  } catch (e) {
    next(e)
  }
})

// ── A grade ──────────────────────────────────────────────────

rotasGrade.get('/grade', exigirOperador(), async (_req, res, next) => {
  try {
    const slots = await prisma.slotGrade.findMany({
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
      include: {
        programa: {
          select: {
            id: true, nome: true, corDestaque: true, ativo: true,
            locutorTitular: { select: { nome: true } },
          },
        },
      },
    })
    res.json({
      slots: slots.map((s) => ({
        id: s.id,
        diaSemana: s.diaSemana,
        horaInicio: s.horaInicio,
        horaFim: s.horaFim,
        ativo: s.ativo,
        programa: s.programa,
      })),
    })
  } catch (e) {
    next(e)
  }
})

const faixa = z.object({
  programaId: z.string(),
  /// 0 = domingo. Vários dias de uma vez porque grade de rádio é "segunda a sexta".
  dias: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha ao menos um dia.'),
  horaInicio: z.string().regex(HORA, 'Hora inválida. Use 06:00.'),
  horaFim: z.string().regex(HORA, 'Hora inválida. Use 09:00.'),
})

rotasGrade.post('/grade', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const d = faixa.parse(req.body)

    const existe = await prisma.programa.findFirst({ where: { id: d.programaId } })
    if (!existe) throw erros.naoEncontrado('Programa')

    // Sobreposição é o erro que quebra o No Ar: com duas faixas no mesmo horário, o
    // aplicativo mostra uma delas por desempate arbitrário e a produção não entende por
    // quê. Barrar na entrada é mais barato que explicar depois.
    const doDia = await prisma.slotGrade.findMany({
      where: { diaSemana: { in: d.dias }, ativo: true },
      include: { programa: { select: { nome: true } } },
    })
    const conflito = doDia.find(
      (s) => d.horaInicio < s.horaFim && s.horaInicio < d.horaFim,
    )
    if (conflito) {
      throw new ErroDaApi(409, 'faixa_ocupada',
        `Esse horário já é do "${conflito.programa.nome}" (${conflito.horaInicio} às ${conflito.horaFim}).`)
    }

    await prisma.slotGrade.createMany({
      data: d.dias.map((diaSemana) => ({
        emissoraId: req.emissora!.id,
        programaId: d.programaId,
        diaSemana,
        horaInicio: d.horaInicio,
        horaFim: d.horaFim,
      })),
    })

    const r = await materializarEdicoes(req.emissora!.id)
    await recalcular(req.emissora!)
    res.status(201).json({ criadas: d.dias.length, edicoes: r })
  } catch (e) {
    next(e)
  }
})

rotasGrade.delete('/grade/:id', exigirOperador(...OPERA_GRADE), async (req, res, next) => {
  try {
    const existe = await prisma.slotGrade.findFirst({ where: { id: req.params.id! } })
    if (!existe) throw erros.naoEncontrado('Faixa')

    // **As edições futuras têm que sair antes da faixa.** `Edicao.slotId` é opcional, e
    // apagar o slot faz o Prisma zerá-lo (`SetNull`) em vez de levar a edição junto. A
    // varredura de órfãs então vê `slotId` nulo e conclui que é edição especial, criada à
    // mão — que ela nunca apaga. Resultado: o produtor tira o programa da grade e ele vai
    // ao ar hoje à noite assim mesmo.
    //
    // As que já têm Momento ficam, e ficam de propósito: são história — voto contado,
    // mensagem ligada a elas — e história não se apaga por mudança de grade.
    const orfas = await prisma.edicao.deleteMany({
      where: { slotId: existe.id, inicioEm: { gt: new Date() }, momentos: { none: {} } },
    })
    await prisma.slotGrade.delete({ where: { id: existe.id } })
    const r = await materializarEdicoes(req.emissora!.id)
    await recalcular(req.emissora!)
    res.json({ removida: true, edicoes: { ...r, removidas: r.removidas + orfas.count } })
  } catch (e) {
    next(e)
  }
})
