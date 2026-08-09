-- Quando o sorteio acontece, que não é quando a promoção sai do ar. É esta data que
-- traz a pessoa de volta com o rádio ligado.
ALTER TABLE "promocoes" ADD COLUMN "sorteioEm" TIMESTAMP(3);
