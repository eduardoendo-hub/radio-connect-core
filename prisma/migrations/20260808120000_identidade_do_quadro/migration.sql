-- Identidade visual do quadro. Fica no template porque identidade é do quadro e não da
-- mecânica: "Batalha das Músicas" e "Qual música toca agora?" são o mesmo tipo e coisas
-- diferentes para quem ouve.
ALTER TABLE "templates_momento" ADD COLUMN "cor" TEXT;
ALTER TABLE "templates_momento" ADD COLUMN "icone" TEXT;
