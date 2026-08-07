-- A equipe que divide o microfone. Rádio quase nunca é uma voz só: guardar apenas o
-- titular apagaria o que faz a manhã ser aquela manhã.
CREATE TABLE "_EquipeDoPrograma" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_EquipeDoPrograma_AB_unique" ON "_EquipeDoPrograma"("A", "B");
CREATE INDEX "_EquipeDoPrograma_B_index" ON "_EquipeDoPrograma"("B");

ALTER TABLE "_EquipeDoPrograma" ADD CONSTRAINT "_EquipeDoPrograma_A_fkey"
    FOREIGN KEY ("A") REFERENCES "locutores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EquipeDoPrograma" ADD CONSTRAINT "_EquipeDoPrograma_B_fkey"
    FOREIGN KEY ("B") REFERENCES "programas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
