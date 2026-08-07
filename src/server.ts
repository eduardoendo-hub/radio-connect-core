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
import { rotasChat, rotasChatStudio } from './modules/chat/rotas.js'
import { rotasMidia, rotasMidiaPublica } from './modules/midia/rotas.js'
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
    // `If-None-Match` precisa estar aqui: sem ele o navegador barra no preflight toda
    // consulta condicional, e o Estado No Ar — que é justamente quem usa ETag para
    // responder 304 — só funcionava na primeira chamada. Da segunda em diante o app
    // caía no ramo de erro e mostrava "sem conexão" com a rede perfeita.
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Tenant, X-App-Version, X-Platform, If-None-Match',
    )
    // E o ETag precisa ser legível pelo JavaScript: por padrão o navegador esconde
    // tudo que não seja um punhado de cabeçalhos simples.
    res.setHeader('Access-Control-Expose-Headers', 'ETag')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    // Sem isso o navegador refaz o preflight a cada consulta — e o No Ar consulta a
    // cada dois segundos.
    res.setHeader('Access-Control-Max-Age', '86400')
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
v1.use('/conversa', rotasChat)
// As rotas de chat da produção moram sob /studio junto com o resto da operação.
v1.use('/studio', rotasChatStudio)
v1.use('/studio', rotasMidia)
// A entrega da imagem não passa por autenticação nem por tenant: quem pede é uma tag
// <img>, que não manda token nem cabeçalho. O id é um cuid, não enumerável.
v1.use('/midia', rotasMidiaPublica)
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
