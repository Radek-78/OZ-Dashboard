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
  setConfigValue_('branchSourceFolderId', folder.getId(), context.user.email);
  ensureActionWriteoffsResources_();
  ensureBranchesSyncTrigger_();
  Logger.log('[BRANCH_SOURCE_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
  return buildBranchesData_(context);
}

/**
 * Uloží nastavení synchronizace filiálek (zdrojová složka, dočasná složka, vyhledávací výraz).
 * @param {{ folderId?: string, tempFolderId?: string, searchPattern?: string }} payload
 * @returns {Object}
 */
function saveBranchesSyncSettings(payload) {
  const context = requirePermission_('branches.sync');

  if (payload.folderId !== undefined) {
    const folderId = extractDriveId_(payload.folderId);
    if (!folderId) throw new Error('Vyplňte ID zdrojové složky.');
    const folder = DriveApp.getFolderById(folderId);
    setConfigValue_('branchSourceFolderId', folder.getId(), context.user.email);
    Logger.log('[BRANCH_SOURCE_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
  }

  if (payload.tempFolderId !== undefined) {
    const tempFolderId = extractDriveId_(payload.tempFolderId);
    if (tempFolderId) {
      const folder = DriveApp.getFolderById(tempFolderId);
      setConfigValue_('branchTempFolderId', folder.getId(), context.user.email);
      Logger.log('[BRANCH_TEMP_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
    } else {
      setConfigValue_('branchTempFolderId', '', context.user.email);
      Logger.log('[BRANCH_TEMP_FOLDER_DELETE] by=%s', context.user.email);
    }
  }

  if (payload.searchPattern !== undefined) {
    const pattern = String(payload.searchPattern || '').trim();
    setConfigValue_('branchSearchPattern', pattern, context.user.email);
    Logger.log('[BRANCH_SEARCH_PATTERN_SET] by=%s pattern=%s', context.user.email, pattern);
  }

  ensureActionWriteoffsResources_();
  ensureBranchesSyncTrigger_();

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
 * Hromadne nastavi priznak aktivni/neaktivni u vybranych filialek.
 * Neaktivni filialky se ve frontendu beznym uzivatelum vubec nenactou.
 * @param {{ ids: string[], active: boolean }} payload
 * @returns {Object}
 */
function setBranchesActive(payload) {
  const context = requirePermission_('branches.sync');
  const ids = (payload && payload.ids) || [];
  const active = !!(payload && payload.active);
  if (!ids.length) return buildBranchesData_(context);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = context.database.spreadsheet.getSheetByName('FILIALKY');
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return buildBranchesData_(context);
    const headers = values[0].map(String);
    const idIdx = headers.indexOf('id');
    const activeIdx = headers.indexOf('active');
    if (idIdx === -1 || activeIdx === -1) throw new Error('List FILIALKY nemá sloupec id nebo active.');

    const idSet = {};
    ids.forEach(function(id) { idSet[String(id)] = true; });

    const activeColumn = [];
    for (let r = 0; r < values.length; r++) {
      if (r === 0) { activeColumn.push([values[0][activeIdx]]); continue; }
      activeColumn.push([idSet[String(values[r][idIdx])] ? active : values[r][activeIdx]]);
    }
    sheet.getRange(1, activeIdx + 1, values.length, 1).setValues(activeColumn);
  } finally {
    lock.releaseLock();
  }

  Logger.log('[BRANCH_ACTIVE_SET] by=%s count=%s active=%s', context.user.email, ids.length, active);
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
  const folderId = getConfigValue_('branchSourceFolderId');
  if (!folderId) {
    throw new Error('Nejdříve nastavte ID složky se zdrojovým přehledem filiálek.');
  }

  const tempFolderId = getConfigValue_('branchTempFolderId') || folderId;

  ensureActionWriteoffsResources_();

  const sourceFile = findLatestBranchSourceFile_(folderId);
  if (!sourceFile) {
    throw new Error('Ve zdrojové složce nebyl nalezen žádný Google Spreadsheet ani Excel (.xlsx) soubor.');
  }

  let sourceSpreadsheet;
  let tempSheetId = null;
  const isXlsx = sourceFile.getMimeType() !== MimeType.GOOGLE_SHEETS;

  try {
    if (isXlsx) {
      tempSheetId = convertXlsxToTempGoogleSheet_(sourceFile, tempFolderId);
      sourceSpreadsheet = SpreadsheetApp.openById(tempSheetId);
    } else {
      sourceSpreadsheet = SpreadsheetApp.openById(sourceFile.getId());
    }

    const sourceSheet = sourceSpreadsheet.getSheets()[0];
    const values = sourceSheet.getDataRange().getValues();
    const branches = parseBranchesFromValues_(values, sourceFile);
    writeBranchesWithAudit_(targetSpreadsheet, branches, sourceFile, actor);

    const now = new Date().toISOString();
    props.setProperty(BRANCH_LAST_SOURCE_FILE_ID_PROP, sourceFile.getId());
    props.setProperty(BRANCH_LAST_SOURCE_FILE_NAME_PROP, sourceFile.getName());
    props.setProperty(BRANCH_LAST_SYNC_AT_PROP, now);
    Logger.log('[BRANCH_SYNC] by=%s file=%s rows=%s type=%s', actor, sourceFile.getId(), branches.length, isXlsx ? 'xlsx' : 'g-sheet');
  } finally {
    if (tempSheetId) {
      try {
        DriveApp.getFileById(tempSheetId).setTrashed(true);
      } catch (e) {
        Logger.log('[BRANCH_SYNC_CLEANUP_FAIL] tempId=%s error=%s', tempSheetId, e && e.message ? e.message : e);
      }
    }
  }
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
  const allLocations = getObjects_(spreadsheet.getSheetByName('LOCATIONS'))
    .map(mapLocationRow_)
    .sort(locationSortFn_);
  const lcs = allLocations.filter(function(loc) { return loc.type === 'LC' && loc.active; });
  const canSync = hasPermission_(context.auth, 'branches.sync');
  const canManageLocations = hasPermission_(context.auth, 'users.manage');

  return {
    auth: context.auth,
    canSync: canSync,
    canManageLocations: canManageLocations,
    // Admin (sprava) vidi i neaktivni filialky kvuli reaktivaci; ostatni jen aktivni.
    branches: canSync ? rows : activeRows,
    lcs: lcs,
    // Ne-LC umisteni (Centrala + ostatni) pro podzalozku Umisteni. Neaktivni vidi jen spravce.
    locations: allLocations.filter(function(loc) {
      return loc.type !== 'LC' && (canManageLocations || loc.active);
    }),
    syncTriggerActive: canSync ? branchesSyncTriggerExists_() : null,
    stats: {
      total: activeRows.length,
      lcCount: uniqueCount_(activeRows.map(function(row) { return row.lc; })),
      rmCount: uniqueCount_(activeRows.map(function(row) { return row.rm; })),
      vtCount: uniqueCount_(activeRows.map(function(row) { return row.vt; })),
    },
    sync: {
      sourceFolderId: getConfigValue_('branchSourceFolderId') || '',
      tempFolderId: getConfigValue_('branchTempFolderId') || '',
      searchPattern: getConfigValue_('branchSearchPattern') || '',
      lastSourceFileId: props.getProperty(BRANCH_LAST_SOURCE_FILE_ID_PROP) || '',
      lastSourceFileName: props.getProperty(BRANCH_LAST_SOURCE_FILE_NAME_PROP) || '',
      lastSyncAt: props.getProperty(BRANCH_LAST_SYNC_AT_PROP) || '',
      subAppFolderId: props.getProperty(ACTION_WRITEOFFS_FOLDER_ID_PROP) || '',
      subAppSpreadsheetId: props.getProperty(ACTION_WRITEOFFS_SPREADSHEET_ID_PROP) || '',
    },
    syncHistory: (function() {
      const runsSheet = spreadsheet.getSheetByName('FILIALKY_SYNC_RUNS');
      if (!runsSheet || runsSheet.getLastRow() < 2) return [];
      return getObjects_(runsSheet)
        .map(function(run) {
          return {
            id: run.id,
            syncedAt: formatDateValue_(run.syncedAt),
            actor: run.actor,
            fileName: run.fileName,
            fileId: run.fileId,
            addedCount: Number(run.addedCount || 0),
            updatedCount: Number(run.updatedCount || 0),
            deletedCount: Number(run.deletedCount || 0),
            noChangeCount: Number(run.noChangeCount || 0)
          };
        })
        .sort(function(a, b) {
          return new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime();
        })
        .slice(0, 20);
    })(),
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
 * Zjisti, zda existuje casovy trigger pro automatickou synchronizaci filialek.
 * @returns {boolean}
 */
function branchesSyncTriggerExists_() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === BRANCH_SYNC_TRIGGER_FN;
  });
}

/**
 * Zajisti hodinovy trigger pro automatickou synchronizaci filialek.
 */
function ensureBranchesSyncTrigger_() {
  if (branchesSyncTriggerExists_()) return;
  ScriptApp.newTrigger(BRANCH_SYNC_TRIGGER_FN).timeBased().everyHours(1).create();
  Logger.log('[BRANCH_SYNC_TRIGGER_CREATE] function=%s interval=1h', BRANCH_SYNC_TRIGGER_FN);
}

/**
 * Zkontroluje a v pripade potreby vytvori trigger automaticke synchronizace.
 * Volano z UI (zalozka Synchronizace).
 * @returns {Object}
 */
function setupBranchesSyncTrigger() {
  const context = requirePermission_('branches.sync');
  ensureBranchesSyncTrigger_();
  Logger.log('[BRANCH_SYNC_TRIGGER_SETUP] by=%s', context.user.email);
  return buildBranchesData_(context);
}

/**
 * Najde nejnovější Google Spreadsheet nebo Excel soubor ve složce podle data poslední aktualizace.
 * @param {string} folderId
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function findLatestBranchSourceFile_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const pattern = String(getConfigValue_('branchSearchPattern') || '').trim().toLowerCase();

  const files = folder.getFiles();
  let latest = null;
  
  const allowedMimeTypes = [
    MimeType.GOOGLE_SHEETS,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];

  while (files.hasNext()) {
    const file = files.next();
    if (allowedMimeTypes.indexOf(file.getMimeType()) === -1) continue;

    // Filtrování podle vyhledávacího výrazu (pokud je nastaven)
    if (pattern) {
      const fileName = file.getName().toLowerCase();
      if (fileName.indexOf(pattern) === -1) continue;
    }

    if (!latest || file.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) {
      latest = file;
    }
  }

  return latest;
}

/**
 * Převede XLSX/XLS soubor na dočasný Google Sheet pomocí Drive API v3.
 * @param {GoogleAppsScript.Drive.File} xlsxFile
 * @param {string} parentFolderId
 * @returns {string} ID vytvořeného Google Sheetu
 */
function convertXlsxToTempGoogleSheet_(xlsxFile, parentFolderId) {
  const blob = xlsxFile.getBlob();
  const fileMetadata = {
    name: xlsxFile.getName() + '_TEMP_SYNC_' + Utilities.getUuid(),
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: parentFolderId ? [parentFolderId] : []
  };

  const boundary = 'xxxxxxxxxx';
  const delimiter = '\r\n--' + boundary + '\r\n';
  const closeDelim = '\r\n--' + boundary + '--';

  const metadataPart = 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(fileMetadata);
  const mediaPart = 'Content-Type: ' + blob.getContentType() + '\r\n' +
                    'Content-Transfer-Encoding: base64\r\n\r\n' +
                    Utilities.base64Encode(blob.getBytes());

  const payload = delimiter + metadataPart + delimiter + mediaPart + closeDelim;

  const options = {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: payload,
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error('Nepodařilo se převést Excel na Google Sheet (Drive API). Kód: ' + responseCode + ', Odpověď: ' + responseText);
  }

  const result = JSON.parse(responseText);
  return result.id;
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
    lc: pickBranchValue_(raw, ['lc', 'logistickecentrum', 'logistickecentrumlc', 'zkratka', 'abbr', 'abbreviation']),
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
 * Přepíše list FILIALKY a zaznamená historii změn do FILIALKY_SYNC_RUNS a FILIALKY_SYNC_CHANGES.
 * @param {Spreadsheet} spreadsheet
 * @param {Object[]} newBranches
 * @param {GoogleAppsScript.Drive.File} sourceFile
 * @param {string} actor
 */
function writeBranchesWithAudit_(spreadsheet, newBranches, sourceFile, actor) {
  const branchSheet = spreadsheet.getSheetByName('FILIALKY');
  const runSheet = spreadsheet.getSheetByName('FILIALKY_SYNC_RUNS');
  const changeSheet = spreadsheet.getSheetByName('FILIALKY_SYNC_CHANGES');
  
  const headers = branchSheet.getRange(1, 1, 1, branchSheet.getLastColumn()).getValues()[0].map(String);
  
  // 1. Načíst stávající data
  const existingBranches = branchSheet.getLastRow() > 1 
    ? getObjects_(branchSheet) 
    : [];
    
  const oldMap = {};
  existingBranches.forEach(function(b) {
    const num = String(b.storeNumber || '').trim();
    if (num) oldMap[num] = b;
  });
  
  // Zachovat ruční deaktivace a přenést je do nových prodejen
  newBranches.forEach(function(nb) {
    const num = String(nb.storeNumber || '').trim();
    if (num && oldMap[num] && oldMap[num].active === false) {
      nb.active = false;
    }
  });
  
  const newMap = {};
  newBranches.forEach(function(nb) {
    const num = String(nb.storeNumber || '').trim();
    if (num) newMap[num] = nb;
  });
  
  // 2. Porovnání změn
  const runId = Utilities.getUuid();
  const timestamp = new Date();
  const changeRows = [];
  
  let addedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let noChangeCount = 0;
  
  // Pole k porovnání
  const fieldsToCompare = [
    { key: 'storeName', label: 'Název prodejny' },
    { key: 'lc', label: 'Logistické centrum (LC)' },
    { key: 'storePhone', label: 'Telefon prodejny' },
    { key: 'vt', label: 'Oblastní manažer (VT)' },
    { key: 'rm', label: 'Regionální manažer (RM)' },
    { key: 'rmPhone', label: 'Telefon RM' }
  ];
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayLabels = {
    monday: 'Po', tuesday: 'Út', wednesday: 'St', thursday: 'Čt',
    friday: 'Pá', saturday: 'So', sunday: 'Ne'
  };
  days.forEach(function(day) {
    fieldsToCompare.push({ key: day + 'Open', label: dayLabels[day] + ' - Otevření' });
    fieldsToCompare.push({ key: day + 'Close', label: dayLabels[day] + ' - Zavření' });
  });
  
  // Hledání ADDED a MODIFIED
  newBranches.forEach(function(nb) {
    const num = String(nb.storeNumber || '').trim();
    const oldBranch = oldMap[num];
    
    if (!oldBranch) {
      // Přidaná filiálka
      addedCount++;
      changeRows.push([
        Utilities.getUuid(),
        runId,
        nb.storeNumber,
        nb.storeName,
        'ADDED',
        '', // fieldName
        '', // oldValue
        '', // newValue
        timestamp
      ]);
    } else {
      // Existující - zkontrolujeme změny
      let isModified = false;
      fieldsToCompare.forEach(function(field) {
        const oldVal = String(oldBranch[field.key] || '').trim();
        const newVal = String(nb[field.key] !== undefined ? nb[field.key] : '').trim();
        if (oldVal !== newVal) {
          isModified = true;
          changeRows.push([
            Utilities.getUuid(),
            runId,
            nb.storeNumber,
            nb.storeName,
            'MODIFIED',
            field.label,
            oldVal,
            newVal,
            timestamp
          ]);
        }
      });
      
      if (isModified) {
        updatedCount++;
      } else {
        noChangeCount++;
      }
    }
  });
  
  // Hledání DELETED
  existingBranches.forEach(function(ob) {
    const num = String(ob.storeNumber || '').trim();
    if (num && !newMap[num]) {
      deletedCount++;
      changeRows.push([
        Utilities.getUuid(),
        runId,
        ob.storeNumber,
        ob.storeName,
        'DELETED',
        '',
        '',
        '',
        timestamp
      ]);
    }
  });
  
  // 3. Zápis do databáze
  // Zápis synchronizačního běhu
  if (runSheet) {
    const runRow = [
      runId,
      timestamp,
      actor || 'system',
      sourceFile.getName(),
      sourceFile.getId(),
      addedCount,
      updatedCount,
      deletedCount,
      noChangeCount
    ];
    runSheet.appendRow(runRow);
  }
  
  // Batch zápis změn
  if (changeSheet && changeRows.length > 0) {
    const lastRow = changeSheet.getLastRow();
    changeSheet.getRange(lastRow + 1, 1, changeRows.length, 9).setValues(changeRows);
  }
  
  // Přepsání listu FILIALKY novými daty
  if (branchSheet.getLastRow() > 1) {
    branchSheet.getRange(2, 1, branchSheet.getLastRow() - 1, branchSheet.getLastColumn()).clearContent();
  }
  
  if (newBranches.length > 0) {
    const rows = newBranches.map(function(branch) {
      return headers.map(function(header) {
        return branch[header] !== undefined ? branch[header] : '';
      });
    });
    branchSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

/**
 * Vrátí detailní historii změn pro konkrétní běh synchronizace.
 * @param {string} runId
 * @returns {Object[]}
 */
function getSyncRunDetails(runId) {
  const context = requirePermission_('branches.sync');
  const db = ensureDatabase_();
  const sheet = db.spreadsheet.getSheetByName('FILIALKY_SYNC_CHANGES');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const changes = getObjects_(sheet).filter(function(row) {
    return String(row.runId).trim() === runId;
  });

  return changes.map(function(change) {
    return {
      id: change.id,
      storeNumber: change.storeNumber,
      storeName: change.storeName,
      changeType: change.changeType,
      fieldName: change.fieldName,
      oldValue: change.oldValue,
      newValue: change.newValue,
      timestamp: formatDateValue_(change.timestamp)
    };
  });
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
  let national = digits.startsWith('420') ? digits.slice(3) : digits;
  if (national.startsWith('0')) national = national.slice(1);
  if (national.length !== 9 || national.startsWith('0')) return text;
  digits = '420' + national;
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
