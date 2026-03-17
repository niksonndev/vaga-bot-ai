import { chromium, Browser, Page } from 'playwright';

const LINKEDIN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LINKEDIN_JOBS_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';

const RESULTS_PER_PAGE = 25;
const MAX_SCROLL_ROUNDS = 15;
const SCROLL_PAUSE_MS = 1200;
const LOAD_MORE_PAUSE_MS = 2000;
const INTER_PAGE_PAUSE_MS = 2500;

// Palavras-chave pré-definidas para buscas comuns no LinkedIn.
// A chave é um identificador "amigável" e o valor é a query enviada em `keywords`.
export const SEARCH_KEYWORDS = {
  gtm: 'Google Tag Manager',
  digitalAnalytics: 'Digital Analytics',
  webAnalytics: 'Web Analytics',
  ga4Gtm: 'GA4 GTM',
  analyticsEngineer: 'Analytics Engineer',
  reactDeveloper: 'React Developer',
  frontendReactTs: 'Frontend React TypeScript',
  nextJsDeveloper: 'Next.js Developer',
  frontendEngineer: 'Frontend Engineer',
  reactTs: 'React TypeScript',
} as const;

type SearchKeywordKey = keyof typeof SEARCH_KEYWORDS;

function resolveQuery(query: string): string {
  const key = query as SearchKeywordKey;
  return SEARCH_KEYWORDS[key] ?? query;
}

function buildSearchUrl(rawQuery: string, start = 0): string {
  const query = resolveQuery(rawQuery);
  const params = new URLSearchParams({
    keywords: query,
    location: 'Brazil',
    f_TPR: 'r2592000', // últimos 30 dias
    f_WT: '2', // remoto
    f_E: '2,3', // pleno + sênior
    f_JT: 'F', // full-time
    start: String(start),
  });

  return `${LINKEDIN_JOBS_SEARCH_URL}?${params.toString()}`;
}

function getMaxSearchPages(): number {
  const envVal = process.env.MAX_SEARCH_PAGES;
  if (envVal && !Number.isNaN(Number(envVal)) && Number(envVal) > 0) {
    return Math.floor(Number(envVal));
  }
  return 10;
}

function randomDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * 800);
}

/**
 * Extrai URLs canônicas de vagas dos links presentes na página.
 */
async function extractJobUrls(page: Page): Promise<string[]> {
  return page.$$eval('a.base-card__full-link', (links) => {
    const canonicalUrls: string[] = [];

    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) continue;
      const rawHref = link.href;
      if (!rawHref || !rawHref.includes('/jobs/view/')) continue;

      try {
        const url = new URL(rawHref);
        const path = url.pathname;
        const lastSegment = path.split('/').filter(Boolean).pop();
        if (!lastSegment) continue;

        const id = lastSegment.split('-').pop();
        if (!id || !/^\d+$/.test(id)) continue;

        const canonical = `https://www.linkedin.com/jobs/view/${id}`;
        if (!canonicalUrls.includes(canonical)) {
          canonicalUrls.push(canonical);
        }
      } catch {
        continue;
      }
    }

    return canonicalUrls;
  });
}

/**
 * Rola a página até o fim e clica no botão "See more jobs" repetidamente
 * para carregar o máximo de vagas possível na mesma página.
 */
async function loadMoreResults(page: Page): Promise<void> {
  let previousCount = 0;
  let staleRounds = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(randomDelay(SCROLL_PAUSE_MS));

    try {
      const seeMoreBtn = page.locator('button.infinite-scroller__show-more-button');
      if (await seeMoreBtn.isVisible({ timeout: 1500 })) {
        await seeMoreBtn.click();
        await page.waitForTimeout(randomDelay(LOAD_MORE_PAUSE_MS));
      }
    } catch {
      // Botão pode não existir nesta página
    }

    const currentCount = await page.$$eval(
      'a.base-card__full-link',
      (els) => els.length,
    );

    if (currentCount <= previousCount) {
      staleRounds++;
      if (staleRounds >= 3) break;
    } else {
      staleRounds = 0;
    }

    previousCount = currentCount;
  }
}

/**
 * Faz uma busca pública de vagas no LinkedIn e retorna
 * uma lista de URLs das vagas encontradas.
 *
 * Estratégia para maximizar resultados:
 * 1. Carrega a primeira página e rola/clica "See more" para obter o máximo de vagas
 * 2. Navega pelas páginas seguintes via parâmetro `start` (paginação)
 * 3. Deduplica URLs em todas as fontes
 */
export async function searchJobs(query: string): Promise<string[]> {
  const maxPages = getMaxSearchPages();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
      userAgent: LINKEDIN_USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR',
    });

    const page = await context.newPage();
    const allUrls = new Set<string>();

    // --- Fase 1: primeira página com scroll + "See more" ---
    const firstPageUrl = buildSearchUrl(query, 0);
    await page.goto(firstPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    try {
      await page.waitForSelector('a.base-card__full-link', { timeout: 15000 });
    } catch {
      console.log('  ⚠️  Nenhum card de vaga encontrado na primeira página.');
      return [];
    }

    await loadMoreResults(page);

    const firstPageUrls = await extractJobUrls(page);
    for (const url of firstPageUrls) allUrls.add(url);

    console.log(`  📄 Fase 1 (scroll): ${allUrls.size} vagas extraídas da primeira página.`);

    // --- Fase 2: paginação via parâmetro `start` ---
    let consecutiveEmpty = 0;

    for (let pageIdx = 1; pageIdx < maxPages; pageIdx++) {
      const start = pageIdx * RESULTS_PER_PAGE;
      const pageUrl = buildSearchUrl(query, start);

      await page.waitForTimeout(randomDelay(INTER_PAGE_PAUSE_MS));
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      try {
        await page.waitForSelector('a.base-card__full-link', { timeout: 10000 });
      } catch {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
        continue;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(randomDelay(SCROLL_PAUSE_MS));

      const pageUrls = await extractJobUrls(page);
      const sizeBefore = allUrls.size;
      for (const url of pageUrls) allUrls.add(url);
      const newCount = allUrls.size - sizeBefore;

      if (newCount === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
      } else {
        consecutiveEmpty = 0;
      }
    }

    console.log(`  📄 Total após paginação: ${allUrls.size} vagas únicas encontradas.`);

    await page.close().catch(() => undefined);
    return Array.from(allUrls);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

// CLI opcional:
// npx ts-node src/search.ts "desenvolvedor backend node"
if (require.main === module) {
  const queryFromArgs = process.argv.slice(2).join(' ').trim();

  if (!queryFromArgs) {
    console.error('Uso: ts-node src/search.ts "<QUERY_DE_BUSCA>"');
    process.exit(1);
  }

  searchJobs(queryFromArgs)
    .then((urls) => {
      const searchUrl = buildSearchUrl(queryFromArgs);
      console.log(JSON.stringify(urls, null, 2));
      console.log(`Encontradas ${urls.length} vagas.`);
      console.log(`🔗 URL de busca do LinkedIn: ${searchUrl}`);
    })
    .catch((err) => {
      console.error('Erro ao buscar vagas:', err);
      process.exit(1);
    });
}

