import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'

export const rotasBiblioteca = Router()

/**
 * A biblioteca de quadros.
 *
 * O `TemplateMomento` é o formato — "Batalha das Músicas", "Fofocômetro", "Enquete
 * rápida". No Ao Vivo ele vira botão: o produtor escolhe um acontecimento em vez de
 * preencher um formulário, e o Momento nasce em menos de vinte segundos.
 *
 * **Até aqui os quadros vinham do script da demonstração.** A Band tinha seis e não
 * conseguia criar o sétimo; uma rádio nova nascia com os seis da Band ou com nenhum.
 * Como o produto é white-label, isso significava que todo quadro novo do Brasil passava
 * por um deploy nosso — e "subir outra rádio em quinze dias" não sobrevive a isso.
 */

const OPERA_BIBLIOTECA = ['ADMIN', 'PROGRAMACAO', 'DIRETOR'] as const

/**
 * Os ícones que o aplicativo sabe desenhar.
 *
 * **Lista fechada, e fechada nos dois lados.** No aplicativo, um `IconData` montado a
 * partir de um nome qualquer do banco compila e desenha um retângulo vazio em produção —
 * já aconteceu. Lá o mapa ignora o nome desconhecido; aqui a rota recusa, para a pessoa
 * descobrir na hora de salvar e não pelo quadrado em branco no telefone do ouvinte.
 *
 * Precisa andar junto com `_icones` em `identidade_quadro.dart`.
 */
const ICONES = ['campaign', 'swords', 'favorite', 'trophy', 'music_note', 'bolt', 'star'] as const

const TIPOS = [
  'REACAO', 'ESCOLHA', 'ENQUETE', 'AVISO', 'CHAMADA_PROMOCAO', 'RESULTADO', 'FOFOCOMETRO',
] as const

const opcao = z.object({
  rotulo: z.string().trim().min(1).max(60),
  emoji: z.string().trim().max(8).optional(),
})

const quadro = z.object({
  nome: z.string().trim().min(2).max(60),
  tipo: z.enum(TIPOS),
  titulo: z.string().trim().min(2).max(140),
  texto: z.string().trim().max(600).nullish(),
  opcoesPadrao: z.array(opcao).max(6).default([]),
  duracaoSegundos: z.number().int().min(30).max(3600),
  favorito: z.boolean().default(false),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor precisa ser um hexadecimal como #E8437B').nullish(),
  icone: z.enum(ICONES).nullish(),
})

/**
 * O que o formato exige para funcionar.
 *
 * Enquete sem opção é uma tela onde não há o que clicar, e o ouvinte não tem como saber
 * que o erro não é dele. Isso é regra do formato, não gosto — daí morar no servidor, e
 * não só na tela que por acaso criou o quadro.
 */
function conferirFormato(d: z.infer<typeof quadro>) {
  const precisaDeOpcoes = d.tipo === 'ESCOLHA' || d.tipo === 'ENQUETE' || d.tipo === 'REACAO'
  if (precisaDeOpcoes && d.opcoesPadrao.length < 2) {
    throw new ErroDaApi(400, 'faltam_opcoes',
      `Um quadro de ${d.tipo.toLowerCase()} precisa de pelo menos duas opções — é nelas que o ouvinte toca.`)
  }
  if (!precisaDeOpcoes && d.opcoesPadrao.length > 0) {
    throw new ErroDaApi(400, 'opcoes_a_mais',
      `${d.tipo.toLowerCase()} não tem no que tocar: o aplicativo não mostraria essas opções.`)
  }
  // O ícone só desenha por cima de uma cor: a identidade nasce da cor, e o ícone é o
  // reforço dela. Ícone sem cor vira um símbolo cinza que não identifica nada.
  if (d.icone && !d.cor) {
    throw new ErroDaApi(400, 'icone_sem_cor',
      'O ícone só aparece junto com uma cor. Escolha a cor do quadro ou tire o ícone.')
  }
}

