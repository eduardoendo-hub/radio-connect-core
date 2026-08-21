import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Todo método que as rotas usam está liberado no CORS.
 *
 * **Este defeito já aconteceu três vezes e nunca deu erro.** Faltou `If-None-Match` e o
 * aplicativo mostrou "sem conexão" com a rede perfeita; faltou `X-Nome-Arquivo` e o envio
 * de imagem do Studio nunca chegou ao servidor; faltou `PUT` e a régua de engajamento não
 * salvava. Nas três, o navegador barra no preflight e o `fetch` falha antes de sair — não
 * há erro de compilação, não há teste que quebre, não há linha de log. Há silêncio, e uma
 * tela que não faz nada.
 *
 * O teste lê os métodos que os arquivos de rota realmente registram e compara com a lista
 * do cabeçalho. É grosseiro de propósito: não precisa de servidor no ar, não precisa de
 * banco, e falha na hora em que alguém escreve a primeira rota de um método novo.
 */

// `fileURLToPath` e não `.pathname`: o caminho deste projeto tem espaço e til, e a
// URL os entrega percent-encoded — "Radio%20Connect" não existe no disco.
const raiz = fileURLToPath(new URL('../', import.meta.url))

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name)
    if (e.isDirectory()) return arquivos(caminho)
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [caminho] : []
  })
}

test('todo método usado nas rotas está liberado no CORS', () => {
  const servidor = readFileSync(join(raiz, 'server.ts'), 'utf8')
  const cabecalho = servidor.match(/'Access-Control-Allow-Methods',\s*\n?\s*'([^']+)'/)
  assert.ok(cabecalho, 'não achei o cabeçalho Access-Control-Allow-Methods em server.ts')

  const liberados = new Set(cabecalho![1]!.split(',').map((m) => m.trim().toUpperCase()))

  const usados = new Set<string>()
  for (const arquivo of arquivos(raiz)) {
    const fonte = readFileSync(arquivo, 'utf8')
    for (const [, metodo] of fonte.matchAll(/\brotas\w*\.(get|post|put|patch|delete)\s*\(/g)) {
      usados.add(metodo.toUpperCase())
    }
  }

  assert.ok(usados.size > 0, 'não achei rota nenhuma — o teste ficaria verde à toa')

  const faltando = [...usados].filter((m) => !liberados.has(m)).sort()
  assert.deepEqual(
    faltando,
    [],
    `Estes métodos são usados nas rotas mas o navegador vai barrá-los no preflight: ${faltando.join(', ')}`,
  )
})
