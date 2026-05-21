/**
 * OZ Dashboard — Filiálky a synchronizace organizačního přehledu
 *
 * Zdrojem je vždy aktuální soubor ve zvolené Drive složce. Protože zdrojový
 * soubor se při aktualizaci maže a vkládá znovu, neukládáme pevné ID souboru,
 * ale při synchronizaci vždy projdeme obsah složky a vybereme nejnovější tabulku.
 */

const ACTION_WRITEOFFS_APP_KEY = 'VYHODNOCENI_ODPISU_AKCNICH_ARTIKLU';
const ACTION_WRITEOFFS_APP_NAME = 'Vyhodnocení odpisů akčních artiklů';
const ACTION_WRITEOFFS_FOLDER_ID_PROP = 'ACTION_WRITEOFFS_FOLDER_ID';
const ACTION_WRITEOFFS_SPREADSHEET_ID_PROP = 'ACTION_WRITEOFFS_SPREADSHEET_ID';
const BRANCH_SOURCE_FOLDER_ID_PROP = 'ACTION_WRITEOFFS_BRANCH_SOURCE_FOLDER_ID';
const BRANCH_LAST_SOURCE_FILE_ID_PROP = 'ACTION_WRITEOFFS_BRANCH_LAST_SOURCE_FILE_ID';
const BRANCH_LAST_SOURCE_FILE_NAME_PROP = 'ACTION_WRITEOFFS_BRANCH_LAST_SOURCE_FILE_NAME';
const BRANCH_LAST_SYNC_AT_PROP = 'ACTION_WRITEOFFS_BRANCH_LAST_SYNC_AT';
const BRANCH_SYNC_TRIGGER_FN = 'syncBranchesFromLatestSourceTrigger';

const BRANCH_DAY_FIELDS = [
  ['mondayOpen', 'mondayClose', ['pondeli', 'po', 'monday']],
  ['tuesdayOpen', 'tuesdayClose', ['utery', 'ut', 'tuesday']],
  ['wednesdayOpen', 'wednesdayClose', ['streda', 'st', 'wednesday']],
  ['thursdayOpen', 'thursdayClose', ['ctvrtek', 'ct', 'thursday']],
  ['fridayOpen', 'fridayClose', ['patek', 'pa', 'friday']],
  ['saturdayOpen', 'saturdayClose', ['sobota', 'so', 'saturday']],
  ['sundayOpen', 'sundayClose', ['nedele', 'ne', 'sunday']],
];

/**
 * Vrati data pro zalozku Filiálky.
 * @returns {Object}
 */
function getBranchesData() {
  const context = requirePermission_('branches.view');
  return buildBranchesData_(context);
}

/**
 * Ulozi ID zdrojove slozky s prehledem filialek.
 * @param {{ folderId: string }} payload
 * @returns {Object}
 */
