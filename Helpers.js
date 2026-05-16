/**
 * OZ Dashboard — Sdílené pomocné funkce
 *
 * Nízkoúrovňové utility používané napříč celým projektem.
 * Žádná z funkcí zde nevolá jiné domenové moduly.
 */

// ---------------------------------------------------------------------------
// Spreadsheet helpers
// ---------------------------------------------------------------------------

/**
 * Načte všechny datové řádky ze sheetu jako pole objektů { header → hodnota }.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object[]}
 */
function getObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(function(row) { return rowToObject_(headers, row); });
}

/**
 * Převede jeden řádek (pole hodnot) na objekt, kde klíčem je název sloupce.
 * @param {string[]} headers
 * @param {Array} row
 * @returns {Object}
 */
function rowToObject_(headers, row) {
  return headers.reduce(function(object, header, index) {
    object[header] = row[index];
    return object;
  }, {});
}

// ---------------------------------------------------------------------------
// Hodnoty a typy
// ---------------------------------------------------------------------------

/**
 * Univerzální pravdivostní test pro hodnoty uložené v Google Sheets.
 * Akceptuje boolean true, '1', 'true', 'ano', 'yes', 'active', 'aktivni'.
 * @param {*} value
 * @returns {boolean}
 */
function isTruthy_(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'ano', 'yes', 'active', 'aktivni'].includes(normalized);
}

/**
 * Formátuje datumovou hodnotu z Sheets (Date objekt nebo string) na ISO string.
 * @param {*} value
 * @returns {string}
 */
function formatDateValue_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return String(value);
}

// ---------------------------------------------------------------------------
// Textové utility
// ---------------------------------------------------------------------------

/**
 * Odstraní diakritiku a vrátí pouze písmena a číslice (lowercase).
 * @param {string} str
 * @returns {string}
 */
function removeDiacritics_(str) {
  const map = {
    'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i',
    'ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z',
  };
  return String(str || '').toLowerCase()
    .split('')
    .map(function(c) { return map[c] || c; })
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extrahuje křestní jméno z e-mailové adresy (první část před @ a tečkou/pomlčkou).
 * @param {string} email
 * @returns {string}
 */
function getFirstNameFromEmail_(email) {
  const local = String(email || '').split('@')[0];
  const first = local.split(/[._-]+/).filter(Boolean)[0] || local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

// ---------------------------------------------------------------------------
// Autorizační helper
// ---------------------------------------------------------------------------

/**
 * Vrátí true, pokud auth odpovídá SUPERADMIN nebo ADMIN (system nebo access role).
 * Slouží pro přístup k funkcím vyhrazeným správcům (např. otevírání "PREPARING" dlaždic).
 * @param {Object} auth - auth objekt z getCurrentUserContext_()
 * @returns {boolean}
 */
function isAdminAuth_(auth) {
  const systemRole = String(auth && auth.systemRole || '').toUpperCase();
  const accessRole = String(auth && auth.accessRole || '').toUpperCase();
  return ['SUPERADMIN', 'ADMIN'].indexOf(systemRole) >= 0
      || ['SUPERADMIN', 'ADMIN'].indexOf(accessRole) >= 0;
}
