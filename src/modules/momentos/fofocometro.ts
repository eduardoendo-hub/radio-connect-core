/**
 * Fofocômetro — gancho agora, revelação com hora marcada.
 *
 * É o primeiro formato do produto que pede **espera** em vez de resposta. Todos os
 * outros Momentos perguntam algo e fecham em segundos; este abre uma curiosidade e
 * cobra o retorno da pessoa mais tarde. É o "depois do intervalo a gente conta" da
 * rádio, que é o instrumento de retenção mais antigo do meio.
 *
 * ## O que fica no `config`
 *
 * ```json
 * {
 *   "revelarEm": "2026-08-07T20:30:00.000Z",
 *   "revelacao": { "texto": "...", "imagemUrl": "..." },
 *   "fonte": "coluna do Leo Dias"
 * }
 * ```
 *
 * ## A regra que sustenta o formato inteiro
 *
 * **A revelação nunca sai do servidor antes da hora.** Mandar o objeto completo e
 * esconder a parte de baixo no aplicativo entregaria a fofoca para qualquer pessoa que
 * abrisse a aba de rede do navegador — e um formato cuja graça é ninguém saber antes
 * não sobrevive a isso. Aqui é estrutura, não confiança no cliente.
 *
 * ## Por que a revelação é obrigatória na criação
 *
 * Publicar "vou contar" sem ter escrito o quê é a receita do Fofocômetro furado: o
 * relógio zera e não tem nada do outro lado. Um furo desses ensina a audiência a não
 * esperar o próximo — o custo não é daquele Momento, é do formato. Por isso a
 * validação exige o texto **antes** de o gancho ir ao ar.
 */

export type ConfigFofocometro = {
  revelarEm: string
  revelacao: { texto: string; imagemUrl?: string | null }
  /** De onde veio a informação. Não aparece para o ouvinte: é rastro editorial. */
  fonte?: string | null
  /**
   * Quem paga a espera.
   *
   * O Fofocômetro é o inventário mais valioso do produto: enquanto o relógio corre, a
   * tela é da marca e a pessoa está esperando de propósito. É atenção com hora marcada,
   * que vale mais do que qualquer banner de rolagem — e por isso a assinatura fica
   * durante a contagem, não depois dela.
   */
  patrocinador?: { nome: string; logoUrl?: string | null } | null
}

export function ehFofocometro(tipo: string): boolean {
  return tipo === 'FOFOCOMETRO'
}

export function jaRevelou(config: unknown, agora = new Date()): boolean {
  const c = config as ConfigFofocometro | null
  if (!c?.revelarEm) return false
  const quando = new Date(c.revelarEm)
  return !Number.isNaN(quando.getTime()) && quando <= agora
}

/**
 * O que o ouvinte pode ver deste Momento, agora.
 *
 * Antes da hora: o gancho, o instante da revelação e nada mais. Depois: a revelação
 * inteira. `fonte` nunca sai — é para a emissora se defender, não para publicar.
 */
export function paraOOuvinte(momento: { tipo: string; config: unknown }, agora = new Date()) {
  if (!ehFofocometro(momento.tipo)) return momento.config ?? {}

  const c = (momento.config ?? {}) as ConfigFofocometro
  const revelado = jaRevelou(c, agora)

  return {
    revelarEm: c.revelarEm ?? null,
    revelado,
    // O patrocinador é público desde o primeiro segundo: é justamente durante a espera
    // que ele foi comprado.
    patrocinador: c.patrocinador ?? null,
    // Só existe no objeto depois da hora. Não é `null` escondido: a chave nem vem.
    ...(revelado ? { revelacao: c.revelacao } : {}),
  }
}

/** Erros de criação, em português e ditos de uma vez. */
export function conferirAntesDePublicar(c: Partial<ConfigFofocometro>): string[] {
  const problemas: string[] = []

  if (!c.revelacao?.texto?.trim()) {
    problemas.push('Escreva a revelação. O gancho não vai ao ar sem ela.')
  }
  if (!c.revelarEm) {
    problemas.push('Escolha quando revelar.')
  } else {
    const quando = new Date(c.revelarEm)
    if (Number.isNaN(quando.getTime())) {
      problemas.push('A hora da revelação não é válida.')
    } else {
      const faltam = (quando.getTime() - Date.now()) / 1000
      // Menos de meio minuto não dá tempo de ninguém ver o gancho — o formato precisa
      // da espera para existir.
      if (faltam < 30) problemas.push('A revelação precisa ser daqui a pelo menos 30 segundos.')
      // Mais de duas horas e a edição já acabou; a curiosidade também.
      if (faltam > 2 * 60 * 60) problemas.push('A revelação precisa acontecer em até 2 horas.')
    }
  }

  return problemas
}
