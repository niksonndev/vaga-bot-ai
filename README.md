## VagaBot AI

Agente de IA em Node + TypeScript que lê uma vaga do LinkedIn, analisa compatibilidade com o seu currículo, reescreve o currículo otimizado para ATS e gera um email de candidatura pronto para enviar.

### Ideia geral

Como desenvolvedor, a proposta é ter um **agent de emprego 24x7** que:

- **Lê uma vaga específica** (URL do LinkedIn).
- **Lê e entende** a descrição da vaga.
- **Compara** a vaga com o seu currículo base (`data/nikson-curriculo-pt.md`).
- **Adapta o currículo** inserindo e priorizando palavras‑chave relevantes para sistemas ATS.
- **Gera um e-mail** de candidatura com tom de dev sênior confiante.

Hoje o fluxo é executado on‑demand via CLI; no futuro pode rodar em loop/scheduler.

### Stack técnica

- **Runtime**: Node.js + TypeScript
- **Execução TS**: `ts-node`
- **IA**: SDK oficial da OpenAI (`openai`)
- **Automação de browser / scraping**: `playwright` (LinkedIn job page)
- **Configuração de ambiente**: `dotenv`

### Estrutura de pastas

```text
vaga-bot-ai/
├── src/
│   ├── scraper.ts   # busca a vaga (LinkedIn) e extrai JobData
│   ├── analyzer.ts  # analisa compatibilidade currículo x vaga (JSON, score, keywords)
│   ├── adapter.ts   # reescreve currículo otimizado para ATS e salva .md
│   ├── composer.ts  # gera email de candidatura e salva .txt
│   └── index.ts     # CLI que orquestra tudo
├── data/
│   ├── nikson-curriculo-pt.md   # currículo base (PT)
│   ├── nikson-curriculum-en.md  # currículo base (EN) – opcional
│   └── outputs/                 # arquivos gerados (currículos e emails)
├── .env                  # variáveis de ambiente (não versionado)
├── .env.example          # exemplo de config de ambiente
├── package.json
└── tsconfig.json
```

### Fluxo do agente

1. **Scraper (`scraper.ts`)**
   - Recebe **apenas** a URL de uma vaga do LinkedIn.
   - Usa Playwright (com `headless: false` e user‑agent customizado).
   - Aguarda seletores críticos (título, empresa, localização, descrição).
   - Limpa texto (remove “Show more/less”, normaliza quebras de linha).
   - Retorna um `JobData` tipado:
     - `title`, `company`, `location`, `description`, `url`.

2. **Analyzer (`analyzer.ts`)**
   - Lê `data/nikson-curriculo-pt.md`.
   - Monta um prompt com:
     - Currículo base.
     - Título, empresa e descrição da vaga.
   - Usa OpenAI (`gpt-4.1-mini` / similar) com um **prompt de sistema rígido** para responder somente JSON.
   - Faz `JSON.parse` com `try/catch`, logando a resposta raw se der erro.
   - Valida campos obrigatórios e retorna um `AnalysisResult`:

```3:11:C:\Users\nikso\dev\vaga-bot-ai\src\analyzer.ts
export interface AnalysisResult {
  score: number;       // 0 a 10
  relevant: boolean;   // true se score >= 7
  reason: string;      // 1-2 frases
  keywords: string[];  // exatamente 10 keywords ATS da vaga
}
```

   - Também expõe um mini‑CLI:
     - `npx ts-node -r dotenv/config src/analyzer.ts "<URL_DA_VAGA>"`  
       (faz scrape + análise e imprime o JSON).

3. **Adapter (`adapter.ts`)**
   - Entrada: `adaptResume(job: JobData, analysis: AnalysisResult): Promise<string>`.
   - Lê o currículo base `data/nikson-curriculo-pt.md`.
   - Usa um modelo mais forte (`gpt-4.1` / gpt‑4o equivalente) com um prompt de sistema focado em:
     - Manter 100% das informações verdadeiras.
     - Incorporar naturalmente as `keywords` da análise onde fizer sentido.
     - Reordenar/priorizar seções de skills para refletir os requisitos da vaga.
     - Manter **formato markdown** e retornar só o currículo reescrito.
   - Salva o currículo adaptado em:
     - `data/outputs/{company-slug}-{YYYY-MM-DD}-resume.md`
   - Retorna o currículo reescrito como `string`.

4. **Composer (`composer.ts`)**
   - Entrada: `composeEmail(job: JobData, analysis: AnalysisResult): Promise<string>`.
   - Usa um modelo mais barato (`gpt-4.1-mini` / gpt‑4o‑mini equivalente).
   - Prompt do sistema orientado a:
     - Email de candidatura direto, confiante, não genérico.
     - Sem clichês (“venho por meio deste”, etc.).
     - Retornar apenas o corpo do email (sem assunto/saudação).
   - Prompt do usuário inclui:
     - Título da vaga, empresa, keywords e score de compatibilidade + motivo.
   - Gera um email com no máximo 4 parágrafos, terminando com call to action clara.
   - Salva em:
     - `data/outputs/{company-slug}-{YYYY-MM-DD}-email.txt`
   - Retorna o corpo do email como `string`.

5. **Orquestração (`index.ts`)**
   - Carrega `.env` (`dotenv/config`) e valida `OPENAI_API_KEY`.
   - Lê a URL da vaga de `process.argv[2]`.
   - Fluxo:
     1. `scrapeJob(url)`
     2. `analyzeJob(job)`
     3. Se `analysis.relevant === false`, loga:
        - `⚠️  Vaga não relevante (score: X/10): [reason] — encerrando.`
        - E encerra.
     4. `adaptResume(job, analysis)`
     5. `composeEmail(job, analysis)`
   - Loga o progresso:
     - `🔍 Buscando vaga...`
     - `📊 Analisando compatibilidade...`
     - `✍️  Adaptando currículo...`
     - `📧 Gerando email...`
     - `✅ Concluído! Arquivos gerados em data/outputs/`

### Variáveis de ambiente

Arquivo `.env` (baseado em `.env.example`):

```bash
OPENAI_API_KEY=coloque_sua_chave_aqui
```

### Scripts principais

No `package.json`:

- **`npm run dev`** – roda o `src/index.ts` com `ts-node` (modo desenvolvimento).
- **`npm run build`** – compila TypeScript para `dist/` usando `tsc`.

### Como rodar o agente ponta a ponta

1. Instale as dependências:

```bash
npm install
```

2. Copie `.env.example` para `.env` e coloque sua `OPENAI_API_KEY`.

3. Coloque seu currículo base em `data/nikson-curriculo-pt.md` (Markdown).

4. Rode o pipeline completo passando a URL da vaga:

```bash
npm run dev -- "https://www.linkedin.com/jobs/view/4371177488"
```

Isso irá:

- Scrapar a vaga do LinkedIn.
- Analisar compatibilidade currículo x vaga.
- Gerar um currículo adaptado para ATS em `data/outputs/...-resume.md`.
- Gerar um email de candidatura em `data/outputs/...-email.txt`.

---

Este projeto existe para ser o seu **agente pessoal de vagas**, otimizando currículo e comunicação para maximizar a chance de passar pelos filtros automáticos (ATS) e chegar de fato nas mãos de recrutadores.
