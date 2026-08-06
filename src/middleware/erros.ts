import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { ErroDaApi, erros } from '../lib/erros.js'
import { log } from '../lib/log.js'
import { ehDesenvolvimento } from '../lib/env.js'

export function rotaNaoEncontrada(_req: Request, _res: Response, next: NextFunction) {
  next(erros.naoEncontrado('Recurso'))
}

export function tratarErros(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let erro: ErroDaApi

  if (err instanceof ErroDaApi) {
    erro = err
  } else if (err instanceof ZodError) {
    erro = erros.dadosInvalidos(err.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })))
  } else {
    erro = erros.interno()
    log.error({ err, rota: req.originalUrl, emissora: req.emissora?.slug }, 'erro nao tratado')
  }

  // Erro do cliente é informação; erro do servidor é alarme. Separar evita que o log
  // vire ruído e que o alarme de verdade passe despercebido.
  if (erro.status >= 500 && !(err instanceof ErroDaApi)) {
    // já registrado acima
  } else if (erro.status >= 500) {
    log.error({ err, rota: req.originalUrl }, erro.codigo)
  }

  res.status(erro.status).json({
    erro: erro.codigo,
    mensagem: erro.mensagem,
    ...(erro.detalhe ? { detalhe: erro.detalhe } : {}),
    ...(ehDesenvolvimento && erro.status >= 500 ? { pilha: (err as Error)?.stack } : {}),
  })
}
