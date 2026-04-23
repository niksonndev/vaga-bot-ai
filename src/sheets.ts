import { google, sheets_v4 } from 'googleapis';
import type { AnalysisResult } from './analyzer';
import type { JobData } from './scraper';

const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

interface SheetsConfig {
  spreadsheetId: string;
  worksheetName: string;
  clientEmail: string;
  privateKey: string;
}

function readSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const worksheetName = process.env.GOOGLE_SHEETS_WORKSHEET_NAME?.trim();
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!spreadsheetId || !worksheetName || !clientEmail || !privateKey) {
    return null;
  }

  return { spreadsheetId, worksheetName, clientEmail, privateKey };
}

let cachedClient: { config: SheetsConfig; sheets: sheets_v4.Sheets } | null = null;

function getSheetsClient(config: SheetsConfig): sheets_v4.Sheets {
  if (
    cachedClient &&
    cachedClient.config.clientEmail === config.clientEmail &&
    cachedClient.config.privateKey === config.privateKey
  ) {
    return cachedClient.sheets;
  }

  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SHEETS_SCOPES,
  });

  const sheets = google.sheets({ version: 'v4', auth });
  cachedClient = { config, sheets };
  return sheets;
}

export function isSheetsEnabled(): boolean {
  return readSheetsConfig() !== null;
}

export async function appendJobToSheet(job: JobData, analysis: AnalysisResult): Promise<void> {
  const config = readSheetsConfig();
  if (!config) {
    throw new Error(
      'Configuração do Google Sheets incompleta. Defina GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_WORKSHEET_NAME, GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
    );
  }

  const sheets = getSheetsClient(config);

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.worksheetName}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          job.url,
          job.title,
          job.company,
          analysis.relevant ? 'true' : 'false',
          analysis.category,
        ],
      ],
    },
  });
}