rotasBiblioteca.get('/quadros', exigirOperador(), async (req, res, next) => {
  try {
    const arquivados = req.query.arquivados === '1'
    const quadros = await prisma.templateMomento.findMany({
      where: { arquivado: arquivados },
      orderBy: [{ favorito: 'desc' }, { nome: 'asc' }],
      include: { _count: { select: { momentos: true } } },
    })
    res.json({
      quadros: quadros.map((q) => ({ ...q, foiAoAr: q._count.momentos, _count: undefined })),
      icones: ICONES,
    })
  } catch (e) {
    next(e)
  }
})

rotasBiblioteca.post('/quadros', exigirOperador(...OPERA_BIBLIOTECA), async (req, res, next) => {
  try {
    const d = quadro.parse(req.body)
    conferirFormato(d)
    const criado = await prisma.templateMomento.create({
      data: {
        emissoraId: req.emissora!.id,
        nome: d.nome,
        tipo: d.tipo,
        titulo: d.titulo,
        texto: d.texto ?? null,
        opcoesPadrao: d.opcoesPadrao,
        duracaoSegundos: d.duracaoSegundos,
        favorito: d.favorito,
        cor: d.cor ?? null,
        icone: d.icone ?? null,
      },
    })
    res.status(201).json({ quadro: criado })
  } catch (e) {
    next(e)
  }
})

rotasBiblioteca.patch('/quadros/:id', exigirOperador(...OPERA_BIBLIOTECA), async (req, res, next) => {
  try {
    const existe = await prisma.templateMomento.findFirst({ where: { id: req.params.id! } })
    if (!existe) throw erros.naoEncontrado('Quadro')

    const d = quadro.partial().extend({ arquivado: z.boolean().optional() }).parse(req.body)

    // A conferência vale sobre como o quadro **fica**, não sobre o que veio no corpo:
    // trocar só o tipo de AVISO para ENQUETE deixaria um quadro sem opção nenhuma.
    const depois = {
      nome: d.nome ?? existe.nome,
      tipo: d.tipo ?? existe.tipo,
      titulo: d.titulo ?? existe.titulo,
      texto: d.texto === undefined ? existe.texto : d.texto,
      opcoesPadrao: (d.opcoesPadrao ?? existe.opcoesPadrao) as z.infer<typeof opcao>[],
      duracaoSegundos: d.duracaoSegundos ?? existe.duracaoSegundos,
      favorito: d.favorito ?? existe.favorito,
      cor: d.cor === undefined ? existe.cor : d.cor,
      icone: d.icone === undefined ? existe.icone : d.icone,
    }
    conferirFormato(quadro.parse(depois))

    const atualizado = await prisma.templateMomento.update({
      where: { id: existe.id },
      data: { ...depois, arquivado: d.arquivado ?? existe.arquivado },
    })
    res.json({ quadro: atualizado })
  } catch (e) {
    next(e)
  }
})

/**
 * Apagar de vez — só o que nunca foi ao ar.
 *
 * `Momento.templateId` é opcional, então apagar um quadro usado zeraria o vínculo de
 * tudo que já aconteceu (`SetNull`) e a história perderia a cor e o ícone daquele
 * quadro, em silêncio. Quadro que já foi ao ar se arquiva; o botão de apagar existe para
 * o rascunho criado errado há dois minutos.
 */
rotasBiblioteca.delete('/quadros/:id', exigirOperador(...OPERA_BIBLIOTECA), async (req, res, next) => {
  try {
    const existe = await prisma.templateMomento.findFirst({
      where: { id: req.params.id! },
      include: { _count: { select: { momentos: true } } },
    })
    if (!existe) throw erros.naoEncontrado('Quadro')

    if (existe._count.momentos > 0) {
      throw new ErroDaApi(409, 'quadro_com_historia',
        `"${existe.nome}" já foi ao ar ${existe._count.momentos} ${existe._count.momentos === 1 ? 'vez' : 'vezes'}. ` +
        'Arquive em vez de apagar: assim ele sai da vitrine sem apagar o que aconteceu.')
    }

    await prisma.templateMomento.delete({ where: { id: existe.id } })
    res.json({ apagado: true })
  } catch (e) {
    next(e)
  }
})
