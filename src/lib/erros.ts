/**
 * Erros com mensagem para o usuário final.
 *
 * O capítulo dos Momentos é explícito: "o usuário não deve ver termos técnicos".
 * Então todo erro que chega ao app carrega uma frase que uma pessoa entende —
 * "Este Momento acabou de terminar", não "MOMENT_EXPIRED".
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    /** O que o app mostra. Em português, sem jargão. */
    readonly mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem)
    this.name = 'ErroDaApi'
  }
}

export const erros = {
  naoAutenticado: () =>
    new ErroDaApi(401, 'nao_autenticado', 'Sua sessão expirou. Entre novamente.'),

  semPermissao: () =>
    new ErroDaApi(403, 'sem_permissao', 'Você não tem acesso a esta área.'),

  emissoraNaoEncontrada: () =>
    new ErroDaApi(404, 'emissora_nao_encontrada', 'Rádio não encontrada.'),

  naoEncontrado: (o = 'Conteúdo') =>
    new ErroDaApi(404, 'nao_encontrado', `${o} não encontrado.`),

  momentoEncerrado: () =>
    new ErroDaApi(409, 'momento_encerrado', 'Este Momento acabou de terminar.'),

  jaParticipou: () =>
    new ErroDaApi(409, 'ja_participou', 'Você já participou deste Momento.'),

  dadosInvalidos: (detalhe?: unknown) =>
    new ErroDaApi(422, 'dados_invalidos', 'Não conseguimos entender esses dados.', detalhe),

  muitasTentativas: () =>
    new ErroDaApi(429, 'muitas_tentativas', 'Muitas tentativas. Aguarde um instante.'),

  interno: () =>
    new ErroDaApi(500, 'erro_interno', 'Não conseguimos registrar agora. Tente novamente.'),
}
