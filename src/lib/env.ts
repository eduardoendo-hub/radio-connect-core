import 'dotenv/config'
import { z } from 'zod'

/**
 * Configuração validada na partida.
 *
 * Se faltar algo essencial, o processo morre aqui — com a mensagem certa — em vez de
 * quebrar na primeira requisição de um ouvinte.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().default('America/Sao_Paulo'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatória'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  // Longa de propósito: o cadastro é obrigatório uma vez só, e nada é mais frustrante
  // que ser deslogado de um app de rádio que se usa todo dia.
  JWT_OUVINTE_EXPIRA: z.string().default('180d'),
  JWT_OPERADOR_EXPIRA: z.string().default('12h'),

  // De quanto em quanto tempo o agendador reavalia a programação de cada emissora.
  NO_AR_INTERVALO_SEGUNDOS: z.coerce.number().int().positive().default(15),
  // Janela em que um ouvinte conta como "vivendo este momento".
  PRESENCA_TTL_SEGUNDOS: z.coerce.number().int().positive().default(90),

  // Se a decisão de anúncio não responder nesse tempo, o app desiste e abre a rádio.
  // Nunca fazer o ouvinte esperar por publicidade que não veio.
  AD_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  /**
   * Origens de navegador autorizadas.
   *
   * O Studio sempre precisou disso. O app do ouvinte também passa a precisar enquanto
   * roda como web — quando virar pacote nativo, deixa de ser navegador e o CORS some
   * do caminho. Manter as duas coisas na mesma lista evita esquecer uma delas.
   */
  STUDIO_ORIGINS: z.string().default(''),

  // Vazio = modo demonstração: o código de verificação é sempre 000000 e sai no log.
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
})

const resultado = esquema.safeParse(process.env)

if (!resultado.success) {
  const problemas = resultado.error.issues
    .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  console.error(`\nConfiguração inválida:\n${problemas}\n`)
  process.exit(1)
}

export const env = resultado.data

export const ehDesenvolvimento = env.NODE_ENV === 'development'

/** Origens autorizadas a chamar a API a partir de um navegador. */
export const origensStudio = env.STUDIO_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/** Sem gateway de SMS configurado, o login roda em modo demonstração. */
export const smsEmModoDemo = !env.SMS_API_URL || !env.SMS_API_KEY
