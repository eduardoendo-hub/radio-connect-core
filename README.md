# radio-connect-core

Núcleo da plataforma **Radio Connect** — o Estado No Ar, os Momentos, a decisão de anúncio,
a fila de eventos e a integração com o Chatwoot.

> Documentação de produto e arquitetura: `../docs/`
> Comece pelo [modelo conceitual](../docs/03-arquitetura/01-modelo-conceitual.md).

## O que este serviço faz

**Estado No Ar** — mantém, por emissora, um documento com o que está acontecendo agora:
programa, locutor, Momento ativo, promoção, ouvintes presentes. Materializado no Redis,
recalculado por evento, propagado por SSE. É a peça mais lida do sistema.

**Momentos** — ciclo de vida completo, da criação no Studio ao resultado no app. Uma
participação por ouvinte por Momento, garantida no banco.

**Decisão de anúncio** — para cada posição: existe campanha direta ativa e elegível? Senão,
cai para programática. Toda impressão registra a origem, porque é dela que sai o cálculo de
revenue share.

**Eventos** — telemetria assíncrona. O endpoint valida e enfileira; o worker grava em lote.
Nunca dentro da requisição.

## Regras que o código não negocia

1. **Toda entidade pertence a uma emissora.** Nenhuma consulta cruza tenants.
2. **API versionada em `/v1`.** Dentro de uma versão, só se acrescenta campo opcional.
   A rádio pode nunca publicar a atualização do app — a v1 vive enquanto houver quem a use.
3. **Ação não é telemetria.** Responder Momento é transação síncrona. Tela vista é evento.
4. **Sincronizamos estado, não áudio.** Momentos têm janelas amplas (1–3 min) que absorvem
   o delay entre FM e streaming.
5. **Toda experiência nasce podendo ser patrocinada.**

## Rodando local

```bash
cp .env.example .env      # ajuste DATABASE_URL e REDIS_URL
npm install
npx prisma migrate dev
npm run seed:demo         # cria a rádio fictícia da demonstração
npm run dev
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a API com recarga automática |
| `npm run seed:demo` | Cria a emissora de demonstração com grade, locutores e templates |
| `npm run gerador:vida` | Publica Momentos e movimenta a audiência — o app nunca pode parecer parado |
| `npm test` | Testes |
| `npm run lint` | Checagem de tipos |

## Deploy

Push na `main` → GitHub Actions verifica tipos e testes → dispara o deploy no Coolify.
As migrações são aplicadas no start do container.
