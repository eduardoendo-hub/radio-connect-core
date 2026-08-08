import { Router } from 'express'
import express from 'express'
import { prisma, prismaSemEscopo } from '../../lib/prisma.js'
import { erros, ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'

/**
 * Envio e entrega de imagens.
 *
 * A produção não tem onde hospedar arquivo. Pedir uma URL era pedir que alguém subisse a
 * foto em outro lugar antes — no meio de um programa ao vivo, com o gancho já pensado,
 * isso simplesmente não acontece. Quem opera precisa escolher a foto do computador e
 * seguir.
 *
 * O que aceita: JPEG, PNG e WebP, até 4 MB. O corpo chega cru (`application/octet-stream`)
 * em vez de multipart, porque um formulário multipart traria uma dependência a mais para
 * transportar exatamente um arquivo — e o navegador manda `fetch(file)` sem nenhuma
 * ajuda.
 */

export const rotasMidia = Router()
export const rotasMidiaPublica = Router()

// Imagem para banner e foto; áudio para o pré-roll. O pré-roll é curto por natureza —
// dez, quinze segundos — e não justifica um caminho de upload próprio.
const TIPOS = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a',
])
const TETO = 6 * 1024 * 1024

const PAPEIS = ['PRODUTOR', 'MARKETING', 'DIRETOR', 'ADMIN'] as const

rotasMidia.post(
  '/imagens',
  exigirOperador(...PAPEIS),
  express.raw({ type: () => true, limit: TETO }),
  async (req, res, next) => {
    try {
      const tipo = String(req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
      if (!TIPOS.has(tipo)) {
        throw new ErroDaApi(415, 'formato_nao_aceito',
          'Envie imagem em JPEG, PNG ou WebP, ou áudio em MP3 ou M4A.')
      }

      const dados = req.body as Buffer
      if (!Buffer.isBuffer(dados) || dados.length === 0) {
        throw new ErroDaApi(400, 'arquivo_vazio', 'O arquivo chegou vazio.')
      }
      if (dados.length > TETO) {
        throw new ErroDaApi(413, 'arquivo_grande',
          'O arquivo passa de 6 MB. Diminua antes de enviar.')
      }

      const s = req.sessao as { operadorId: string }
      const nome = String(req.headers['x-nome-arquivo'] ?? 'imagem').slice(0, 120)

      const arquivo = await prisma.arquivo.create({
        data: {
          emissoraId: req.emissora!.id,
          nome,
          tipoMime: tipo,
          bytes: dados.length,
          dados,
          criadoPorId: s.operadorId,
        },
        select: { id: true, bytes: true },
      })

      // A URL é absoluta porque quem consome está em outro domínio — o app e o Studio
      // vivem separados da API.
      res.status(201).json({
        id: arquivo.id,
        url: `${req.protocol}://${req.get('host')}/v1/midia/${arquivo.id}`,
        bytes: arquivo.bytes,
      })
    } catch (e) {
      next(e)
    }
  },
)

/**
 * Entrega da imagem.
 *
 * Fica fora do escopo de emissora de propósito: quem pede é uma tag `<img>`, sem token e
 * sem cabeçalho de tenant. O `id` é um cuid — não enumerável — e o conteúdo é uma foto
 * que já está publicada para os ouvintes daquela rádio.
 *
 * Cache longo e imutável: o id nunca aponta para outra imagem, então o navegador pode
 * guardar para sempre.
 */
rotasMidiaPublica.get('/:id', async (req, res, next) => {
  try {
    const arquivo = await prismaSemEscopo.arquivo.findUnique({
      where: { id: req.params.id },
      select: { dados: true, tipoMime: true, bytes: true },
    })
    if (!arquivo) throw erros.naoEncontrado('Imagem')

    res.setHeader('Content-Type', arquivo.tipoMime)
    res.setHeader('Content-Length', String(arquivo.bytes))
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(arquivo.dados)
  } catch (e) {
    next(e)
  }
})
