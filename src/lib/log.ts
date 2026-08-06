import pino from 'pino'
import { env, ehDesenvolvimento } from './env.js'

export const log = pino({
  level: env.LOG_LEVEL,
  ...(ehDesenvolvimento
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
  // Nunca deixar segredo vazar para o log — vale mais do que parece num sistema
  // multi-tenant, onde o log é lido por gente que não deveria ver dado de emissora.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'senha',
      'senhaHash',
      '*.senha',
      '*.token',
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
    ],
    censor: '[oculto]',
  },
})
