/**
 * Como um Momento se apresenta ao ouvinte: identidade do quadro e patrocínio.
 *
 * Existe para os dois assuntos morarem num lugar só. O Estado No Ar e a listagem de
 * Momentos montam objetos diferentes, com contratos diferentes — e cada vez que um
 * campo novo apareceu, ele foi lembrado num e esquecido no outro. Aconteceu com o
 * patrocinador do Fofocômetro na semana passada.
 */

/** A identidade visual do quadro, quando ele tem uma. */
export type Identidade = { cor: string; icone: string | null } | null

/** Quem assina este Momento. */
export type Patrocinio = { nome: string; logoUrl: string | null } | null

type ComTemplate = { template?: { cor: string | null; icone: string | null } | null }
type ComCampanha = {
  campanhaPatrocinadora?: {
    anunciante: { nome: string }
    criativos?: { tipo: string; url: string }[]
  } | null
  config?: unknown
}

/**
 * **A maioria dos Momentos não tem identidade, e isso é a regra e não a falta dela.**
 *
 * Só uns poucos quadros — Fofocômetro, Batalha — carregam cor própria. Os demais usam a
 * linguagem da emissora, e é exatamente esse fundo que faz os quadros com marca se
 * destacarem. Se todos tivessem cor, nenhum se destacaria.
 */
export function identidadeDe(m: ComTemplate): Identidade {
  const cor = m.template?.cor
  if (!cor) return null
  return { cor, icone: m.template?.icone ?? null }
}

/**
 * O patrocínio vem da **relação**, não de texto solto.
 *
 * O Fofocômetro nasceu com o patrocinador dentro do `config` — atalho para ver a coisa
 * funcionando. O problema de manter assim é que texto solto não conta impressão, não
 * sabe quando a campanha vence e não fecha relatório no fim do mês. A campanha sabe as
 * três coisas.
 *
 * O `config` continua sendo lido como último recurso, para os Momentos criados antes
 * desta mudança não perderem a assinatura na tela.
 */
export function patrocinioDe(m: ComCampanha): Patrocinio {
  const campanha = m.campanhaPatrocinadora
  if (campanha) {
    const logo = campanha.criativos?.find((c) => c.tipo === 'imagem')
    return { nome: campanha.anunciante.nome, logoUrl: logo?.url ?? null }
  }

  const antigo = (m.config as { patrocinador?: { nome?: string; logoUrl?: string } } | null)
    ?.patrocinador
  if (antigo?.nome) return { nome: antigo.nome, logoUrl: antigo.logoUrl ?? null }

  return null
}

/** O que as consultas precisam trazer para as duas funções acima terem o que ler. */
export const incluirApresentacao = {
  template: { select: { cor: true, icone: true } },
  campanhaPatrocinadora: {
    select: {
      anunciante: { select: { nome: true } },
      criativos: { select: { tipo: true, url: true } },
    },
  },
} as const
