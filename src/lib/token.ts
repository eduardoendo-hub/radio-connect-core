import { SignJWT, jwtVerify } from 'jose'
import { env } from './env.js'

const segredo = new TextEncoder().encode(env.JWT_SECRET)

export type SessaoOuvinte = { tipo: 'ouvinte'; ouvinteId: string; emissoraId: string }
export type SessaoOperador = { tipo: 'operador'; operadorId: string; emissoraId: string; papel: string }
/// A sessão de quem opera a plataforma. Sem `emissoraId` de propósito: o tenant é
/// escolhido a cada ação, e escolher é o que diferencia esta sessão das outras.
export type SessaoPlataforma = { tipo: 'plataforma'; operadorId: string }
export type Sessao = SessaoOuvinte | SessaoOperador | SessaoPlataforma

export async function assinar(sessao: Sessao, expiraEm: string): Promise<string> {
  return new SignJWT(sessao as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('radio-connect')
    .setExpirationTime(expiraEm)
    .sign(segredo)
}

export async function verificar(token: string): Promise<Sessao | null> {
  try {
    const { payload } = await jwtVerify(token, segredo, { issuer: 'radio-connect' })
    return payload as unknown as Sessao
  } catch {
    return null
  }
}
