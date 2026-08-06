-- Até quando a produção já leu cada conversa. Sem isso, "quantas esperam resposta"
-- não tem como ser calculado — e é esse número que fica no menu do Studio.
ALTER TABLE "conversas" ADD COLUMN "lidaPelaRadioEm" TIMESTAMP(3);
