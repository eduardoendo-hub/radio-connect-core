-- Como a pessoa quer ser chamada no ar, e se pode.
--
-- Dizer um nome na rádio é publicação, e publicação precisa de sim. A produção ver o
-- cadastro é necessidade de operação e já era assim; falar o nome para a cidade inteira é
-- outra coisa, e o silêncio de quem nunca foi perguntado não é autorização.
--
-- `podeSerCitado` nasce false. O convite é feito no aplicativo com as palavras certas —
-- para o ouvinte de rádio ter o nome citado é prêmio, não incômodo — mas o padrão de quem
-- não respondeu continua sendo não.
ALTER TABLE "ouvintes" ADD COLUMN "apelido" TEXT;
ALTER TABLE "ouvintes" ADD COLUMN "podeSerCitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ouvintes" ADD COLUMN "citacaoEm" TIMESTAMP(3);
