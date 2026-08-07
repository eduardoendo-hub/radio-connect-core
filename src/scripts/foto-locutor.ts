import { prismaSemEscopo as db } from '../lib/prisma.js'

/**
 * Liga a foto oficial a um locutor.
 *
 *     node dist/scripts/foto-locutor.js "Marcelo Café" /locutores/marcelo-cafe.webp
 *
 * Passar só o nome mostra a foto atual. Passar `--limpar` no lugar da URL remove a
 * foto e devolve a silhueta.
 *
 * Busca pelo nome, e não por id, porque quem vai rodar isto é gente olhando a escala
 * da emissora — não um sistema. Se o nome não for único o comando recusa, em vez de
 * escolher um por conta própria.
 */
async function main() {
  const [nome, url] = process.argv.slice(2)

  if (!nome) {
    const todos = await db.locutor.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { nome: true, imagemUrl: true },
    })
    console.log('locutores ativos:\n')
    for (const l of todos) {
      console.log(`  ${l.nome.padEnd(20)} ${l.imagemUrl ?? '— sem foto'}`)
    }
    console.log('\nuso: foto-locutor "Nome" /locutores/arquivo.webp')
    return
  }

  const achados = await db.locutor.findMany({
    where: { nome: { contains: nome, mode: 'insensitive' }, ativo: true },
    select: { id: true, nome: true, imagemUrl: true },
  })

  if (achados.length === 0) {
    console.error(`nenhum locutor ativo com "${nome}".`)
    process.exit(1)
  }
  if (achados.length > 1) {
    console.error(`"${nome}" casa com mais de um: ${achados.map((a) => a.nome).join(', ')}`)
    process.exit(1)
  }

  const locutor = achados[0]!
  if (!url) {
    console.log(`${locutor.nome}: ${locutor.imagemUrl ?? 'sem foto'}`)
    return
  }

  const nova = url === '--limpar' ? null : url
  await db.locutor.update({ where: { id: locutor.id }, data: { imagemUrl: nova } })
  console.log(`${locutor.nome} → ${nova ?? 'silhueta'}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
