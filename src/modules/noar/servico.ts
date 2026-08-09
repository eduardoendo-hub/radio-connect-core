import { prisma } from '../../lib/prisma.js'
import { ehFofocometro, jaRevelou } from '../momentos/fofocometro.js'
import { identidadeDe, patrocinioDe, incluirApresentacao, type Identidade, type Patrocinio } from '../momentos/apresentacao.js'
import { redis, redisPub, chaves } from '../../lib/redis.js'
import { env } from '../../lib/env.js'

/**
 * ESTADO NO AR
 *
 * A leitura mais quente do sistema: todo mundo que abre o app pergunta a mesma coisa.
 *
 * O Postgres continua sendo a verdade; isto aqui é uma projeção materializada no Redis,
 * recalculada por evento e não por consulta. Uma leitura de cache por abertura de app,
 * em vez de meia dúzia de junções.
 *
 * A `versao` existe para o app saber se mudou alguma coisa sem baixar o estado inteiro.
 */

export type EstadoNoAr = {
  emissora: { slug: string; nome: string }
  aoVivo: boolean
  programa: { id: string; nome: string; imagemUrl: string | null; corDestaque: string | null } | null
  locutor: { id: string; nome: string; imagemUrl: string | null } | null
  /// Quem mais está no microfone. O titular vem em `locutor`; aqui vem a equipe
  /// inteira, na ordem em que a rádio escala — inclusive ele.
  equipe: { id: string; nome: string; imagemUrl: string | null }[]
  edicaoId: string | null
  /**
   * Quem oferece o programa que está no ar.
   *
   * Vem separado do patrocínio do Momento de propósito. São inventários diferentes:
   * o do programa é permanente e barato por hora, o do Momento é pontual e caro por
   * minuto. Quem decide qual dos dois aparece é o app — ver a regra ali.
   */
  patrocinioDoPrograma: { nome: string; logoUrl: string | null } | null
  /// Se este horário aceita publicidade. Ver `Programa.anunciosAtivos`.
  anunciosAtivos: boolean
  termina: string | null
  momento: {
    id: string
    tipo: string
    titulo: string
    texto: string | null
    imagemUrl: string | null
    terminaEm: string
    opcoes: { id: string; rotulo: string; emoji: string | null }[]
    patrocinada: boolean
    /// A identidade do quadro, quando ele tem uma. A maioria não tem — e é isso que
    /// faz os poucos que têm se destacarem.
    identidade: Identidade
    /// Quem assina este Momento. Vale para qualquer formato, não só o Fofocômetro.
    patrocinio: Patrocinio
    /// Só no Fofocômetro. A revelação **não** vem aqui: o Estado No Ar é o mesmo para
    /// toda a emissora e fica em cache, então o que trafegasse por ele estaria
    /// disponível para qualquer um antes da hora. Aqui vai só o instante da abertura —
    /// o aplicativo conta o tempo e busca a revelação quando ele zera.
    fofoca: {
      revelarEm: string | null
      revelado: boolean
      patrocinador: { nome: string; logoUrl: string | null } | null
    } | null
  } | null
  /**
   * A promoção no ar.
   *
   * Leva mais do que o título porque agora ela é o bloco principal da tela, e não uma
   * linha de lista: a arte, a chamada e a hora do sorteio são o que fazem a pessoa
   * parar. O que NÃO vem aqui é se esta pessoa já se inscreveu — o Estado No Ar é o
   * mesmo para toda a emissora e fica em cache; isso viria errado para todo mundo.
   */
  promocao: {
    id: string
    titulo: string
    descricao: string | null
    imagemUrl: string | null
    seloUrl: string | null
    sorteioEm: string | null
    /// O contemplado, quando já houve sorteio. Nome encurtado — ver `rotas.ts`.
    resultado: string | null
    patrocinio: Patrocinio
  } | null
  proxima: { nome: string; comeca: string } | null
  ouvintes: number
  versao: number
  calculadoEm: string
}

/**
 * "Eduardo Endo" → "Eduardo E."
 *
 * A mesma regra das rotas do ouvinte, e pelo mesmo motivo: no ar vai o nome inteiro,
 * na tela vai o suficiente para a pessoa se reconhecer. Ver `promocoes/rotas.ts`.
 */
function encurtarNome(nome: string | null) {
  if (!nome) return null
  const partes = nome.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]!
  return `${partes[0]} ${partes[partes.length - 1]![0]!.toUpperCase()}.`
}

