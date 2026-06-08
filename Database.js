/**
 * OZ Dashboard — Správa databáze
 *
 * Zajišťuje bootstrap databázového spreadsheetu, migraci schématu a seed dat.
 * Ostatní moduly přistupují k databázi výhradně přes ensureDatabase_().
 */

/** Aktuální verze databázového schématu. Navyšte při přidání nových listů/sloupců. */
const DATABASE_SCHEMA_VERSION = '4';

/** TTL cache záznamu o databázi v sekundách (6 hodin). */
const DATABASE_CACHE_TTL_SECONDS = 21600;

// ---------------------------------------------------------------------------
// Hlavní vstupní bod
// ---------------------------------------------------------------------------

/**
 * Zajistí přístup k databázovému spreadsheetu.
 *
 * Strategie:
 *   1. Fast path: CacheService (6 h TTL) — žádné PropertiesService I/O.
 *   2. PropertiesService — pokud cache chybí nebo je zastaralá.
 *   3. Vytvoření nového spreadsheetu — při prvním spuštění nebo po ztrátě reference.
 *
 * Přechodné chyby (timeout, výpadek API) neodstraní uloženou referenci.
 * Permanentní chyby (spreadsheet smazán) referenci odstraní a vytvoří nový.
 *
 * @returns {{ spreadsheet: Spreadsheet, spreadsheetId: string, spreadsheetUrl: string }}
 * @throws {Error} při přechodné nedostupnosti databáze
 */
function ensureDatabase_() {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const CACHE_KEY = 'DATABASE_INFO_V2';

  // 1. Fast path: vše v cache — žádné PropertiesService I/O
  const cachedJson = cache.get(CACHE_KEY);
  if (cachedJson) {
    try {
      const cached = JSON.parse(cachedJson);
      if (cached.id && cached.schemaVersion === DATABASE_SCHEMA_VERSION) {
        const spreadsheet = SpreadsheetApp.openById(cached.id);
        return { spreadsheet, spreadsheetId: cached.id, spreadsheetUrl: spreadsheet.getUrl() };
      }
    } catch (e) {
      cache.remove(CACHE_KEY);
      Logger.log('[DATABASE_CACHE_INVALID] error=%s', e && e.message ? e.message : e);
    }
  }

  // 2. Cache miss nebo stará verze schématu — PropertiesService
  const storedId = props.getProperty('DATABASE_SPREADSHEET_ID');

  if (storedId) {
    try {
      const spreadsheet = SpreadsheetApp.openById(storedId);
      ensureDatabaseSchema_(spreadsheet, props);
      cache.put(CACHE_KEY, JSON.stringify({ id: storedId, schemaVersion: DATABASE_SCHEMA_VERSION }), DATABASE_CACHE_TTL_SECONDS);
      return { spreadsheet, spreadsheetId: storedId, spreadsheetUrl: spreadsheet.getUrl() };
    } catch (e) {
      cache.remove(CACHE_KEY);
      const msg = String(e && e.message ? e.message : e).toLowerCase();
      const isPermanent = msg.includes('not found') || msg.includes('does not exist') ||
                          msg.includes('unable to find') || msg.includes('no item with the given id');
      if (isPermanent) {
        // Spreadsheet skutečně neexistuje — smažeme referenci a vytvoříme nový
        props.deleteProperty('DATABASE_SPREADSHEET_ID');
        props.deleteProperty('DATABASE_SPREADSHEET_URL');
        props.deleteProperty('DATABASE_SCHEMA_VERSION');
        Logger.log('[DATABASE_MISSING] id=%s error=%s — reference smazána, bude vytvořena nová DB', storedId, e.message);
      } else {
        // Přechodná chyba (výpadek API, timeout) — referenci zachováme
        Logger.log('[DATABASE_ERROR] id=%s error=%s — přechodná chyba, reference zachována', storedId, e.message);
        throw new Error('Databáze je dočasně nedostupná. Zkuste to znovu za chvíli.');
      }
    }
  }

  // 3. První spuštění nebo obnova po ztrátě reference
  return createNewDatabase_(props, cache, CACHE_KEY);
}

