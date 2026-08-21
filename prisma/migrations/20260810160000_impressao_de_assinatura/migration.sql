-- O que estava na tela quando a marca apareceu.
--
-- Banner é uma exibição; assinatura de programa é "esta pessoa viu a marca durante esta
-- edição" — uma vez, não uma por repintura. Sem isso, um patrocínio de três horas viraria
-- milhares de impressões por ouvinte.
ALTER TABLE "impressoes_anuncio" ADD COLUMN "referenciaId" TEXT;

-- Índice PARCIAL: a unicidade só vale onde há referência. As impressões de banner e
-- pré-roll que já existem têm `referenciaId` nulo e se repetem de propósito — cada
-- exibição é uma impressão de verdade.
CREATE UNIQUE INDEX "impressao_assinatura_unica"
  ON "impressoes_anuncio" ("campanhaId", "ouvinteId", "posicao", "referenciaId")
  WHERE "referenciaId" IS NOT NULL;

CREATE INDEX "impressoes_anuncio_referencia_idx"
  ON "impressoes_anuncio" ("emissoraId", "referenciaId");
