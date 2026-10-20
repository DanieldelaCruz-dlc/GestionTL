import * as XLSX from 'xlsx';

// Convierte una hoja de cálculo en JSON buscando automáticamente en qué fila están los encabezados reales
function sheetToCleanJson(worksheet) {
  // Leemos toda la hoja como matriz de filas (array de arrays)
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!rawRows || rawRows.length === 0) return [];

  // Buscamos cuál es la fila de encabezados (la primera fila que tenga al menos 3 celdas con texto relevante)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
    const rowStr = rawRows[i].map((cell) => String(cell || '').toUpperCase().trim()).join(' | ');
    if (
      rowStr.includes('COUNTRY') ||
      rowStr.includes('FINAL PRICE') ||
      rowStr.includes('STATUS') ||
      rowStr.includes('TEAMLEADER') ||
      rowStr.includes('ASESORES') ||
      rowStr.includes('PEROP1AM')
    ) {
      headerRowIndex = i;
      break;
    }
  }

  const headers = rawRows[headerRowIndex].map((h, idx) => {
    const clean = String(h || '').trim();
    return clean || `COL_${idx}`;
  });

  const dataRows = rawRows.slice(headerRowIndex + 1);

  return dataRows
    .filter((row) => row.some((cell) => String(cell || '').trim() !== ''))
    .map((row) => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx] !== undefined ? row[idx] : '';
      });
      return obj;
    });
}

// 1. Leer archivo Excel local (.xls, .xlsx, .csv)
export async function readExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return sheetToCleanJson(worksheet);
}

// 2. Extraer ID del documento desde el link de Google Sheets
export function extractSpreadsheetId(urlOrId) {
  if (!urlOrId) return '';
  const trimmed = urlOrId.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

// 3. Descargar datos desde una pestaña de Google Sheets
// 3. Descargar datos desde una pestaña de Google Sheets (Sin caché para traer datos en tiempo real)
export async function fetchGoogleSheet(urlOrId, sheetName = '') {
  const spreadsheetId = extractSpreadsheetId(urlOrId);
  if (!spreadsheetId) {
    throw new Error('Ingresa un enlace válido de Google Sheets.');
  }

  let exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
  if (sheetName && sheetName.trim() !== '') {
    exportUrl += `&sheet=${encodeURIComponent(sheetName.trim())}`;
  }

  // cache: 'no-store' obliga al navegador a consultar Google Sheets en tiempo real siempre
  const response = await fetch(exportUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `No se pudo leer la pestaña "${sheetName}". Verifica que el nombre de la pestaña coincida y el archivo sea público con enlace.`
    );
  }

  const csvText = await response.text();

  if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
    throw new Error(
      'El Google Sheet está restringido. En Google Sheets haz clic en "Compartir" -> "Cualquier persona con el enlace (Lector)".'
    );
  }

  const workbook = XLSX.read(csvText, { type: 'string', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return sheetToCleanJson(worksheet);
}