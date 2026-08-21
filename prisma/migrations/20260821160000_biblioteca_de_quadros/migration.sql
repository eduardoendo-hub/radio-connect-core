-- O quadro sai da biblioteca sem levar embora o que já foi ao ar.
--
-- Rádio troca de formato por temporada: o quadro do verão volta em dezembro, o que não
-- pegou some em março. Apagar o template não serve — `Momento.templateId` é opcional, e
-- o Prisma zeraria o vínculo (`SetNull`) de tudo que já aconteceu, tirando a cor e o
-- ícone do quadro de toda a história dele.
--
-- Arquivar tira da vitrine do Ao Vivo e devolve num clique.
ALTER TABLE "templates_momento" ADD COLUMN "arquivado" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "templates_momento_vitrine_idx"
  ON "templates_momento" ("emissoraId", "arquivado", "favorito");
