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
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