/** O que o bloco da promoção precisa desenhar. Usado nas duas consultas. */
const CAMPOS_DA_PROMOCAO = {
  id: true, titulo: true, descricao: true, imagemUrl: true, seloUrl: true,
  sorteioEm: true, resultado: true,
  campanhaPatrocinadora: {
    select: {
      anunciante: { select: { nome: true } },
      criativos: { select: { tipo: true, url: true } },
    },
  },
} as const

/** Monta o estado a partir do banco. Chamado só quando algo muda. */
export async function calcular(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const agora = new Date()

  const edicao = await prisma.edicao.findFirst({
    where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
    orderBy: { inicioEm: 'desc' },
    include: {
      programa: {
        select: {
          id: true, nome: true, imagemUrl: true, corDestaque: true,
          anunciosAtivos: true,
          equipe: { select: { id: true, nome: true, imagemUrl: true } },
          campanhaPatrocinadora: {
            select: {
              status: true, inicioEm: true, fimEm: true,
              anunciante: { select: { nome: true } },
              criativos: { select: { tipo: true, url: true } },
            },
          },
        },
      },
      locutor: { select: { id: true, nome: true, imagemUrl: true } },
    },
  })

  const momento = edicao
    ? await prisma.momento.findFirst({
        where: { edicaoId: edicao.id, estado: 'ATIVO', inicioEm: { lte: agora }, fimEm: { gte: agora } },
        orderBy: { inicioEm: 'desc' },
        include: {
          opcoes: { orderBy: { ordem: 'asc' }, select: { id: true, rotulo: true, emoji: true } },
          ...incluirApresentacao,
        },
      })
    : null

  // A promoção sai do bloco principal duas horas depois do sorteio, não no instante em
  // que o locutor diz o nome.
  //
  // O sorteio é o momento que a promoção inteira existiu para chegar. Se ela sumisse
  // junto com o resultado, quem estava ouvindo abriria o aplicativo para ver quem
  // ganhou e encontraria uma tela sem nada — a rádio teria criado uma expectativa e
  // apagado a resposta. Duas horas é o tempo em que ainda se fala do assunto.
  //
  // **A promoção ativa sempre ganha da sorteada**, e isso é uma consulta separada e não
  // uma ordenação.
  //
  // Eu tinha juntado as duas num `OR` ordenado por data de início, supondo que a que
  // está no ar sempre começou depois da que já foi sorteada. É falso: uma promoção
  // criada hoje e sorteada em seguida começou *depois* da que está no ar há uma hora —
  // e o bloco principal passou a mostrar um resultado velho no lugar da promoção viva.
  // Só apareceu porque eu fui olhar.
  const doisAtras = new Date(agora.getTime() - 2 * 60 * 60 * 1000)
  const promocao =
    (await prisma.promocao.findFirst({
      where: { inicioEm: { lte: agora }, fimEm: { gte: agora } },
      orderBy: { inicioEm: 'desc' },
      select: CAMPOS_DA_PROMOCAO,
    })) ??
    (await prisma.promocao.findFirst({
      where: { resultado: { not: null }, fimEm: { gte: doisAtras, lte: agora } },
      orderBy: { fimEm: 'desc' },
      select: CAMPOS_DA_PROMOCAO,
    }))


  const proxima = await prisma.edicao.findFirst({
    where: { inicioEm: { gt: agora } },
    orderBy: { inicioEm: 'asc' },
    include: { programa: { select: { nome: true } } },
  })

  const ouvintes = await contarPresenca(emissora.id)
  const versao = Number(await redis.incr(chaves.noArVersao(emissora.id)))

  return {
    emissora: { slug: emissora.slug, nome: emissora.nome },
    aoVivo: Boolean(edicao),
    programa: edicao
      ? {
          id: edicao.programa.id,
          nome: edicao.programa.nome,
          imagemUrl: edicao.programa.imagemUrl,
          corDestaque: edicao.programa.corDestaque,
        }
      : null,
    locutor: edicao?.locutor ?? null,
    // O titular abre a lista: "A Hora do Ronco, com Tadeu, Emerson e Pedro Luiz" —
    // quem assina vem primeiro, sempre.
    equipe: edicao
      ? [
          ...(edicao.locutor ? [edicao.locutor] : []),
          ...(edicao.programa?.equipe ?? []).filter((p) => p.id !== edicao.locutorId),
        ]
      : [],
    edicaoId: edicao?.id ?? null,
    // A vigência é conferida aqui, e não só na hora de escolher a campanha no Studio.
    // O Estado No Ar fica em cache e o programa vai ao ar todo dia: sem esta checagem,
    // uma campanha que venceu ontem continuaria assinando o programa hoje.
    patrocinioDoPrograma: (() => {
      const c = edicao?.programa.campanhaPatrocinadora
      if (!c || c.status !== 'ATIVA' || c.inicioEm > agora || c.fimEm < agora) return null
      return {
        nome: c.anunciante.nome,
        logoUrl: c.criativos.find((k) => k.tipo === 'imagem')?.url ?? null,
      }
    })(),
    anunciosAtivos: edicao?.programa.anunciosAtivos ?? true,
    termina: edicao?.fimEm.toISOString() ?? null,
    momento: momento
      ? {
          id: momento.id,
          tipo: momento.tipo,
          titulo: momento.titulo,
          texto: momento.texto,
          imagemUrl: momento.imagemUrl,
          terminaEm: momento.fimEm.toISOString(),
          opcoes: momento.opcoes,
          patrocinada: Boolean(momento.campanhaPatrocinadoraId),
          identidade: identidadeDe(momento),
          patrocinio: patrocinioDe(momento),
          // O que o ouvinte pode ver do Fofocômetro agora — a revelação nunca entra
          // aqui, mas o patrocinador sim: ele comprou justamente a espera.
          //
          // Este objeto é montado à mão em vez de reaproveitar `paraOOuvinte` porque o
          // Estado No Ar tem contrato próprio e versionado. O preço de duplicar é
          // exatamente este: um campo novo precisa ser lembrado nos dois lugares, e o
          // patrocinador foi esquecido aqui na primeira vez.
          fofoca: ehFofocometro(momento.tipo)
            ? {
                revelarEm: (momento.config as { revelarEm?: string } | null)?.revelarEm ?? null,
                revelado: jaRevelou(momento.config, agora),
                patrocinador:
                  (momento.config as {
                    patrocinador?: { nome: string; logoUrl: string | null }
                  } | null)?.patrocinador ?? null,
              }
            : null,
        }
      : null,
    promocao: promocao
      ? {
          id: promocao.id,
          titulo: promocao.titulo,
          descricao: promocao.descricao,
          imagemUrl: promocao.imagemUrl,
          seloUrl: promocao.seloUrl,
          sorteioEm: promocao.sorteioEm?.toISOString() ?? null,
          resultado: encurtarNome(promocao.resultado),
          patrocinio: patrocinioDe(promocao),
        }
      : null,
    proxima: proxima ? { nome: proxima.titulo ?? proxima.programa.nome, comeca: proxima.inicioEm.toISOString() } : null,
    ouvintes,
    versao,
    calculadoEm: agora.toISOString(),
  }
}

