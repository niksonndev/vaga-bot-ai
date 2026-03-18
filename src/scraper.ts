import { chromium, Browser, Page } from 'playwright';

export interface JobData {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
}

const LINKEDIN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function isIndeedUrl(url: string): boolean {
  return url.includes('indeed.com');
}

async function scrapeLinkedInJob(page: Page, url: string): Promise<JobData> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1.top-card-layout__title');

  const rawTitle = await page.textContent('h1.top-card-layout__title');
  const rawCompany = await page.textContent('a.topcard__org-name-link');
  const rawLocation = await page.textContent('span.topcard__flavor--bullet');
  const rawDescription = await page.evaluate(() => {
    const el = document.querySelector('div.description__text');
    return el ? (el as HTMLElement).innerText : '';
  });

  return {
    title: rawTitle?.trim() ?? '',
    company: rawCompany?.trim() ?? '',
    location: rawLocation?.trim() ?? '',
    description:
      rawDescription
        ?.replace(/\s*Show more\s*/gi, '')
        .replace(/\s*Show less\s*/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim() ?? '',
    url,
  };
}

async function scrapeIndeedJob(page: Page, url: string): Promise<JobData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForSelector('h1, [data-testid="jobsearch-JobInfoHeader-title"]', { timeout: 15000 });
  } catch { /* proceed anyway */ }

  const rawTitle = await page.evaluate(() => {
    const selectors = [
      'h1.jobsearch-JobInfoHeader-title',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h2.jobTitle',
      'h1',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  });

  const rawCompany = await page.evaluate(() => {
    const selectors = [
      '[data-testid="inlineHeader-companyName"] a',
      '[data-testid="inlineHeader-companyName"]',
      'div.jobsearch-InlineCompanyRating a',
      '[data-company-name="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  });

  const rawLocation = await page.evaluate(() => {
    const selectors = [
      '[data-testid="inlineHeader-companyLocation"]',
      '[data-testid="job-location"]',
      'div.jobsearch-InlineCompanyRating + div',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  });

  const rawDescription = await page.evaluate(() => {
    const selectors = [
      '#jobDescriptionText',
      'div.jobsearch-jobDescriptionText',
      'div.jobsearch-JobComponent-description',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return (el as HTMLElement).innerText;
    }
    return '';
  });

  return {
    title: rawTitle?.trim() ?? '',
    company: rawCompany?.trim() ?? '',
    location: rawLocation?.trim() ?? '',
    description: rawDescription?.replace(/\n{3,}/g, '\n\n').trim() ?? '',
    url,
  };
}

/**
 * Faz o scraping de uma vaga, detectando automaticamente a fonte (LinkedIn ou Indeed).
 */
export async function scrapeJob(url: string): Promise<JobData> {
  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: LINKEDIN_USER_AGENT,
    });

    page = await context.newPage();

    if (isIndeedUrl(url)) {
      return await scrapeIndeedJob(page, url);
    }

    return await scrapeLinkedInJob(page, url);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

// Permite usar o arquivo como CLI:
// npx ts-node src/scraper.ts "<URL_DA_VAGA>"
if (require.main === module) {
  const url = process.argv[2];

  if (!url) {
    console.error('Uso: ts-node src/scraper.ts <URL_DA_VAGA>');
    process.exit(1);
  }

  scrapeJob(url)
    .then((job) => {
      console.log(JSON.stringify(job, null, 2));
    })
    .catch((err) => {
      console.error('Erro ao fazer scraping:', err);
      process.exit(1);
    });
}