function saveBranchesSourceFolder(payload) {
  const context = requirePermission_('branches.sync');
  const folderId = extractDriveId_(payload && payload.folderId);
  if (!folderId) throw new Error('Vyplňte ID zdrojové složky.');

  const folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty(BRANCH_SOURCE_FOLDER_ID_PROP, folder.getId());
  ensureActionWriteoffsResources_();
  ensureBranchesSyncTrigger_();
  Logger.log('[BRANCH_SOURCE_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
  return buildBranchesData_(context);
}

/**
 * Najde nejnovejsi zdrojovy soubor ve slozce a prepise list FILIALKY.
 * @returns {Object}
 */
function syncBranchesFromLatestSource() {
  const context = requirePermission_('branches.sync');
  syncBranchesFromLatestSourceInternal_(context.database.spreadsheet, context.user.email);
  return buildBranchesData_(context);
}

/**
 * Spoustec pro casovy trigger. Nevyuziva Session, protoze trigger bezi bez aktivniho web uzivatele.
 */
function syncBranchesFromLatestSourceTrigger() {
  const database = ensureDatabase_();
  syncBranchesFromLatestSourceInternal_(database.spreadsheet, 'trigger');
}

/**
 * Interni synchronizace spolecna pro UI i casovy trigger.
 * @param {Spreadsheet} targetSpreadsheet
 * @param {string} actor
 */
function syncBranchesFromLatestSourceInternal_(targetSpreadsheet, actor) {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(BRANCH_SOURCE_FOLDER_ID_PROP);
  if (!folderId) {
    throw new Error('Nejdříve nastavte ID složky se zdrojovým přehledem filiálek.');
  }

  ensureActionWriteoffsResources_();

  const sourceFile = findLatestBranchSourceFile_(folderId);
  if (!sourceFile) {
    throw new Error('Ve zdrojové složce nebyl nalezen žádný Google Spreadsheet.');
  }

  const sourceSpreadsheet = SpreadsheetApp.openById(sourceFile.getId());
  const sourceSheet = sourceSpreadsheet.getSheets()[0];
  const values = sourceSheet.getDataRange().getValues();
  const branches = parseBranchesFromValues_(values, sourceFile);
  writeBranches_(targetSpreadsheet, branches);

  const now = new Date().toISOString();
  props.setProperty(BRANCH_LAST_SOURCE_FILE_ID_PROP, sourceFile.getId());
  props.setProperty(BRANCH_LAST_SOURCE_FILE_NAME_PROP, sourceFile.getName());
  props.setProperty(BRANCH_LAST_SYNC_AT_PROP, now);
  Logger.log('[BRANCH_SYNC] by=%s file=%s rows=%s', actor, sourceFile.getId(), branches.length);
}

/**
 * Sestavi datovy objekt pro UI.
 * @param {Object} context
 * @returns {Object}
 */
function buildBranchesData_(context) {
  const spreadsheet = context.database.spreadsheet;
  const props = PropertiesService.getScriptProperties();
  const rows = getObjects_(spreadsheet.getSheetByName('FILIALKY')).map(mapBranchRow_);
  const activeRows = rows.filter(function(row) { return row.active; });

  return {
    auth: context.auth,
    canSync: hasPermission_(context.auth, 'branches.sync'),
    branches: activeRows,
    stats: {
      total: activeRows.length,
      lcCount: uniqueCount_(activeRows.map(function(row) { return row.lc; })),
      rmCount: uniqueCount_(activeRows.map(function(row) { return row.rm; })),
      vtCount: uniqueCount_(activeRows.map(function(row) { return row.vt; })),
    },
    sync: {
      sourceFolderId: props.getProperty(BRANCH_SOURCE_FOLDER_ID_PROP) || '',
      lastSourceFileId: props.getProperty(BRANCH_LAST_SOURCE_FILE_ID_PROP) || '',
      lastSourceFileName: props.getProperty(BRANCH_LAST_SOURCE_FILE_NAME_PROP) || '',
      lastSyncAt: props.getProperty(BRANCH_LAST_SYNC_AT_PROP) || '',
      subAppFolderId: props.getProperty(ACTION_WRITEOFFS_FOLDER_ID_PROP) || '',
      subAppSpreadsheetId: props.getProperty(ACTION_WRITEOFFS_SPREADSHEET_ID_PROP) || '',
    },
  };
}

/**
 * Vytvori Drive slozku a vlastni spreadsheet pro subaplikaci, pokud jeste nejsou ulozene.
 * @returns {{ folderId: string, spreadsheetId: string }}
 */
function ensureActionWriteoffsResources_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty(ACTION_WRITEOFFS_FOLDER_ID_PROP);
  let spreadsheetId = props.getProperty(ACTION_WRITEOFFS_SPREADSHEET_ID_PROP);

  if (!folderId) {
    const folder = DriveApp.createFolder(ACTION_WRITEOFFS_APP_NAME);
    folderId = folder.getId();
    props.setProperty(ACTION_WRITEOFFS_FOLDER_ID_PROP, folderId);
  }

  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create(ACTION_WRITEOFFS_APP_NAME + ' - data');
    spreadsheetId = spreadsheet.getId();
    props.setProperty(ACTION_WRITEOFFS_SPREADSHEET_ID_PROP, spreadsheetId);
    const infoSheet = spreadsheet.getSheets()[0];
    infoSheet.setName('INFO');
    infoSheet.getRange(1, 1, 4, 2).setValues([
      ['appKey', ACTION_WRITEOFFS_APP_KEY],
      ['appName', ACTION_WRITEOFFS_APP_NAME],
      ['createdAt', new Date()],
      ['note', 'Vlastni datovy sesit subaplikace. Referencni seznam filialek je ulozen v hlavni DB v listu FILIALKY.'],
    ]);

    try {
      const folder = DriveApp.getFolderById(folderId);
      const file = DriveApp.getFileById(spreadsheetId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
      Logger.log('[ACTION_WRITEOFFS_MOVE_FILE_FAIL] file=%s error=%s', spreadsheetId, e && e.message ? e.message : e);
    }
  }

  return { folderId, spreadsheetId };
}

/**
 * Zajisti hodinovy trigger pro automatickou synchronizaci filialek.
 */
function ensureBranchesSyncTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === BRANCH_SYNC_TRIGGER_FN;
  });
  if (exists) return;
  ScriptApp.newTrigger(BRANCH_SYNC_TRIGGER_FN).timeBased().everyHours(1).create();
  Logger.log('[BRANCH_SYNC_TRIGGER_CREATE] function=%s interval=1h', BRANCH_SYNC_TRIGGER_FN);
}

