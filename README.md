## Job Hunter AI

Job Hunter AI is a Node.js + TypeScript CLI that searches LinkedIn jobs, scrapes job details, analyzes relevance with OpenAI, stores results in SQLite, and can optionally mirror relevant jobs to Google Sheets.

### Overview

The goal is to run a practical job-hunting workflow from the terminal:

- Search jobs by keyword (or process one URL directly).
- Extract job title, company, location, and description.
- Analyze whether the job is relevant for your profile.
- Store deduplicated jobs in a local SQLite database.
- Optionally append each relevant saved job to a Google Sheet.

### Tech Stack

- **Runtime:** Node.js + TypeScript
- **TS execution:** `ts-node`
- **AI analysis:** OpenAI SDK (`openai`)
- **Browser automation / scraping:** `playwright`
- **Local storage:** `better-sqlite3` (embedded SQLite)
- **Environment config:** `dotenv`

### Project Structure

```text
job-hunter-ai/
├── src/
│   ├── scraper.ts          # scrape one LinkedIn job URL into JobData
│   ├── search.ts           # public LinkedIn search -> canonical job URLs
│   ├── analyzer.ts         # OpenAI relevance analysis
│   ├── filter.ts           # local filtering before analysis/storage
│   ├── storage.ts          # SQLite persistence and deduplication
│   ├── sheets.ts           # optional Google Sheets append
│   ├── adapter.ts          # resume adaptation (currently disabled in main flow)
│   ├── composer.ts         # email generation (currently disabled in main flow)
│   └── index.ts            # CLI orchestrator
├── data/
│   ├── jobs.db
│   ├── outputs/
│   └── ...
├── .env
├── .env.example
├── package.json
└── tsconfig.json
```

### Current Runtime Flow

`src/index.ts` validates `OPENAI_API_KEY` at startup and then runs one of these modes:

1. **Default batch mode (no args)**
   - Iterates all categories and keywords from `SEARCH_KEYWORDS`.
   - Uses `DEFAULT_SEARCH_LIMIT` if set.

2. **Category mode**
   - First argument matches one of:
     - `frontend`
     - `backend`
     - `fullstack`
     - `webAnalytics`
   - Runs only that category.

3. **Search mode**
   - First argument is `search` or `busca`.
   - Optional numeric limit before the query text.

4. **Single URL mode**
   - Any other first argument is treated as a LinkedIn job URL.

For each processed job in the active flow:

1. Scrape job data (`scraper.ts`).
2. Run local filter (`filter.ts`).
3. Analyze with OpenAI (`analyzer.ts`).
4. Save URL/details to SQLite (`storage.ts`), with URL deduplication.
5. If Google Sheets is configured, append a row (`sheets.ts`).

### Scripts

From `package.json`:

- `npm run dev` -> run CLI (`ts-node src/index.ts`)
- `npm run build` -> compile TypeScript (`tsc`)
- `npm test` -> placeholder script

#### `npm run dev` Execution Options

- **No arguments** (default batch):
  ```bash
  npm run dev
  ```

- **Category**:
  ```bash
  npm run dev -- frontend
  ```

- **Search query**:
  ```bash
  npm run dev -- search "React Developer"
  npm run dev -- busca "data engineer"
  ```

- **Search with explicit limit**:
  ```bash
  npm run dev -- search 10 "React Developer"
  ```

- **Single LinkedIn URL**:
  ```bash
  npm run dev -- "https://www.linkedin.com/jobs/view/4371177488"
  ```

### Environment Variables

Based on `.env.example`:

```bash
OPENAI_API_KEY=your_key_here
DEFAULT_SEARCH_LIMIT=20
MAX_SEARCH_RESULTS=1000

# LinkedIn login (optional)
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=

# Google Sheets (optional)
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_WORKSHEET_NAME=jobs
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

### Google Sheets Integration (Optional)

When all Google Sheets env vars are set, each relevant job saved in SQLite is also appended to your sheet.

Required setup:

1. Enable Google Sheets API in your Google Cloud project.
2. Create a service account and JSON key.
3. Share the spreadsheet with the service account email (`...iam.gserviceaccount.com`) as editor.
4. Set the env vars listed above.

Private key format in `.env` (important):

```bash
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Keep the value in **double quotes** and keep `\n` as literal characters.

### End-to-End Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create your `.env` file from `.env.example` and set at least `OPENAI_API_KEY`.
3. (Optional) Configure Google Sheets variables.
4. Run one of the modes above.

### Notes

- `adapter.ts` and `composer.ts` exist but are currently disabled in the main orchestrator flow.
- LinkedIn scraping can intermittently timeout due to anti-bot behavior; batch mode handles this and continues.
