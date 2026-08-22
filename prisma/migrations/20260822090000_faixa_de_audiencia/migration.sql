-- Meia hora de audiência: o fato de onde saem as três telas.
--
-- Uma linha por faixa de trinta minutos, com os contadores do que aconteceu ali. São 48
-- linhas por dia por rádio — dezessete mil por ano.
--
-- `noApp` e `ouvindo` são dois indicadores, não um forte e um fraco: ouvir pelo aplicativo
-- consome banda, e muita gente abre o app com a rádio tocando no carro. Essa pessoa está
-- ouvindo a Band e está dentro do produto — só não está gastando os dados dela conosco.
--
-- Os dois são PESSOAS distintas; o resto são EVENTOS. Cinco cliques de uma
-- pessoa são cinco cliques e uma pessoa, e confundir os dois é como se mede audiência
-- errado. A distinção é feita no Redis, num conjunto por faixa que expira sozinho.
CREATE TABLE "faixas_audiencia" (
  "id" TEXT NOT NULL,
  "emissoraId" TEXT NOT NULL,
  "inicioEm" TIMESTAMP(3) NOT NULL,
  "edicaoId" TEXT,
  "programaId" TEXT,
  "noApp" INTEGER NOT NULL DEFAULT 0,
  "ouvindo" INTEGER NOT NULL DEFAULT 0,
  "minutosOuvidos" INTEGER NOT NULL DEFAULT 0,
  "plays" INTEGER NOT NULL DEFAULT 0,
  "momentos" INTEGER NOT NULL DEFAULT 0,
  "mensagens" INTEGER NOT NULL DEFAULT 0,
  "participacoes" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "faixas_audiencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "faixas_audiencia_emissoraId_inicioEm_key"
  ON "faixas_audiencia" ("emissoraId", "inicioEm");

-- A visão por programa é um GROUP BY sobre este índice.
CREATE INDEX "faixas_audiencia_programa_idx"
  ON "faixas_audiencia" ("emissoraId", "programaId", "inicioEm");

ALTER TABLE "faixas_audiencia" ADD CONSTRAINT "faixas_audiencia_emissoraId_fkey"
  FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