/**
 * Najde nejnovejsi Google Spreadsheet ve slozce podle data posledni aktualizace.
 * @param {string} folderId
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function findLatestBranchSourceFile_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  let latest = null;

  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    if (!latest || file.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) {
      latest = file;
    }
  }

  return latest;
}

/**
 * Prevede data ze zdrojove tabulky na normalizovane objekty filialek.
 * @param {Array[]} values
 * @param {GoogleAppsScript.Drive.File} sourceFile
 * @returns {Object[]}
 */
function parseBranchesFromValues_(values, sourceFile) {
  if (!values || values.length < 2) return [];

  const headers = values[0].map(normalizeBranchHeader_);
  const result = [];
  const sourceUpdatedAt = sourceFile.getLastUpdated();

  for (let row = 1; row < values.length; row++) {
    const raw = rowToObject_(headers, values[row]);
    const branch = normalizeBranchRow_(raw, sourceFile, row + 1, sourceUpdatedAt);
    if (!branch.storeNumber && !branch.storeName) continue;
    result.push(branch);
  }

  return result;
}

/**
 * Normalizuje jeden zdrojovy radek.
 * @param {Object} raw
 * @param {GoogleAppsScript.Drive.File} sourceFile
 * @param {number} sourceRow
 * @param {Date} sourceUpdatedAt
 * @returns {Object}
 */
function normalizeBranchRow_(raw, sourceFile, sourceRow, sourceUpdatedAt) {
  const branch = {
    id: Utilities.getUuid(),
    storeNumber: pickBranchValue_(raw, ['cprodejny', 'cisloprodejny', 'cislofilialky', 'cislo', 'prodejna', 'filialka', 'store', 'storenumber']),
    storeName: pickBranchValue_(raw, ['nazevfilialky', 'nazev', 'prodejnaNazev', 'name', 'storename']),
    abbreviation: pickBranchValue_(raw, ['zkratka', 'abbr', 'abbreviation', 'lc']),
    lc: pickBranchValue_(raw, ['lc', 'logistickecentrum', 'logistickecentrumlc']),
    storePhone: formatCzechPhone_(pickBranchValue_(raw, ['telefonprodejny', 'telefon', 'phone', 'storephone'])),
    vt: pickBranchValue_(raw, ['vt', 'oblastnimanager', 'oblastnivedouci']),
    rm: pickBranchValue_(raw, ['rm', 'regionalnimanager', 'regionalmanager']),
    rmPhone: formatCzechPhone_(pickBranchValue_(raw, ['telefonrm', 'rmtelefon', 'rmphone'])),
    sourceFileId: sourceFile.getId(),
    sourceFileName: sourceFile.getName(),
    sourceRow: sourceRow,
    sourceUpdatedAt: sourceUpdatedAt,
    syncedAt: new Date(),
    active: true,
  };

  BRANCH_DAY_FIELDS.forEach(function(day) {
    const openKey = day[0];
    const closeKey = day[1];
    const aliases = day[2];
    const openAliases = aliases.map(function(alias) { return alias + 'od'; })
      .concat(aliases.map(function(alias) { return alias + 'open'; }))
      .concat(aliases.map(function(alias) { return alias + 'otevreno'; }));
    const closeAliases = aliases.map(function(alias) { return alias + 'do'; })
      .concat(aliases.map(function(alias) { return alias + 'close'; }))
      .concat(aliases.map(function(alias) { return alias + 'zavreno'; }));
    branch[openKey] = pickBranchValue_(raw, openAliases);
    branch[closeKey] = pickBranchValue_(raw, closeAliases);

    if (!branch[openKey] && !branch[closeKey]) {
      const combined = pickBranchValue_(raw, aliases);
      const parsed = parseOpeningHours_(combined);
      branch[openKey] = parsed.open;
      branch[closeKey] = parsed.close;
    }
  });

  branch.rawHash = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(branch)),
  );
  return branch;
}

/**
 * Prepise list FILIALKY aktualnimi daty.
 * @param {Spreadsheet} spreadsheet
 * @param {Object[]} branches
 */
function writeBranches_(spreadsheet, branches) {
  const sheet = spreadsheet.getSheetByName('FILIALKY');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  if (!branches.length) return;

  const rows = branches.map(function(branch) {
    return headers.map(function(header) {
      return branch[header] !== undefined ? branch[header] : '';
    });
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Precte hodnotu podle seznamu moznych normalizovanych hlavicek.
 * @param {Object} row
 * @param {string[]} aliases
 * @returns {string}
 */
function pickBranchValue_(row, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const key = normalizeBranchHeader_(aliases[i]);
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return stringifyBranchCell_(row[key]);
    }
  }
  return '';
}

/**
 * Prevede bunku ze Sheets na stabilni text. Casove hodnoty ve zdroji chodi jako Date.
 * @param {*} value
 * @returns {string}
 */
function stringifyBranchCell_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(value).trim();
}

