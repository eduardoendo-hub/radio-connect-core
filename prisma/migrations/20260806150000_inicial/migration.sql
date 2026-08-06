-- CreateEnum
CREATE TYPE "TipoMomento" AS ENUM ('REACAO', 'ESCOLHA', 'ENQUETE', 'AVISO', 'CHAMADA_PROMOCAO', 'RESULTADO');

-- CreateEnum
CREATE TYPE "EstadoMomento" AS ENUM ('RASCUNHO', 'AGENDADO', 'PRONTO', 'ATIVO', 'ENCERRADO', 'RESULTADO_PUBLICADO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "VendidoPor" AS ENUM ('RADIO', 'TECHNOW');

-- CreateEnum
CREATE TYPE "StatusCampanha" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADA', 'ATIVA', 'ENCERRADA', 'REJEITADA');

-- CreateEnum
CREATE TYPE "OrigemAnuncio" AS ENUM ('DIRETA', 'PROGRAMATICA');

-- CreateEnum
CREATE TYPE "PapelOperador" AS ENUM ('ADMIN', 'DIRETOR', 'PRODUTOR', 'PROGRAMACAO', 'LOCUTOR', 'MARKETING', 'ATENDIMENTO', 'VISUALIZADOR');

-- CreateTable
CREATE TABLE "emissoras" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "celula" TEXT NOT NULL DEFAULT 'c1',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "streamUrl" TEXT,
    "streamBackupUrl" TEXT,
    "configuracao" JSONB NOT NULL DEFAULT '{}',
    "tema" JSONB NOT NULL DEFAULT '{}',
    "conteudo" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "emissoras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programas" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "imagemUrl" TEXT,
    "corDestaque" TEXT,
    "tomDeVoz" TEXT,
    "locutorTitularId" TEXT,
    "campanhaPatrocinadoraId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locutores" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "imagemUrl" TEXT,
    "bio" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "locutores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots_grade" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "programaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slots_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edicoes" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "programaId" TEXT NOT NULL,
    "slotId" TEXT,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "locutorId" TEXT,
    "titulo" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "momentos" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "edicaoId" TEXT NOT NULL,
    "tipo" "TipoMomento" NOT NULL,
    "estado" "EstadoMomento" NOT NULL DEFAULT 'RASCUNHO',
    "titulo" TEXT NOT NULL,
    "texto" TEXT,
    "imagemUrl" TEXT,
    "mensagemPosResposta" TEXT,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "campanhaPatrocinadoraId" TEXT,
    "promocaoId" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "momentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opcoes_momento" (
    "id" TEXT NOT NULL,
    "momentoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "rotulo" TEXT NOT NULL,
    "emoji" TEXT,
    "votos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "opcoes_momento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_momento" (
    "id" TEXT NOT NULL,
    "momentoId" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "opcaoId" TEXT,
    "chaveIdempotencia" TEXT,
    "respondidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respostas_momento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates_momento" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoMomento" NOT NULL,
    "titulo" TEXT NOT NULL,
    "texto" TEXT,
    "opcoesPadrao" JSONB NOT NULL DEFAULT '[]',
    "duracaoSegundos" INTEGER NOT NULL DEFAULT 180,
    "favorito" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "templates_momento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ouvintes" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "nome" TEXT,
    "cidade" TEXT,
    "avatarUrl" TEXT,
    "provedorAuth" TEXT,
    "idExterno" TEXT,
    "preferencias" JSONB NOT NULL DEFAULT '{}',
    "consentimentoAnuncios" BOOLEAN NOT NULL DEFAULT false,
    "consentimentoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAcesso" TIMESTAMP(3),

    CONSTRAINT "ouvintes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots_conexao" (
    "id" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "nivel" TEXT NOT NULL,
    "componentes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "snapshots_conexao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconhecimentos" (
    "id" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "obtidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconhecimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficios" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "campanhaParceiraId" TEXT,
    "scoreMinimo" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "beneficios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficios_concedidos" (
    "id" TEXT NOT NULL,
    "beneficioId" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "concedidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "beneficios_concedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promocoes" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "regras" TEXT,
    "imagemUrl" TEXT,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "scoreMinimo" INTEGER,
    "campanhaPatrocinadoraId" TEXT,
    "resultado" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promocoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participacoes_promocao" (
    "id" TEXT NOT NULL,
    "promocaoId" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "participouEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vencedor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "participacoes_promocao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pushes" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "segmento" JSONB NOT NULL DEFAULT '{}',
    "agendadoEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "campanhaPatrocinadoraId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pushes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anunciantes" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "contato" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anunciantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanhas" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "anuncianteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "status" "StatusCampanha" NOT NULL DEFAULT 'RASCUNHO',
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "vendidoPor" "VendidoPor" NOT NULL DEFAULT 'RADIO',
    "valorTotal" DECIMAL(12,2),
    "cpmMinimo" DECIMAL(10,2),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campanhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criativos" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clickUrl" TEXT,
    "duracao" INTEGER,
    "posicoes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "criativos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impressoes_anuncio" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "posicao" TEXT NOT NULL,
    "origem" "OrigemAnuncio" NOT NULL,
    "vendidoPor" "VendidoPor" NOT NULL,
    "campanhaId" TEXT,
    "ouvinteId" TEXT,
    "edicaoId" TEXT,
    "visivel" BOOLEAN NOT NULL DEFAULT false,
    "clicado" BOOLEAN NOT NULL DEFAULT false,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "ocorridaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impressoes_anuncio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "ouvinteId" TEXT NOT NULL,
    "chatwootContactId" TEXT,
    "chatwootConversationId" TEXT,
    "chatwootSourceId" TEXT,
    "categoria" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3),

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "conteudo" TEXT,
    "midiaUrl" TEXT,
    "edicaoId" TEXT,
    "chatwootMessageId" TEXT,
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operadores" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "PapelOperador" NOT NULL DEFAULT 'PRODUTOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLogin" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" TEXT NOT NULL,
    "emissoraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ouvinteId" TEXT,
    "edicaoId" TEXT,
    "momentoId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ocorridoEmCliente" TIMESTAMP(3),
    "ocorridoEmServidor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chaveIdempotencia" TEXT,
    "appVersao" TEXT,
    "plataforma" TEXT,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emissoras_slug_key" ON "emissoras"("slug");

-- CreateIndex
CREATE INDEX "programas_emissoraId_ativo_idx" ON "programas"("emissoraId", "ativo");

-- CreateIndex
CREATE INDEX "locutores_emissoraId_idx" ON "locutores"("emissoraId");

-- CreateIndex
CREATE INDEX "slots_grade_emissoraId_diaSemana_idx" ON "slots_grade"("emissoraId", "diaSemana");

-- CreateIndex
CREATE INDEX "edicoes_emissoraId_inicioEm_idx" ON "edicoes"("emissoraId", "inicioEm");

-- CreateIndex
CREATE INDEX "momentos_emissoraId_estado_inicioEm_idx" ON "momentos"("emissoraId", "estado", "inicioEm");

-- CreateIndex
CREATE INDEX "momentos_edicaoId_idx" ON "momentos"("edicaoId");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_momento_momentoId_ordem_key" ON "opcoes_momento"("momentoId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_momento_chaveIdempotencia_key" ON "respostas_momento"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "respostas_momento_ouvinteId_idx" ON "respostas_momento"("ouvinteId");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_momento_momentoId_ouvinteId_key" ON "respostas_momento"("momentoId", "ouvinteId");

-- CreateIndex
CREATE INDEX "templates_momento_emissoraId_idx" ON "templates_momento"("emissoraId");

-- CreateIndex
CREATE INDEX "ouvintes_emissoraId_ultimoAcesso_idx" ON "ouvintes"("emissoraId", "ultimoAcesso");

-- CreateIndex
CREATE UNIQUE INDEX "ouvintes_emissoraId_telefone_key" ON "ouvintes"("emissoraId", "telefone");

-- CreateIndex
CREATE UNIQUE INDEX "ouvintes_emissoraId_idExterno_key" ON "ouvintes"("emissoraId", "idExterno");

-- CreateIndex
CREATE INDEX "snapshots_conexao_ouvinteId_data_idx" ON "snapshots_conexao"("ouvinteId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_conexao_ouvinteId_data_key" ON "snapshots_conexao"("ouvinteId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "reconhecimentos_ouvinteId_chave_key" ON "reconhecimentos"("ouvinteId", "chave");

-- CreateIndex
CREATE INDEX "beneficios_emissoraId_ativo_idx" ON "beneficios"("emissoraId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "beneficios_concedidos_beneficioId_ouvinteId_key" ON "beneficios_concedidos"("beneficioId", "ouvinteId");

-- CreateIndex
CREATE INDEX "promocoes_emissoraId_inicioEm_idx" ON "promocoes"("emissoraId", "inicioEm");

-- CreateIndex
CREATE UNIQUE INDEX "participacoes_promocao_promocaoId_ouvinteId_key" ON "participacoes_promocao"("promocaoId", "ouvinteId");

-- CreateIndex
CREATE INDEX "pushes_emissoraId_agendadoEm_idx" ON "pushes"("emissoraId", "agendadoEm");

-- CreateIndex
CREATE INDEX "anunciantes_emissoraId_idx" ON "anunciantes"("emissoraId");

-- CreateIndex
CREATE INDEX "campanhas_emissoraId_status_inicioEm_idx" ON "campanhas"("emissoraId", "status", "inicioEm");

-- CreateIndex
CREATE INDEX "criativos_campanhaId_idx" ON "criativos"("campanhaId");

-- CreateIndex
CREATE INDEX "impressoes_anuncio_emissoraId_ocorridaEm_idx" ON "impressoes_anuncio"("emissoraId", "ocorridaEm");

-- CreateIndex
CREATE INDEX "impressoes_anuncio_campanhaId_idx" ON "impressoes_anuncio"("campanhaId");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_ouvinteId_key" ON "conversas"("ouvinteId");

-- CreateIndex
CREATE INDEX "conversas_emissoraId_ultimaMensagemEm_idx" ON "conversas"("emissoraId", "ultimaMensagemEm");

-- CreateIndex
CREATE INDEX "mensagens_conversaId_enviadaEm_idx" ON "mensagens"("conversaId", "enviadaEm");

-- CreateIndex
CREATE INDEX "mensagens_emissoraId_edicaoId_idx" ON "mensagens"("emissoraId", "edicaoId");

-- CreateIndex
CREATE INDEX "operadores_emissoraId_idx" ON "operadores"("emissoraId");

-- CreateIndex
CREATE UNIQUE INDEX "operadores_emissoraId_email_key" ON "operadores"("emissoraId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_chaveIdempotencia_key" ON "eventos"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "eventos_emissoraId_nome_ocorridoEmServidor_idx" ON "eventos"("emissoraId", "nome", "ocorridoEmServidor");

-- CreateIndex
CREATE INDEX "eventos_ouvinteId_idx" ON "eventos"("ouvinteId");

-- AddForeignKey
ALTER TABLE "programas" ADD CONSTRAINT "programas_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programas" ADD CONSTRAINT "programas_locutorTitularId_fkey" FOREIGN KEY ("locutorTitularId") REFERENCES "locutores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programas" ADD CONSTRAINT "programas_campanhaPatrocinadoraId_fkey" FOREIGN KEY ("campanhaPatrocinadoraId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locutores" ADD CONSTRAINT "locutores_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots_grade" ADD CONSTRAINT "slots_grade_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots_grade" ADD CONSTRAINT "slots_grade_programaId_fkey" FOREIGN KEY ("programaId") REFERENCES "programas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_programaId_fkey" FOREIGN KEY ("programaId") REFERENCES "programas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edicoes" ADD CONSTRAINT "edicoes_locutorId_fkey" FOREIGN KEY ("locutorId") REFERENCES "locutores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_edicaoId_fkey" FOREIGN KEY ("edicaoId") REFERENCES "edicoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates_momento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_campanhaPatrocinadoraId_fkey" FOREIGN KEY ("campanhaPatrocinadoraId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_promocaoId_fkey" FOREIGN KEY ("promocaoId") REFERENCES "promocoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentos" ADD CONSTRAINT "momentos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcoes_momento" ADD CONSTRAINT "opcoes_momento_momentoId_fkey" FOREIGN KEY ("momentoId") REFERENCES "momentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_momento" ADD CONSTRAINT "respostas_momento_momentoId_fkey" FOREIGN KEY ("momentoId") REFERENCES "momentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_momento" ADD CONSTRAINT "respostas_momento_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_momento" ADD CONSTRAINT "respostas_momento_opcaoId_fkey" FOREIGN KEY ("opcaoId") REFERENCES "opcoes_momento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates_momento" ADD CONSTRAINT "templates_momento_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ouvintes" ADD CONSTRAINT "ouvintes_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots_conexao" ADD CONSTRAINT "snapshots_conexao_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconhecimentos" ADD CONSTRAINT "reconhecimentos_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios" ADD CONSTRAINT "beneficios_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios" ADD CONSTRAINT "beneficios_campanhaParceiraId_fkey" FOREIGN KEY ("campanhaParceiraId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios_concedidos" ADD CONSTRAINT "beneficios_concedidos_beneficioId_fkey" FOREIGN KEY ("beneficioId") REFERENCES "beneficios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios_concedidos" ADD CONSTRAINT "beneficios_concedidos_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promocoes" ADD CONSTRAINT "promocoes_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promocoes" ADD CONSTRAINT "promocoes_campanhaPatrocinadoraId_fkey" FOREIGN KEY ("campanhaPatrocinadoraId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participacoes_promocao" ADD CONSTRAINT "participacoes_promocao_promocaoId_fkey" FOREIGN KEY ("promocaoId") REFERENCES "promocoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participacoes_promocao" ADD CONSTRAINT "participacoes_promocao_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushes" ADD CONSTRAINT "pushes_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushes" ADD CONSTRAINT "pushes_campanhaPatrocinadoraId_fkey" FOREIGN KEY ("campanhaPatrocinadoraId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anunciantes" ADD CONSTRAINT "anunciantes_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_anuncianteId_fkey" FOREIGN KEY ("anuncianteId") REFERENCES "anunciantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criativos" ADD CONSTRAINT "criativos_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "campanhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressoes_anuncio" ADD CONSTRAINT "impressoes_anuncio_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressoes_anuncio" ADD CONSTRAINT "impressoes_anuncio_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "campanhas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_edicaoId_fkey" FOREIGN KEY ("edicaoId") REFERENCES "edicoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operadores" ADD CONSTRAINT "operadores_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_emissoraId_fkey" FOREIGN KEY ("emissoraId") REFERENCES "emissoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_ouvinteId_fkey" FOREIGN KEY ("ouvinteId") REFERENCES "ouvintes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

