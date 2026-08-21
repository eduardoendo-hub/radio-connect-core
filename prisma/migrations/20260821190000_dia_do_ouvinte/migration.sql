-- Um dia de uma pessoa com a rádio.
--
-- A linha existe porque ela apareceu: presença é a existência do registro. Minutos e
-- aberturas são o que aconteceu dentro do dia.
--
-- Guardar o dia agregado, e não cada evento, é o que faz "voltou em quatro dias desta
-- semana" ser uma contagem de linhas em vez de uma varredura de log.
CREATE TABLE "dias_do_ouvinte" (
  "id" TEXT NOT NULL,
  "emissoraId" TEXT NOT NULL,
  "ouvinteId" TEXT NOT NULL,
  "data" DATE NOT NULL,
  "minutosOuvidos" INTEGER NOT NULL DEFAULT 0,
  "aberturas" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "dias_do_ouvinte_pkey" PRIMARY KEY ("id")
);

-- O índice único é a garantia de "uma linha por pessoa por dia". O aplicativo manda
-- sinal de vida a cada minuto de áudio; sem isto, cada sinal viraria uma linha.
CREATE UNIQUE INDEX "dias_do_ouvinte_ouvinteId_data_key"
  ON "dias_do_ouvinte" ("ouvinteId", "data");

CREATE INDEX "dias_do_ouvinte_emissoraId_data_idx"
  ON "dias_do_ouvinte" ("emissoraId", "data");

ALTER TABLE "dias_do_ouvinte" ADD CONSTRAINT "dias_do_ouvinte_emissoraId_fkey"
  FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dias_do_ouvinte" ADD CONSTRAINT "dias_do_ouvinte_ouvinteId_fkey"
  FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