// ---------------------------------------------------------------------------
// Interní funkce pro správu schématu
// ---------------------------------------------------------------------------

/**
 * Zkontroluje a případně migruje schéma existujícího spreadsheetu.
 * Používá lock pro ochranu před souběžnými migracemi.
 * @param {Spreadsheet} spreadsheet
 * @param {PropertiesService.Properties} props
 */
function ensureDatabaseSchema_(spreadsheet, props) {
  if (props.getProperty('DATABASE_SCHEMA_VERSION') === DATABASE_SCHEMA_VERSION) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Double-check po získání zámku
    if (props.getProperty('DATABASE_SCHEMA_VERSION') === DATABASE_SCHEMA_VERSION) return;
    setupDatabaseSheets_(spreadsheet);
    props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
    props.setProperty('DATABASE_SPREADSHEET_URL', spreadsheet.getUrl());
    Logger.log('[DATABASE_SCHEMA] migrováno na verzi %s', DATABASE_SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Vytvoří nový databázový spreadsheet, nastaví schéma a uloží referenci.
 * @param {PropertiesService.Properties} props
 * @param {CacheService.Cache} cache
 * @param {string} CACHE_KEY
 * @returns {{ spreadsheet: Spreadsheet, spreadsheetId: string, spreadsheetUrl: string }}
 */
function createNewDatabase_(props, cache, CACHE_KEY) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Double-check — jiný request mohl DB vytvořit mezitím
    const recheckId = props.getProperty('DATABASE_SPREADSHEET_ID');
    if (recheckId) {
      const spreadsheet = SpreadsheetApp.openById(recheckId);
      if (props.getProperty('DATABASE_SCHEMA_VERSION') !== DATABASE_SCHEMA_VERSION) {
        setupDatabaseSheets_(spreadsheet);
        props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
      }
      cache.put(CACHE_KEY, JSON.stringify({ id: recheckId, schemaVersion: DATABASE_SCHEMA_VERSION }), DATABASE_CACHE_TTL_SECONDS);
      return { spreadsheet, spreadsheetId: recheckId, spreadsheetUrl: spreadsheet.getUrl() };
    }

    const spreadsheet = SpreadsheetApp.create(APP_CONFIG.appName + ' - databaze');
    const spreadsheetId = spreadsheet.getId();
    props.setProperty('DATABASE_SPREADSHEET_ID', spreadsheetId);
    props.setProperty('DATABASE_SPREADSHEET_URL', spreadsheet.getUrl());
    setupDatabaseSheets_(spreadsheet);
    props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
    cache.put(CACHE_KEY, JSON.stringify({ id: spreadsheetId, schemaVersion: DATABASE_SCHEMA_VERSION }), DATABASE_CACHE_TTL_SECONDS);
    seedInitialUserIfNeeded_(spreadsheet);
    Logger.log('[DATABASE_CREATE] nová DB vytvořena id=%s', spreadsheetId);
    return { spreadsheet, spreadsheetId, spreadsheetUrl: spreadsheet.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Vytvoří všechny potřebné listy v databázovém spreadsheetu.
 * Bezpečné opakované volání — existující listy a data se nepoškodí.
 * @param {Spreadsheet} spreadsheet
 */
function setupDatabaseSheets_(spreadsheet) {
  ensureSheet_(spreadsheet, 'CONFIG', [
    'key', 'value', 'description', 'updatedAt', 'updatedBy',
  ], [
    ['appName',              APP_CONFIG.appName,       'Nazev aplikace',              new Date(), 'system'],
    ['appVersion',           APP_CONFIG.version,       'Verze aplikace',              new Date(), 'system'],
    ['databaseSchemaVersion', DATABASE_SCHEMA_VERSION, 'Verze databazove struktury',  new Date(), 'system'],
  ]);

  ensureSheet_(spreadsheet, 'USERS', [
    'id', 'email', 'firstName', 'lastName', 'lastVisitAt',
    'locationType', 'locationName', 'department',
    'systemRole', 'accessRole', 'active', 'createdAt', 'updatedAt',
  ]);

  ensureSheet_(spreadsheet, 'ROLES', [
    'roleKey', 'roleName', 'description', 'active', 'createdAt', 'updatedAt',
  ], [
    ['SUPERADMIN', 'Superadmin', 'Plný přístup k aplikaci a administraci',   true, new Date(), new Date()],
    ['ADMIN',      'Admin',      'Správa vybraných částí aplikace',           true, new Date(), new Date()],
    ['EDITOR',     'Editor',     'Práce s daty v přidělených modulech',       true, new Date(), new Date()],
    ['VIEWER',     'Viewer',     'Pouze čtení přidělených modulů',            true, new Date(), new Date()],
  ]);

  ensureSheet_(spreadsheet, 'ROLE_PERMISSIONS', [
    'roleKey', 'permissionKey', 'allowed', 'description', 'updatedAt',
  ], [
    ['SUPERADMIN', '*',              true, 'Všechna oprávnění',          new Date()],
    ['ADMIN',      'dashboard.view', true, 'Zobrazení dashboardu',       new Date()],
    ['ADMIN',      'users.manage',   true, 'Správa uživatelů',           new Date()],
    ['ADMIN',      'roles.manage',   true, 'Správa rolí a oprávnění',    new Date()],
    ['EDITOR',     'dashboard.view', true, 'Zobrazení dashboardu',       new Date()],
    ['VIEWER',     'dashboard.view', true, 'Zobrazení dashboardu',       new Date()],
  ]);
  ensureRolePermissions_(spreadsheet, [
    ['ADMIN',  'branches.view', true, 'Zobrazení přehledu filiálek', new Date()],
    ['ADMIN',  'branches.sync', true, 'Synchronizace přehledu filiálek', new Date()],
    ['EDITOR', 'branches.view', true, 'Zobrazení přehledu filiálek', new Date()],
    ['VIEWER', 'branches.view', true, 'Zobrazení přehledu filiálek', new Date()],
  ]);

  ensureSheet_(spreadsheet, 'SUBAPP_PERMISSIONS', [
    'id', 'userId', 'email', 'subAppKey', 'accessLevel', 'active', 'updatedAt', 'updatedBy',
  ]);

  ensureSheet_(spreadsheet, 'SUBAPPS', [
    'id', 'key', 'name', 'status', 'icon', 'description', 'targetUrl',
    'lastUpdatedAt', 'sortOrder', 'active', 'createdAt', 'updatedAt',
  ]);

  ensureSheet_(spreadsheet, 'LOCATIONS', [
    'id', 'type', 'code', 'abbreviation', 'city', 'name', 'active', 'createdAt', 'updatedAt',
  ], [
    [Utilities.getUuid(), 'CENTRALA', '', '', '', 'Centrála', true, new Date(), new Date()],
  ]);

  ensureSheet_(spreadsheet, 'DEPARTMENTS', [
    'id', 'name', 'locationIds', 'active', 'createdAt', 'updatedAt',
  ], [
    [Utilities.getUuid(), 'OZ', '', true, new Date(), new Date()],
  ]);

  ensureSheet_(spreadsheet, 'FILIALKY', [
    'id', 'storeNumber', 'storeName', 'lc',
    'storePhone', 'vt', 'rm', 'rmPhone',
    'mondayOpen', 'mondayClose', 'tuesdayOpen', 'tuesdayClose',
    'wednesdayOpen', 'wednesdayClose', 'thursdayOpen', 'thursdayClose',
    'fridayOpen', 'fridayClose', 'saturdayOpen', 'saturdayClose',
    'sundayOpen', 'sundayClose',
    'sourceFileId', 'sourceFileName', 'sourceRow', 'sourceUpdatedAt',
    'syncedAt', 'rawHash', 'active',
  ]);
}

/**
 * Doplni seedovana opravneni i do existujiciho ROLE_PERMISSIONS listu.
 * ensureSheet_ seeduje jen prazdny list, proto nove permission keys migrujeme explicitne.
 * @param {Spreadsheet} spreadsheet
 * @param {Array[]} rows
 */
function ensureRolePermissions_(spreadsheet, rows) {
  const sheet = spreadsheet.getSheetByName('ROLE_PERMISSIONS');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const roleIdx = headers.indexOf('roleKey');
  const permIdx = headers.indexOf('permissionKey');
  const existing = {};

  for (let row = 1; row < values.length; row++) {
    const key = String(values[row][roleIdx] || '').trim().toUpperCase() + '|' + String(values[row][permIdx] || '').trim();
    existing[key] = true;
  }

  rows.forEach(function(seed) {
    const key = String(seed[0] || '').trim().toUpperCase() + '|' + String(seed[1] || '').trim();
    if (existing[key]) return;
    const rowValues = headers.map(function(header) {
      const map = {
        roleKey: seed[0],
        permissionKey: seed[1],
        allowed: seed[2],
        description: seed[3],
        updatedAt: seed[4],
      };
      return map[header] !== undefined ? map[header] : '';
    });
    sheet.appendRow(rowValues);
    existing[key] = true;
  });
}

/**
 * Zajistí existenci sheetu se zadaným schématem.
 * Pokud sheet neexistuje, vytvoří ho se záhlavím a seed daty.
 * Pokud existuje, pouze doplní chybějící sloupce — existující data se nepoškodí.
 *
 * @param {Spreadsheet} spreadsheet
 * @param {string} name - název listu
 * @param {string[]} headers - požadované sloupce v pořadí
 * @param {Array[]=} seedRows - volitelné seed řádky pro prázdný list
 * @returns {Sheet}
 */
function ensureSheet_(spreadsheet, name, headers, seedRows) {
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
    if (seedRows && seedRows.length) {
      sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
    }
    return sheet;
  }

  // List existuje — přidáme chybějící sloupce, nikdy nesmažeme existující data
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
    : [];

  const missing = headers.filter(function(h) { return existingHeaders.indexOf(h) < 0; });
  if (missing.length > 0) {
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
    Logger.log('[SCHEMA] List "%s": přidány sloupce: %s', name, missing.join(', '));
  }

  // Seed pouze pokud list nemá žádná data
  if (seedRows && seedRows.length && sheet.getLastRow() < 2) {
    const currentHeaders = lastCol > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      : headers;
    const reordered = seedRows.map(function(row) {
      return currentHeaders.map(function(h) {
        const i = headers.indexOf(h);
        return i >= 0 ? row[i] : '';
      });
    });
    sheet.getRange(2, 1, reordered.length, currentHeaders.length).setValues(reordered);
  }

  return sheet;
}

/**
 * Vytvoří prvního superadmin uživatele, pokud je USERS list prázdný.
 * Zakladatel je přihlášený uživatel (vlastník skriptu při prvním spuštění).
 * @param {Spreadsheet} spreadsheet
 */
function seedInitialUserIfNeeded_(spreadsheet) {
  const usersSheet = spreadsheet.getSheetByName('USERS');
  if (usersSheet.getLastRow() > 1) return;

  const email = getSignedInUser_();
  const now = new Date();
  usersSheet.appendRow([
    Utilities.getUuid(),
    email,
    getFirstNameFromEmail_(email),
    '',
    now,          // lastVisitAt
    'CENTRALA',
    'Centrála',
    'OZ',
    'SUPERADMIN', // systemRole
    'SUPERADMIN', // accessRole
    true,         // active
    now,          // createdAt
    now,          // updatedAt
  ]);
  Logger.log('[SEED] První superadmin vytvořen: %s v %s', email, now.toISOString());
}
