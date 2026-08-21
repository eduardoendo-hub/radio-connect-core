/**
 * O dia de hoje no fuso em que a rádio vive, como "2026-08-21".
 *
 * **Rádio tem dia, não tem UTC.** Quem ouve às onze da noite em São Paulo está no mesmo
 * dia de quem ouviu de manhã — e em UTC já é amanhã. Sem isto, uma noite de segunda
 * contaria como terça, e "voltou em quatro dias desta semana" viraria ficção com
 * aparência de dado.
 *
 * É a terceira vez que fuso horário morde este produto: primeiro os horários do
 * aplicativo três horas à frente, depois a idade calculada a partir de meia-noite UTC.
 * As duas vezes o defeito não deu erro nenhum — só um número errado na tela.
 *
 * Vive aqui, e não junto do Prisma, porque é uma função pura: assim o teste roda sem
 * banco e sem variável de ambiente.
 */
export function diaLocal(quando = new Date(), fuso = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(quando)
}
