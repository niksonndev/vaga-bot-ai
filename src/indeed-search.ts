import { chromium as stealthChromium } from 'playwright-extra';
import { Browser, BrowserContext, Page } from 'playwright';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { resolveQuery } from './search';

try { stealthChromium.use(StealthPlugin()); } catch { /* already registered */ }

const INDEED_BASE_URL = 'https://br.indeed.com';
const INDEED_SEARCH_PATH = '/jobs';

const PAGE_SIZE = 10;
const REQUEST_DELAY_MS = 1500;
const MAX_CONSECUTIVE_EMPTY = 3;

const COOKIES_PATH = path.join(__dirname, '..', 'data', 'indeed-cookies.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {} };
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' },
    ],
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
`;

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--start-maximized',
];

// ---------------------------------------------------------------------------
// Cookie persistence
// ---------------------------------------------------------------------------

function loadCookies(): any[] | null {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const data = fs.readFileSync(COOKIES_PATH, 'utf-8');
      const cookies = JSON.parse(data);
      if (Array.isArray(cookies) && cookies.length > 0) return cookies;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCookies(cookies: any[]): void {
  fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildIndeedSearchUrl(rawQuery: string, start = 0): string {
  const query = resolveQuery(rawQuery);
  const params = new URLSearchParams({
    q: query,
    l: '',
    remotejob: '032b3046-06a3-4876-8dfd-474eb5e7ed11',
    start: String(start),
  });
  return `${INDEED_BASE_URL}${INDEED_SEARCH_PATH}?${params.toString()}`;
}

function getMaxIndeedResults(): number {
  const envVal = process.env.MAX_SEARCH_RESULTS;
  if (envVal && !Number.isNaN(Number(envVal)) && Number(envVal) > 0) {
    return Math.min(Math.floor(Number(envVal)), 200);
  }
  return 200;
}

function randomDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * 600);
}

// ---------------------------------------------------------------------------
// Cloudflare detection
// ---------------------------------------------------------------------------

async function isCloudflareBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const title = document.title?.toLowerCase() || '';
    const body = document.body?.innerText?.toLowerCase() || '';
    return title.includes('security check') ||
           title.includes('um momento') ||
           title.includes('just a moment') ||
           body.includes('verificação adicional necessária') ||
           body.includes('additional verification required') ||
           body.includes('não é um robô') ||
           body.includes('not a robot') ||
           body.includes('unusual traffic');
  }).catch(() => false);
}

// ---------------------------------------------------------------------------
// Job key extraction
// ---------------------------------------------------------------------------

async function extractIndeedJobKeys(page: Page): Promise<string[]> {
  const fromDataJk = await page.$$eval('[data-jk]', (elements) => {
    const keys: string[] = [];
    for (const el of elements) {
      const jk = el.getAttribute('data-jk');
      if (jk && !keys.includes(jk)) keys.push(jk);
    }
    return keys;
  }).catch(() => [] as string[]);

  if (fromDataJk.length > 0) return fromDataJk;

  return page.$$eval('a[href*="jk="]', (links) => {
    const keys: string[] = [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/[?&]jk=([a-f0-9]+)/i);
      if (match && !keys.includes(match[1])) keys.push(match[1]);
    }
    return keys;
  }).catch(() => [] as string[]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Busca vagas no Indeed Brasil com filtro de trabalho remoto.
 *
 * Usa Playwright com stealth para contornar bot detection.
 * Se cookies de sessão anteriores existirem (data/indeed-cookies.json),
 * eles serão restaurados para evitar desafios Cloudflare.
 *
 * Indeed usa Cloudflare que pode bloquear acessos automatizados.
 * Quando bloqueado, a função retorna [] e exibe uma mensagem informativa.
 */
export async function searchIndeedJobs(query: string): Promise<string[]> {
  const maxResults = getMaxIndeedResults();
  let browser: Browser | undefined;

  try {
    browser = await stealthChromium.launch({ headless: true, args: BROWSER_ARGS });
    const context: BrowserContext = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    await context.addInitScript(STEALTH_INIT_SCRIPT);

    const cookies = loadCookies();
    if (cookies) {
      await context.addCookies(cookies);
      console.log('  🍪 Cookies do Indeed restaurados.');
    }

    const page = await context.newPage();
    const allKeys = new Set<string>();
    let consecutiveEmpty = 0;

    try {
      for (let start = 0; start < maxResults; start += PAGE_SIZE) {
        const url = buildIndeedSearchUrl(query, start);

        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(randomDelay(1000));
        } catch {
          consecutiveEmpty++;
          if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
          await page.waitForTimeout(randomDelay(2000));
          continue;
        }

        if (await isCloudflareBlocked(page)) {
          console.log('  ⚠️  Indeed protegido por Cloudflare. Busca Indeed indisponível neste ambiente.');
          console.log('  ℹ️  Dica: exporte cookies de uma sessão de navegador em data/indeed-cookies.json');
          break;
        }

        // Save cookies after first successful page load
        if (start === 0) {
          saveCookies(await context.cookies());
        }

        const pageKeys = await extractIndeedJobKeys(page);
        const sizeBefore = allKeys.size;
        for (const key of pageKeys) allKeys.add(key);
        const newCount = allKeys.size - sizeBefore;

        if (pageKeys.length === 0 || newCount === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
        } else {
          consecutiveEmpty = 0;
        }

        if (start > 0 && start % 50 === 0) {
          console.log(`  📄 Indeed: ${allKeys.size} vagas coletadas (start=${start})`);
        }

        await page.waitForTimeout(randomDelay(REQUEST_DELAY_MS));
      }
    } finally {
      await page.close().catch(() => undefined);
    }

    const jobKeys = Array.from(allKeys);
    if (jobKeys.length > 0) {
      console.log(`  📄 Indeed: ${jobKeys.length} vagas únicas encontradas.`);
    }
    return jobKeys.map((key) => `${INDEED_BASE_URL}/viewjob?jk=${key}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

if (require.main === module) {
  require('dotenv/config');
  const queryFromArgs = process.argv.slice(2).join(' ').trim();

  if (!queryFromArgs) {
    console.error('Uso: ts-node src/indeed-search.ts "<QUERY_DE_BUSCA>"');
    process.exit(1);
  }

  searchIndeedJobs(queryFromArgs)
    .then((urls) => {
      console.log(JSON.stringify(urls, null, 2));
      console.log(`Encontradas ${urls.length} vagas no Indeed.`);
    })
    .catch((err) => {
      console.error('Erro ao buscar vagas no Indeed:', err);
      process.exit(1);
    });
}
