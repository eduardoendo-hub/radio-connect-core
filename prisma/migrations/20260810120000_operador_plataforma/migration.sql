-- Quem opera a plataforma, e não uma rádio: sem emissoraId, atravessa todas.
-- Login separado de propósito — ninguém da emissora consegue um token destes.
CREATE TABLE "operadores_plataforma" (
  "id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "senhaHash" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "ultimoLogin" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operadores_plataforma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operadores_plataforma_email_key" ON "operadores_plataforma"("email");
