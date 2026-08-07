-- Imagens enviadas pela produção. No banco e não em disco: o container é efêmero, e um
-- volume seria mais uma peça de infraestrutura por emissora.
CREATE TABLE "arquivos" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoMime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "dados" BYTEA NOT NULL,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arquivos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "arquivos_emissoraId_criadoEm_idx" ON "arquivos"("emissoraId", "criadoEm");

ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_emissoraId_fkey"
    FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
