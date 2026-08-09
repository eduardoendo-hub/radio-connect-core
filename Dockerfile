# ===== Build =====
FROM node:22-slim AS build
WORKDIR /app

# Prisma precisa de openssl
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# --include=dev força as devDependencies (typescript, tsx) mesmo com NODE_ENV=production
RUN npm install --include=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

# ===== Runtime =====
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 3000

# Aplica migrações pendentes e sobe a aplicação.
#
# O `resolve` na frente é PONTUAL e sai no próximo commit. A migração
# `20260808150000_publicidade_por_programa` foi escrita com o nome do modelo
# ("Programa") no lugar do nome da tabela ("programas") e falhou ao aplicar. O Postgres
# roda cada arquivo de migração numa transação, então ela falhou no primeiro comando e
# não deixou nada aplicado — o banco está intacto. Mas o Prisma gravou a migração como
# falha, e a partir daí todo `migrate deploy` aborta com P3009 e o container não sobe.
#
# Marcá-la como revertida é literalmente o que aconteceu. O `|| true` existe porque na
# segunda subida ela já não estará em estado de falha.
CMD ["sh", "-c", "npx prisma migrate resolve --rolled-back 20260808150000_publicidade_por_programa || true; npx prisma migrate deploy && node dist/server.js"]
