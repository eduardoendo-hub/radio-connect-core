/**
 * Modelos que carregam `emissoraId` e são escopados automaticamente pelo Prisma.
 *
 * Fica em módulo próprio, sem nenhuma dependência, por dois motivos: o teste que protege
 * esta lista não precisa de banco nem de configuração para rodar, e a lista fica onde é
 * fácil de achar quando alguém adicionar um modelo novo.
 *
 * Os modelos de fora — OpcaoMomento, RespostaMomento, SnapshotConexao, Reconhecimento,
 * BeneficioConcedido, ParticipacaoPromocao e Criativo — são filhos: só se chega neles
 * através do pai, que já está escopado. Repetir `emissoraId` ali seria desnormalização
 * sem ganho de segurança.
 */
export const MODELOS_ESCOPADOS = new Set([
  'Programa',
  'Locutor',
  'SlotGrade',
  'Edicao',
  'Momento',
  'TemplateMomento',
  'Ouvinte',
  'Promocao',
  'Push',
  'Anunciante',
  'Campanha',
  'Conversa',
  'Mensagem',
  'Operador',
  'Evento',
  'ImpressaoAnuncio',
  'Beneficio',
])
