-- Nem todo horário pode ser vendido: político eleitoral, religioso, especial com
-- exclusividade. Padrão ligado porque desligar é a exceção.
ALTER TABLE "programas" ADD COLUMN "anunciosAtivos" BOOLEAN NOT NULL DEFAULT true;