/** Recalcula, guarda no cache e avisa quem estiver ouvindo. */
export async function recalcular(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const estado = await calcular(emissora)
  await redis.set(chaves.noAr(emissora.id), JSON.stringify(estado), 'EX', 300)
  await redisPub.publish(chaves.canalNoAr(emissora.id), JSON.stringify(estado))
  return estado
}

/**
 * Lê do cache; se não houver, reconstrói.
 *
 * Se o Redis cair, isto continua funcionando pelo Postgres — mais lento, mas de pé.
 * É o que sustenta a promessa de degradação elegante do capítulo do No Ar.
 */
export async function obter(emissora: { id: string; slug: string; nome: string }): Promise<EstadoNoAr> {
  const bruto = await redis.get(chaves.noAr(emissora.id)).catch(() => null)
  if (bruto) {
    try {
      const estado = JSON.parse(bruto) as EstadoNoAr
      // A contagem de ouvintes muda o tempo todo e não vale recalcular o estado inteiro.
      estado.ouvintes = await contarPresenca(emissora.id)
      return estado
    } catch {
      /* cache corrompido: recalcula */
    }
  }
  return recalcular(emissora)
}

/**
 * "15.432 ouvintes vivendo este momento."
 *
 * Contagem aproximada de propósito: precisa ser verossímil e estável, não exata. Um
 * número que oscila loucamente destrói a sensação de coletivo que o capítulo quer criar.
 */
export async function marcarPresenca(emissoraId: string, ouvinteId: string): Promise<void> {
  const chave = chaves.presenca(emissoraId)
  const agora = Date.now()
  await redis.zadd(chave, agora, ouvinteId)
  await redis.expire(chave, env.PRESENCA_TTL_SEGUNDOS * 4)
}

export async function contarPresenca(emissoraId: string): Promise<number> {
  const chave = chaves.presenca(emissoraId)
  const limite = Date.now() - env.PRESENCA_TTL_SEGUNDOS * 1000
  await redis.zremrangebyscore(chave, 0, limite).catch(() => 0)
  return redis.zcard(chave).catch(() => 0)
}
