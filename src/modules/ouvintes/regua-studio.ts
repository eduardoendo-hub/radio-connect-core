import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { ErroDaApi } from '../../lib/erros.js'
import { exigirOperador } from '../../middleware/sessao.js'
import { invalidarCacheEmissora } from '../../middleware/tenant.js'
import { lerRegua, conferirRegua, REGUA_PADRAO } from './conexao.js'

export const rotasRegua = Router()

/**
 * A régua de engajamento, na mão da rádio.
 *
 * **A metodologia é a mesma para todas; os números são de cada uma.** Uma rádio de
 * notícia, em que a pessoa entra três vezes por dia por cinco minutos, e uma FM que fica
 * ligada a manhã inteira medem o mesmo hábito com réguas diferentes — e quem sabe qual é
 * a régua é a emissora.
 *
 * O que **não** se configura é o formato: cinco degraus, sem número, sem ranking, sem
 * contagem regressiva e sem ameaça de perda. Isso é decisão de produto. Uma régua com
 * três degraus seria desenhada errada na tela do ouvinte, em silêncio — daí a recusa.
 */

const OPERA_REGUA = ['ADMIN', 'DIRETOR'] as const

const degrau = z.object({
  rotulo: z.string().trim().min(2).max(30),
  // 90 caracteres: é o que cabe em duas linhas no telefone. Acima disso a frase vira
  // parágrafo, o cartão da conexão estica e a escada some abaixo da dobra.
  frase: z.string().trim().max(90).nullish(),
  diasNaSemana: z.number().int().min(1).max(7).nullish(),
  diasNoMes: z.number().int().min(1).max(31).nullish(),
  minutosNaSemana: z.number().int().min(1).max(10080).nullish(),
  participacoes: z.number().int().min(1).max(500).nullish(),
  diasDeCasa: z.number().int().min(1).max(3650).nullish(),
})

rotasRegua.get('/regua', exigirOperador(), async (req, res, next) => {
  try {
    const cfg = (req.emissora!.configuracao ?? {}) as Record<string, unknown>
    res.json({
      regua: lerRegua(cfg.regua),
      padrao: REGUA_PADRAO,
      personalizada: Array.isArray(cfg.regua),
    })
  } catch (e) {
    next(e)
  }
})

rotasRegua.put('/regua', exigirOperador(...OPERA_REGUA), async (req, res, next) => {
  try {
    const d = z.object({ regua: z.array(degrau).length(5) }).parse(req.body)

    // A mesma conferência que a régua de fábrica de qualquer emissora precisa passar.
    // Régua torta não quebra nada — só produz uma escada em que ninguém sobe, e o dono
    // da rádio passa semanas achando que o aplicativo não engaja.
    const problema = conferirRegua(d.regua)
    if (problema) throw new ErroDaApi(400, 'regua_invalida', problema)

    const cfg = (req.emissora!.configuracao ?? {}) as Record<string, unknown>
    await prisma.emissora.update({
      where: { id: req.emissora!.id },
      data: { configuracao: { ...cfg, regua: d.regua } },
    })

    // **Sem isto, salvar não fazia nada visível.** A emissora fica num cache de um
    // minuto — resolver o tenant é a primeira coisa de toda requisição, e ir ao banco
    // sempre seria a consulta mais frequente do sistema. O efeito era gravar certo e
    // reler a régua antiga, o que na tela vira "o botão não funciona".
    //
    // O cache é do processo: com mais de uma instância, as outras se corrigem sozinhas
    // ao fim do minuto. É a diferença entre um segundo e um minuto, não entre certo e
    // errado.
    invalidarCacheEmissora(req.emissora!.slug)

    res.json({ salva: true, regua: d.regua })
  } catch (e) {
    next(e)
  }
})