/**
 * Normalizuje hlavicku sloupce pro tolerantni mapovani.
 * @param {*} value
 * @returns {string}
 */
function normalizeBranchHeader_(value) {
  return removeDiacritics_(String(value || '')).replace(/[^a-z0-9]/g, '');
}

/**
 * Rozdeli hodnotu typu "7:00-20:00" na open/close.
 * @param {string} value
 * @returns {{ open: string, close: string }}
 */
function parseOpeningHours_(value) {
  const text = String(value || '').trim();
  if (!text) return { open: '', close: '' };
  const match = text.match(/(\d{1,2}[:.]\d{2}|\d{1,2})\s*[-–]\s*(\d{1,2}[:.]\d{2}|\d{1,2})/);
  if (!match) return { open: text, close: '' };
  return { open: normalizeTimeText_(match[1]), close: normalizeTimeText_(match[2]) };
}

/**
 * Normalizuje casovy text na HH:mm, pokud to jde.
 * @param {string} value
 * @returns {string}
 */
function normalizeTimeText_(value) {
  const text = String(value || '').trim().replace('.', ':');
  const parts = text.split(':');
  const hour = parts[0] || '';
  const minute = parts.length > 1 ? parts[1] : '00';
  if (!hour) return '';
  return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
}

/**
 * Normalizuje ceske telefonni cislo na format "+420 000 000 000", pokud to jde.
 * @param {string} value
 * @returns {string}
 */
function formatCzechPhone_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('00420')) digits = digits.slice(2);
  if (digits.length === 9) digits = '420' + digits;
  if (digits.length !== 12 || !digits.startsWith('420')) return text;
  return '+420 ' + digits.slice(3, 6) + ' ' + digits.slice(6, 9) + ' ' + digits.slice(9, 12);
}

/**
 * Převede řádek listu FILIALKY pro klienta.
 * @param {Object} row
 * @returns {Object}
 */
function mapBranchRow_(row) {
  return {
    id: String(row.id || ''),
    storeNumber: String(row.storeNumber || ''),
    storeName: String(row.storeName || ''),
    abbreviation: String(row.abbreviation || ''),
    lc: String(row.lc || ''),
    storePhone: String(row.storePhone || ''),
    vt: String(row.vt || ''),
    rm: String(row.rm || ''),
    rmPhone: String(row.rmPhone || ''),
    mondayOpen: stringifyBranchCell_(row.mondayOpen),
    mondayClose: stringifyBranchCell_(row.mondayClose),
    tuesdayOpen: stringifyBranchCell_(row.tuesdayOpen),
    tuesdayClose: stringifyBranchCell_(row.tuesdayClose),
    wednesdayOpen: stringifyBranchCell_(row.wednesdayOpen),
    wednesdayClose: stringifyBranchCell_(row.wednesdayClose),
    thursdayOpen: stringifyBranchCell_(row.thursdayOpen),
    thursdayClose: stringifyBranchCell_(row.thursdayClose),
    fridayOpen: stringifyBranchCell_(row.fridayOpen),
    fridayClose: stringifyBranchCell_(row.fridayClose),
    saturdayOpen: stringifyBranchCell_(row.saturdayOpen),
    saturdayClose: stringifyBranchCell_(row.saturdayClose),
    sundayOpen: stringifyBranchCell_(row.sundayOpen),
    sundayClose: stringifyBranchCell_(row.sundayClose),
    sourceFileId: String(row.sourceFileId || ''),
    sourceFileName: String(row.sourceFileName || ''),
    sourceUpdatedAt: formatDateValue_(row.sourceUpdatedAt),
    syncedAt: formatDateValue_(row.syncedAt),
    active: isTruthy_(row.active),
  };
}

/**
 * Pocet unikatnich neprázdných hodnot.
 * @param {string[]} values
 * @returns {number}
 */
function uniqueCount_(values) {
  const seen = {};
  values.forEach(function(value) {
    const key = String(value || '').trim();
    if (key) seen[key] = true;
  });
  return Object.keys(seen).length;
}

/**
 * Z URL nebo prime hodnoty vytahne Drive ID.
 * @param {*} value
 * @returns {string}
 */
function extractDriveId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const foldersMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (foldersMatch) return foldersMatch[1];
  const idMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return text;
}
