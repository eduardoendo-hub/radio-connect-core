import express from 'express'
import { env, origensStudio } from './lib/env.js'
import { log } from './lib/log.js'
import { conectarBanco, desconectarBanco, prismaSemEscopo } from './lib/prisma.js'
import { redis, desconectarRedis } from './lib/redis.js'
import { rotaNaoEncontrada, tratarErros } from './middleware/erros.js'
import { exigirEmissora } from './middleware/tenant.js'
import { rotasAuth } from './modules/auth/rotas.js'
import { rotasNoAr } from './modules/noar/rotas.js'
import { rotasMomentos } from './modules/momentos/rotas.js'
import { rotasStudio } from './modules/studio/rotas.js'
import { iniciarAgendador, pararAgendador } from './modules/noar/agendador.js'

const app = express()

app.disable('x-powered-by')
// Atrás do proxy do Coolify: sem isso o IP do ouvinte vira o do proxy, e a limitação
// de tentativas passa a contar todo mundo como uma pessoa só.
app.set('trust proxy', 1)

app.use(express.json({ limit: '512kb' }))

// CORS para as origens de navegador: o Studio e, enquanto o app roda como web,
// também ele. Compilado como pacote nativo o app deixa de ser navegador e o
// cabeçalho passa a ser irrelevante — mas a lista continua servindo ao Studio.
app.use((req, res, next) => {
  const origem = req.headers.origin
  if (origem && origensStudio.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant, X-App-Version, X-Platform')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

/**
 * Saúde — sem versão de propósito.
 *
 * O Coolify e o monitoramento precisam de um endereço que nunca mude, mesmo quando a
 * API estiver na /v3.
 */
app.get('/saude', async (_req, res) => {
  const inicio = Date.now()
  const [banco, cache] = await Promise.allSettled([
    prismaSemEscopo.$queryRaw`SELECT 1`,
    redis.ping(),
  ])
  const ok = banco.status === 'fulfilled' && cache.status === 'fulfilled'
  res.status(ok ? 200 : 503).json({
    ok,
    servico: 'radio-connect-core',
    banco: banco.status === 'fulfilled' ? 'ok' : 'fora',
    redis: cache.status === 'fulfilled' ? 'ok' : 'fora',
    ms: Date.now() - inicio,
  })
})

/**
 * A API é versionada no caminho, e a razão é específica deste produto: quem publica o
 * app é a rádio, e ela pode simplesmente não publicar. Vamos conviver com versões
 * antigas em campo por tempo indeterminado.
 *
 * Dentro de uma versão, só se ACRESCENTA campo opcional. Nunca remover, nunca renomear,
 * nunca mudar significado. Se precisa quebrar, é /v2.
 */
const v1 = express.Router()
v1.get('/', (_req, res) => res.json({ versao: 'v1', servico: 'radio-connect-core' }))

// Tudo abaixo pertence a uma emissora. O middleware resolve o tenant e prende a
// requisição inteira ao escopo dele — nenhuma consulta consegue ver outra rádio.
v1.use(exigirEmissora())
v1.use('/auth', rotasAuth)
v1.use('/no-ar', rotasNoAr)
v1.use('/momentos', rotasMomentos)
v1.use('/studio', rotasStudio)

app.use('/v1', v1)

app.use(rotaNaoEncontrada)
app.use(tratarErros)

const servidor = app.listen(env.PORT, () => {
  log.info({ porta: env.PORT, ambiente: env.NODE_ENV, tz: env.TZ }, 'radio-connect-core no ar')
})

async function encerrar(sinal: string) {
  log.info({ sinal }, 'encerrando')
  pararAgendador()
  servidor.close()
  await Promise.allSettled([desconectarBanco(), desconectarRedis()])
  process.exit(0)
}

process.on('SIGTERM', () => void encerrar('SIGTERM'))
process.on('SIGINT', () => void encerrar('SIGINT'))

void conectarBanco()
  .then(() => {
    // O relógio da plataforma: encerra Momentos vencidos, publica os agendados e
    // mantém o Estado No Ar acompanhando a virada de programa.
    iniciarAgendador()
  })
  .catch((e) => {
    log.fatal({ err: e }, 'nao foi possivel conectar ao banco')
    process.exit(1)
  })

export { app }
