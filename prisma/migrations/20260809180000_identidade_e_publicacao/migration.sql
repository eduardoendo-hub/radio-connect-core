-- CPF é a chave contra o mesmo ganhador cinco vezes: único por emissora, só dígitos.
-- Data de nascimento faz a regra dos 18 anos existir de verdade em vez de ser uma frase
-- no regulamento.
ALTER TABLE "ouvintes" ADD COLUMN "cpf" TEXT;
ALTER TABLE "ouvintes" ADD COLUMN "dataNascimento" DATE;
CREATE UNIQUE INDEX "ouvintes_emissoraId_cpf_key" ON "ouvintes"("emissoraId", "cpf");

-- Criar e publicar eram a mesma coisa, e não são. Padrão `true` para as que já existem
-- não sumirem do ar na subida.
ALTER TABLE "promocoes" ADD COLUMN "publicada" BOOLEAN NOT NULL DEFAULT true;
