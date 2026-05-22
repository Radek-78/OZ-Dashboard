/**
 * OZ Dashboard — Vyhodnocení odpisů akčních artiklů
 *
 * Zpracovává tři zdrojové soubory (Google Sheets) z Drive složky:
 *   Telex      — přehled artiklů; akční identifikovány příznakem W nebo WW
 *   Soubor 2   — odpisy po filiálkách (A1 obsahuje "celkov")
 *   Soubor 3   — odpisy po artiklech  (A1 obsahuje "artikl")
 *
 * Výstupem je seznam LC s přehledem filiálek, celkovými odpisy a akčním podílem
 * za poslední 2 dokončené ISO kalendářní týdny.
 */

const ODPISY_SOURCE_FOLDER_ID_PROP = 'ODPISY_SOURCE_FOLDER_ID';
const ODPISY_CACHE_BUSTER_PROP = 'ODPISY_CACHE_BUSTER';
const ODPISY_CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Veřejné endpointy
// ---------------------------------------------------------------------------

/**
 * Vrátí kompletní data pro subapp Vyhodnocení odpisů.
 * Přístup: dashboard.view (každý přihlášený uživatel s přístupem).
 * @returns {Object}
 */
function getOdpisyData() {
  const context = requirePermission_('dashboard.view');
  return buildOdpisyData_(context);
}

/**
 * Vrátí diagnostiku výpočtu akčních odpisů z poartiklového souboru.
 * Přístup: branches.sync (správce zdrojové složky).
 * @returns {Object}
 */
function getOdpisyDebugData() {
  const context = requirePermission_('branches.sync');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(ODPISY_SOURCE_FOLDER_ID_PROP) || '';
  if (!folderId) {
    return { configured: false, folderId: '', files: [], articles: null, error: 'Zdrojová složka odpisů není nastavena.' };
  }

  try {
    const filesDebug = listOdpisySourceFilesDebug_(folderId);
    const files = findOdpisyFiles_(folderId);
    if (!files.telex) {
      return {
        configured: true,
        folderId: folderId,
        files: filesDebug,
        articles: null,
        error: 'Ve složce nebyl rozpoznán Telex soubor, bez něj nelze sestavit seznam akčních PLU.',
      };
    }
    if (!files.articles) {
      return {
        configured: true,
        folderId: folderId,
        files: filesDebug,
        articles: null,
        error: 'Ve složce nebyl rozpoznán soubor odpisů po artiklech.',
      };
    }

    const weeks = getOdpisyKtInfo_();
    const telexData = readOdpisySheetValues_(files.telex.spreadsheet.getSheets()[0]);
    const akcniPluSet = readOdpisyAkcniPluFromValues_(telexData, files.telex.name);
    const articlesSheet = files.articles.spreadsheet.getSheets()[0];
    const articlesData = readOdpisySheetValues_(articlesSheet);
    const articlesPreview = readOdpisySheetDisplayPreview_(articlesSheet, 20, 30);
    const debug = buildOdpisyArticlesDebug_(articlesData, articlesPreview, files.articles.name, weeks, akcniPluSet);
    return {
      configured: true,
      folderId: folderId,
      files: filesDebug,
      articles: debug,
      error: null,
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    Logger.log('[ODPISY_DEBUG_ERROR] %s', e && e.message ? e.message : e);
    return {
      configured: true,
      folderId: folderId,
      files: [],
      articles: null,
      error: e && e.message ? e.message : String(e),
    };
  }
}

/**
 * Uloží ID složky se zdrojovými soubory odpisů.
 * @param {{ folderId: string }} payload
 * @returns {Object}
 */
function saveOdpisySourceFolder(payload) {
  const context = requirePermission_('branches.sync');
  const folderId = extractDriveId_(payload && payload.folderId);
  if (!folderId) throw new Error('Vyplňte ID zdrojové složky.');

  const folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty(ODPISY_SOURCE_FOLDER_ID_PROP, folder.getId());
  bumpOdpisyCacheBuster_();
  Logger.log('[ODPISY_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
  return buildOdpisyData_(context);
}

// ---------------------------------------------------------------------------
// Sestavení dat pro UI
// ---------------------------------------------------------------------------

/**
 * Sestaví a vrátí datový objekt pro UI.
 * @param {Object} context
 * @returns {Object}
 */
function buildOdpisyData_(context) {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(ODPISY_SOURCE_FOLDER_ID_PROP) || '';
  const canConfigure = hasPermission_(context.auth, 'branches.sync');
  const startedAt = Date.now();

  if (!folderId) {
    return {
      configured: false, canConfigure: canConfigure, folderId: '',
      weeks: [], lcs: [], akcniCount: 0, globalAkcni: {}, globalCelkem: {}, error: null,
    };
  }

  try {
    const weeks = getOdpisyKtInfo_();

    // Identifikace souborů
    const files = findOdpisyFiles_(folderId);
    const missing = [];
    if (!files.telex)    missing.push('Telex (seznam artiklů)');
    if (!files.stores)   missing.push('odpisy po filiálkách');
    if (!files.articles) missing.push('odpisy po artiklech');

    if (missing.length > 0) {
      return {
        configured: true, canConfigure: canConfigure, folderId: folderId,
        weeks: weeks, lcs: [], akcniCount: 0, globalAkcni: {}, globalCelkem: {},
        error: 'Ve složce chybí soubory: ' + missing.join(', ') + '. Ujistěte se, že jsou uloženy jako Google Sheets.',
      };
    }

    const cacheKey = buildOdpisyCacheKey_(folderId, weeks, files);
    const cached = getOdpisyCachedResult_(cacheKey);
    if (cached) {
      cached.canConfigure = canConfigure;
      cached.folderId = folderId;
      cached.cache = { hit: true, key: cacheKey };
      Logger.log('[ODPISY_CACHE_HIT] key=%s elapsedMs=%s', cacheKey, Date.now() - startedAt);
      return cached;
    }

    // Čtení dat ze zdrojových souborů
    const readStartedAt = Date.now();
    const telexValues = readOdpisySheetValues_(files.telex.spreadsheet.getSheets()[0]);
    const akcniPluSet = readOdpisyAkcniPluFromValues_(telexValues, files.telex.name);
    const storesValues = readOdpisySheetValues_(files.stores.spreadsheet.getSheets()[0]);
    const storesData  = readOdpisyStoresFromValues_(storesValues, weeks);
    const storeValues  = storesData.byStore;
    const globalCelkem = storesData.globalCelkem;
    const articlesRows = akcniPluSet.size > 0 ? files.articles.spreadsheet.getSheets()[0].getLastRow() : 0;
    const akcniData = akcniPluSet.size > 0
      ? readOdpisyAkcniMetricsOptimized_(files.articles.spreadsheet.getSheets()[0], weeks, akcniPluSet, files.articles.name)
      : { byStore: {}, global: buildOdpisyEmptyWeekMap_(weeks) };
    const akcniByStore = akcniData.byStore || {};
    const globalAkcni = akcniData.global || buildOdpisyEmptyWeekMap_(weeks);
    Logger.log('[ODPISY_READ] telexRows=%s storesRows=%s articlesRows=%s elapsedMs=%s',
      telexValues.length, storesValues.length, articlesRows, Date.now() - readStartedAt);

    // Mapování filiálek → LC
    const spreadsheet = context.database.spreadsheet;
    const branches = getObjects_(spreadsheet.getSheetByName('FILIALKY')).map(mapBranchRow_);
    const lcsRaw   = listLocations_(spreadsheet).filter(function(loc) { return loc.type === 'LC'; });

    const storeToLcAbbr = {};
    const storeToName   = {};
    const storeToRm     = {};
    branches.forEach(function(b) {
      if (!b.active || !b.storeNumber) return;
      const key = String(b.storeNumber);
      storeToLcAbbr[key] = b.lc || '';
      storeToName[key]   = b.storeName || '';
      storeToRm[key]     = b.rm || '';
    });

    // Seskupení obchodů do LC skupin
    const lcGroups = {}; // { 'BRN': { stores: [...] } }
    Object.keys(storeValues).forEach(function(storeNum) {
      const abbrRaw = storeToLcAbbr[storeNum] || '';
      const abbr    = abbrRaw.toUpperCase();
      if (!abbr) return;
      if (!lcGroups[abbr]) lcGroups[abbr] = { stores: [] };
      lcGroups[abbr].stores.push({
        storeNumber: parseInt(storeNum, 10) || 0,
        storeName:   storeToName[storeNum] || '',
        rm:          storeToRm[storeNum] || '',
        values:      storeValues[storeNum],
        akcniValues:  akcniByStore[storeNum] || buildOdpisyEmptyWeekMap_(weeks),
      });
    });

    // Sestavení LC výsledků (seřazeno numericky dle kódu LC)
    const lcsResult = lcsRaw
      .filter(function(lc) {
        return lc.active && lc.abbreviation && lcGroups[lc.abbreviation.toUpperCase()];
      })
      .sort(function(a, b) {
        return (parseInt(a.code, 10) || 999) - (parseInt(b.code, 10) || 999);
      })
      .map(function(lc) {
        const abbr  = lc.abbreviation.toUpperCase();
        const group = lcGroups[abbr] || { stores: [] };
        const storesSorted = group.stores.slice().sort(function(a, b) {
          return a.storeNumber - b.storeNumber;
        });

        // Sumové totaly za LC per KT
        const totals = {};
        const akcniTotals = {};
        weeks.forEach(function(w) { totals[w.label] = 0; });
        weeks.forEach(function(w) { akcniTotals[w.label] = 0; });
        storesSorted.forEach(function(s) {
          weeks.forEach(function(w) {
            totals[w.label] += (s.values[w.label] || 0);
            akcniTotals[w.label] += (s.akcniValues[w.label] || 0);
          });
        });

        // Procentuální podíl akčních artiklů v rámci aktuálního LC.
        const pct = {};
        weeks.forEach(function(w) {
          const celkem = totals[w.label] || 0;
          const akcni  = akcniTotals[w.label]  || 0;
          pct[w.label] = (celkem !== 0) ? Math.abs(akcni) / Math.abs(celkem) * 100 : 0;
        });

        return {
          code:         lc.code,
          abbreviation: lc.abbreviation,
          city:         lc.city || '',
          stores: storesSorted.map(function(s) {
            const row = {
              storeNumber: s.storeNumber,
              storeName:   s.storeName,
              rm:          s.rm || '',
            };
            weeks.forEach(function(w) { row[w.label] = s.values[w.label] || 0; });
            row.akcni = {};
            weeks.forEach(function(w) { row.akcni[w.label] = s.akcniValues[w.label] || 0; });
            return row;
          }),
          totals: totals,
          akcniTotals: akcniTotals,
          pct:    pct,
        };
      });

    Logger.log('[ODPISY_BUILD] lcs=%s akcniPlu=%s elapsedMs=%s', lcsResult.length, akcniPluSet.size, Date.now() - startedAt);
    const result = {
      configured:   true,
      canConfigure: canConfigure,
      folderId:     folderId,
      weeks:        weeks,
      lcs:          lcsResult,
      akcniCount:   akcniPluSet.size,
      globalAkcni:  globalAkcni,
      globalCelkem: globalCelkem,
      error:        null,
    };
    putOdpisyCachedResult_(cacheKey, result);
    return result;
  } catch (e) {
    Logger.log('[ODPISY_ERROR] %s', e && e.message ? e.message : e);
    return {
      configured: true, canConfigure: canConfigure, folderId: folderId,
      weeks: [], lcs: [], akcniCount: 0, globalAkcni: {}, globalCelkem: {},
      error: 'Chyba při zpracování dat: ' + (e && e.message ? e.message : String(e)),
    };
  }
}

// ---------------------------------------------------------------------------
// Identifikace souborů ve složce
// ---------------------------------------------------------------------------

/**
 * Projde složku a identifikuje tři zdrojové soubory dle obsahu buňky A1.
 * Telex  — A1 neobsahuje "celkov" ani "artikl"
 * Soubor 2 — A1 obsahuje "celkov"
 * Soubor 3 — A1 obsahuje "artikl"
 *
 * @param {string} folderId
 * @returns {{ telex: Spreadsheet|null, stores: Spreadsheet|null, articles: Spreadsheet|null }}
 */
function findOdpisyFiles_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files  = folder.getFiles();
  const result = { telex: null, stores: null, articles: null };

  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;

    try {
      const ss = SpreadsheetApp.openById(file.getId());
      const sheet = ss.getSheets()[0];
      const kind = classifyOdpisySourceFile_(sheet, file.getName());
      const item = {
        spreadsheet: ss,
        id: file.getId(),
        name: file.getName(),
        updatedAt: file.getLastUpdated().getTime(),
      };

      if (kind === 'stores') {
        result.stores = item;
      } else if (kind === 'articles') {
        result.articles = item;
      } else {
        result.telex = item;
      }
      Logger.log('[ODPISY_FILE_ID] name=%s kind=%s mime=%s', file.getName(), kind, file.getMimeType());
    } catch (e) {
      Logger.log('[ODPISY_FILE_SKIP] file=%s error=%s', file.getName(), e && e.message ? e.message : e);
    }
  }

  return result;
}

/**
 * Vrátí diagnostický seznam všech souborů ve zdrojové složce.
 * @param {string} folderId
 * @returns {Object[]}
 */
function listOdpisySourceFilesDebug_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const result = [];

  while (files.hasNext()) {
    const file = files.next();
    const info = {
      name: file.getName(),
      id: file.getId(),
      mimeType: file.getMimeType(),
      updatedAt: file.getLastUpdated().toISOString(),
      kind: '',
      sheetName: '',
      rows: 0,
      columns: 0,
      a1: '',
      error: '',
    };

    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      info.kind = 'ignored';
      info.error = 'Soubor není Google Sheets, parser ho ignoruje.';
      result.push(info);
      continue;
    }

    try {
      const ss = SpreadsheetApp.openById(file.getId());
      const sheet = ss.getSheets()[0];
      info.sheetName = sheet.getName();
      info.rows = sheet.getLastRow();
      info.columns = sheet.getLastColumn();
      info.a1 = String(sheet.getRange(1, 1).getDisplayValue() || '');
      info.kind = classifyOdpisySourceFile_(sheet, file.getName());
    } catch (e) {
      info.kind = 'error';
      info.error = e && e.message ? e.message : String(e);
    }
    result.push(info);
  }

  return result;
}

/**
 * Odhadne typ zdrojového souboru z názvu a náhledu prvních řádků.
 * @param {Sheet} sheet
 * @param {string} fileName
 * @returns {'telex'|'stores'|'articles'}
 */
function classifyOdpisySourceFile_(sheet, fileName) {
  const name = normalizeOdpisyHeader_(fileName);
  if (name.indexOf('telex') >= 0) return 'telex';
  if (name.indexOf('celkov') >= 0 || name.indexOf('pofilial') >= 0 || name.indexOf('poprodejn') >= 0) return 'stores';
  if (name.indexOf('poartikl') >= 0 || name.indexOf('artiklov') >= 0) return 'articles';

  const lastRow = Math.min(sheet.getLastRow(), 30);
  const lastCol = Math.min(sheet.getLastColumn(), 120);
  const preview = (lastRow > 0 && lastCol > 0)
    ? sheet.getRange(1, 1, lastRow, lastCol).getValues()
    : [];
  const a1 = preview.length && preview[0].length ? normalizeOdpisyHeader_(preview[0][0]) : '';
  const flattened = preview.map(function(row) {
    return row.map(normalizeOdpisyHeader_).join('|');
  }).join('|');

  // Původní exporty mají typ souboru často přímo v A1.
  if (a1.indexOf('celkov') >= 0) return 'stores';
  if (a1.indexOf('artikl') >= 0) return 'articles';

  if (flattened.indexOf('akcnicena') >= 0 || flattened.indexOf('akcicena') >= 0) return 'telex';
  if (flattened.indexOf('artikl') >= 0 && (
      flattened.indexOf('kt') >= 0 ||
      flattened.indexOf('odpis') >= 0 ||
      flattened.indexOf('hodnota') >= 0 ||
      flattened.indexOf('mnozstvi') >= 0
  )) return 'articles';
  if (flattened.indexOf('prodejna') >= 0 || flattened.indexOf('filial') >= 0) return 'stores';
  if (name.indexOf('artikl') >= 0) return 'articles';
  return 'telex';
}

/**
 * Sestaví stabilní cache key podle složky, týdnů a verzí zdrojových souborů.
 * @param {string} folderId
 * @param {Array} weeks
 * @param {Object} files
 * @returns {string}
 */
function buildOdpisyCacheKey_(folderId, weeks, files) {
  const buster = PropertiesService.getScriptProperties().getProperty(ODPISY_CACHE_BUSTER_PROP) || '0';
  const fileSig = ['telex', 'stores', 'articles'].map(function(key) {
    const f = files[key] || {};
    return [key, f.id || '', f.updatedAt || ''].join(':');
  }).join('|');
  const weekSig = weeks.map(function(w) { return w.label; }).join('|');
  return 'ODPISY_DATA_V3_' + Utilities.base64EncodeWebSafe(folderId + '|' + weekSig + '|' + fileSig + '|' + buster).slice(0, 120);
}

/**
 * Vrátí výsledek z krátkodobé cache.
 * @param {string} key
 * @returns {Object|null}
 */
function getOdpisyCachedResult_(key) {
  try {
    const json = CacheService.getScriptCache().get(key);
    return json ? JSON.parse(json) : null;
  } catch (e) {
    Logger.log('[ODPISY_CACHE_GET_FAIL] %s', e && e.message ? e.message : e);
    return null;
  }
}

/**
 * Uloží výsledek do krátkodobé cache, pokud se vejde do limitu CacheService.
 * @param {string} key
 * @param {Object} result
 */
function putOdpisyCachedResult_(key, result) {
  try {
    const json = JSON.stringify(result);
    if (json.length > 95000) {
      Logger.log('[ODPISY_CACHE_SKIP] size=%s', json.length);
      return;
    }
    CacheService.getScriptCache().put(key, json, ODPISY_CACHE_TTL_SECONDS);
    Logger.log('[ODPISY_CACHE_PUT] key=%s size=%s ttl=%s', key, json.length, ODPISY_CACHE_TTL_SECONDS);
  } catch (e) {
    Logger.log('[ODPISY_CACHE_PUT_FAIL] %s', e && e.message ? e.message : e);
  }
}

/** Zneplatní cache po změně zdrojové složky. */
function bumpOdpisyCacheBuster_() {
  PropertiesService.getScriptProperties().setProperty(ODPISY_CACHE_BUSTER_PROP, String(Date.now()));
}

// ---------------------------------------------------------------------------
// Výpočet ISO kalendářních týdnů
// ---------------------------------------------------------------------------

/**
 * Vrátí informace o dvou předchozích dokončených ISO týdnech.
 * @returns {{ year: number, kt: number, label: string }[]}
 */
function getOdpisyKtInfo_() {
  const now        = new Date();
  const currentKt  = odpisyIsoWeek_(now);
  const currentYear = odpisyIsoYear_(now);
  const weeks      = [];

  // Chceme KT-2 (starší) a KT-1 (novější)
  for (var i = 2; i >= 1; i--) {
    var kt   = currentKt - i;
    var year = currentYear;
    if (kt <= 0) {
      year -= 1;
      kt   += odpisyIsoWeeksInYear_(year);
    }
    var label = String(year) + ' KT ' + (kt < 10 ? '0' + kt : String(kt));
    weeks.push({ year: year, kt: kt, label: label });
  }

  return weeks;
}

/** ISO číslo týdne pro datum d. */
function odpisyIsoWeek_(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** ISO rok (může se lišit od kalendářního roku v krajních dnech). */
function odpisyIsoYear_(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return date.getUTCFullYear();
}

/** Počet ISO týdnů v daném roce. */
function odpisyIsoWeeksInYear_(year) {
  return odpisyIsoWeek_(new Date(year, 11, 28)); // 28. 12. je vždy v posledním týdnu
}

// ---------------------------------------------------------------------------
// Čtení dat ze zdrojových souborů
// ---------------------------------------------------------------------------

/**
 * Načte hodnoty listu jedním serverovým voláním.
 * @param {Sheet} sheet
 * @returns {Array[]}
 */
function readOdpisySheetValues_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

/**
 * Načte zobrazované hodnoty horní části listu pro diagnostiku.
 * @param {Sheet} sheet
 * @param {number} maxRows
 * @param {number} maxCols
 * @returns {string[][]}
 */
function readOdpisySheetDisplayPreview_(sheet, maxRows, maxCols) {
  const rows = Math.min(sheet.getLastRow(), maxRows);
  const cols = Math.min(sheet.getLastColumn(), maxCols);
  if (rows < 1 || cols < 1) return [];
  return sheet.getRange(1, 1, rows, cols).getDisplayValues();
}

/**
 * Vrátí mapu týdnů s nulovými hodnotami.
 * @param {{ label: string }[]} weeks
 * @returns {Object}
 */
function buildOdpisyEmptyWeekMap_(weeks) {
  const result = {};
  weeks.forEach(function(w) { result[w.label] = 0; });
  return result;
}

/**
 * Sestaví diagnostiku Telex parseru.
 * @param {Array[]} data
 * @param {string[][]} displayRows
 * @param {string} sourceName
 * @returns {Object}
 */
function buildOdpisyTelexDebug_(data, displayRows, sourceName) {
  const headerKeywords = ['akcnicena', 'akce', 'akcni', 'plu', 'artikl', 'article', 'matnr', 'w', 'ww'];
  const headerRow = findOdpisyHeaderRowByKeywords_(data, headerKeywords);
  const result = {
    sourceName: sourceName || '',
    rows: data.length,
    columns: data[0] ? data[0].length : 0,
    searchedHeaderKeywords: headerKeywords,
    headerRow: headerRow >= 0 ? headerRow + 1 : null,
    normalizedHeaders: [],
    rawHeaders: [],
    actionColumn: null,
    pluColumn: null,
    columnScores: [],
    actionSamples: [],
    previewRows: displayRows,
    akcniPluCount: 0,
    akcniPluSamples: [],
  };

  if (headerRow < 0) return result;

  const rawHeaders = data[headerRow].map(function(value) { return String(value === null || value === undefined ? '' : value); });
  const headers = data[headerRow].map(normalizeOdpisyHeader_);
  const preferredActionCol = findOdpisyColByKeywords_(headers, ['akcnicena', 'akcicena', 'akce', 'akcni', 'promo']);
  const actionCol = findOdpisyActionFlagCol_(data, headerRow, headers);
  const pluCol = findOdpisyPluCol_(headers);

  result.rawHeaders = rawHeaders.map(function(value, index) {
    return { col: index + 1, value: value };
  });
  result.normalizedHeaders = headers.map(function(value, index) {
    return { col: index + 1, value: value };
  });
  result.actionColumn = actionCol >= 0 ? {
    col: actionCol + 1,
    rawHeader: rawHeaders[actionCol],
    normalizedHeader: headers[actionCol],
    preferredByHeader: actionCol === preferredActionCol,
  } : null;
  result.pluColumn = pluCol >= 0 ? {
    col: pluCol + 1,
    rawHeader: rawHeaders[pluCol],
    normalizedHeader: headers[pluCol],
  } : null;

  result.columnScores = scoreOdpisyActionColumns_(data, headerRow, rawHeaders, headers)
    .filter(function(item) {
      return item.actionFlagCount > 0 || item.nonEmptyCount > 0 || item.col === preferredActionCol + 1 || item.col === actionCol + 1 || item.col === pluCol + 1;
    })
    .sort(function(a, b) {
      if (b.actionFlagCount !== a.actionFlagCount) return b.actionFlagCount - a.actionFlagCount;
      return a.col - b.col;
    })
    .slice(0, 40);

  if (actionCol >= 0) {
    result.actionSamples = sampleOdpisyColumnValues_(data, headerRow, actionCol, 25);
  }

  const akcniPlu = readOdpisyAkcniPluFromValues_(data, sourceName);
  result.akcniPluCount = akcniPlu.size;
  result.akcniPluSamples = Array.from(akcniPlu).slice(0, 30);
  return result;
}

/**
 * Sestaví diagnostiku výpočtu akčních odpisů z poartiklového souboru.
 * @param {Array[]} data
 * @param {string[][]} displayRows
 * @param {string} sourceName
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @returns {Object}
 */
function buildOdpisyArticlesDebug_(data, displayRows, sourceName, weeks, akcniPluSet) {
  const result = {
    sourceName: sourceName || '',
    rows: data.length,
    columns: data[0] ? data[0].length : 0,
    searchedHeaderKeywords: ['artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'],
    headerRow: null,
    pluColumn: null,
    storeColumn: null,
    ktColumns: [],
    actionPluCount: akcniPluSet ? akcniPluSet.size : 0,
    matchedRows: 0,
    matchedRowsWithStore: 0,
    nonZeroMatchedRows: 0,
    storesWithActionWaste: 0,
    globalTotals: buildOdpisyEmptyWeekMap_(weeks),
    matchedSamples: [],
    actionPluNotFoundSamples: [],
    columnScores: [],
    previewRows: displayRows || [],
  };

  const headerRow = findOdpisyHeaderRowByKeywords_(data, result.searchedHeaderKeywords);
  result.headerRow = headerRow >= 0 ? headerRow + 1 : null;
  if (headerRow < 0) return result;

  const rawHeaders = data[headerRow] || [];
  const headers = rawHeaders.map(normalizeOdpisyHeader_);
  const pluCol = findOdpisyPluCol_(headers);
  const storeCol = findOdpisyStoreCol_(headers);
  result.pluColumn = pluCol >= 0 ? {
    col: pluCol + 1,
    rawHeader: rawHeaders[pluCol],
    normalizedHeader: headers[pluCol],
  } : null;
  result.storeColumn = storeCol >= 0 ? {
    col: storeCol + 1,
    rawHeader: rawHeaders[storeCol],
    normalizedHeader: headers[storeCol],
  } : null;

  const ktCols = buildOdpisyKtColMap_(rawHeaders, weeks);
  result.ktColumns = weeks.map(function(w) {
    const col = ktCols[w.label];
    return {
      label: w.label,
      col: col === undefined ? null : col + 1,
      rawHeader: col === undefined ? '' : rawHeaders[col],
      normalizedHeader: col === undefined ? '' : headers[col],
      found: col !== undefined,
    };
  });

  result.columnScores = buildOdpisyArticlesColumnScores_(data, headerRow, rawHeaders, headers, akcniPluSet);
  if (pluCol < 0 || storeCol < 0) return result;

  const foundActionPlu = {};
  const byStore = {};
  for (var row = headerRow + 1; row < data.length; row++) {
    var plu = normalizeOdpisyPlu_(data[row][pluCol]);
    if (!plu || !akcniPluSet || !akcniPluSet.has(plu)) continue;
    foundActionPlu[plu] = true;
    result.matchedRows++;

    var storeNum = normalizeOdpisyStoreNum_(data[row][storeCol]);
    if (storeNum) {
      result.matchedRowsWithStore++;
      if (!byStore[storeNum]) byStore[storeNum] = true;
    }

    var rowAmounts = {};
    var hasNonZero = false;
    weeks.forEach(function(w) {
      var col = ktCols[w.label];
      var value = col === undefined ? 0 : parseOdpisyValue_(data[row][col]);
      rowAmounts[w.label] = value;
      result.globalTotals[w.label] += value;
      if (value !== 0) hasNonZero = true;
    });
    if (hasNonZero) result.nonZeroMatchedRows++;

    if (result.matchedSamples.length < 25) {
      result.matchedSamples.push({
        row: row + 1,
        plu: plu,
        store: storeNum || '',
        amounts: rowAmounts,
      });
    }
  }

  result.storesWithActionWaste = Object.keys(byStore).length;
  if (akcniPluSet) {
    Array.from(akcniPluSet).some(function(plu) {
      if (!foundActionPlu[plu]) result.actionPluNotFoundSamples.push(plu);
      return result.actionPluNotFoundSamples.length >= 25;
    });
  }
  return result;
}

/**
 * Vrátí diagnostiku kandidátních sloupců v poartiklovém souboru.
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {Array} rawHeaders
 * @param {string[]} headers
 * @param {Set<string>} akcniPluSet
 * @returns {Object[]}
 */
function buildOdpisyArticlesColumnScores_(data, headerRow, rawHeaders, headers, akcniPluSet) {
  const maxRows = Math.min(data.length, headerRow + 501);
  const scores = [];
  for (var col = 0; col < headers.length; col++) {
    var nonEmpty = 0;
    var numeric = 0;
    var actionPluHits = 0;
    var storeLike = 0;
    var samples = [];
    for (var row = headerRow + 1; row < maxRows; row++) {
      var value = data[row][col];
      if (value === '' || value === null || value === undefined) continue;
      nonEmpty++;
      if (samples.length < 8) samples.push(String(value));
      var normalizedNumber = normalizeOdpisyPlu_(value);
      if (normalizedNumber) {
        numeric++;
        if (akcniPluSet && akcniPluSet.has(normalizedNumber)) actionPluHits++;
        var storeNum = normalizeOdpisyStoreNum_(value);
        if (storeNum && String(storeNum).length <= 4) storeLike++;
      }
    }
    scores.push({
      col: col + 1,
      rawHeader: rawHeaders[col] || '',
      normalizedHeader: headers[col] || '',
      nonEmptyCount: nonEmpty,
      numericCount: numeric,
      actionPluHits: actionPluHits,
      storeLikeCount: storeLike,
      samples: samples,
    });
  }
  return scores
    .filter(function(item) {
      return item.nonEmptyCount > 0 || item.rawHeader || item.normalizedHeader;
    })
    .sort(function(a, b) {
      if (b.actionPluHits !== a.actionPluHits) return b.actionPluHits - a.actionPluHits;
      if (b.storeLikeCount !== a.storeLikeCount) return b.storeLikeCount - a.storeLikeCount;
      return a.col - b.col;
    });
}

/**
 * Ohodnotí sloupce podle výskytu hodnot W/WW.
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {string[]} rawHeaders
 * @param {string[]} headers
 * @returns {Object[]}
 */
function scoreOdpisyActionColumns_(data, headerRow, rawHeaders, headers) {
  const result = [];
  const colCount = headers.length;
  for (var col = 0; col < colCount; col++) {
    var actionFlagCount = 0;
    var nonEmptyCount = 0;
    var samples = [];
    for (var row = headerRow + 1; row < data.length; row++) {
      var value = data[row][col];
      var text = String(value === null || value === undefined ? '' : value).trim();
      if (text) {
        nonEmptyCount++;
        if (samples.length < 8) samples.push(text);
      }
      if (isOdpisyActionFlag_(value)) actionFlagCount++;
    }
    result.push({
      col: col + 1,
      rawHeader: rawHeaders[col] || '',
      normalizedHeader: headers[col] || '',
      actionFlagCount: actionFlagCount,
      nonEmptyCount: nonEmptyCount,
      samples: samples,
    });
  }
  return result;
}

/**
 * Vrátí ukázky hodnot z jednoho sloupce.
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {number} col
 * @param {number} limit
 * @returns {Object[]}
 */
function sampleOdpisyColumnValues_(data, headerRow, col, limit) {
  const result = [];
  for (var row = headerRow + 1; row < data.length && result.length < limit; row++) {
    var value = data[row][col];
    var text = String(value === null || value === undefined ? '' : value).trim();
    if (!text) continue;
    result.push({
      row: row + 1,
      value: text,
      isActionFlag: isOdpisyActionFlag_(value),
    });
  }
  return result;
}

/**
 * Přečte akční PLU čísla z Telex souboru.
 * Hledá sloupec s příznakem "Akční cena (W)" a sloupec s číslem artiklu.
 * @param {Sheet} sheet
 * @returns {Set<string>}
 */
function readOdpisyAkcniPlu_(sheet) {
  return readOdpisyAkcniPluFromValues_(readOdpisySheetValues_(sheet), sheet.getParent().getName());
}

/**
 * Přečte akční PLU čísla z hodnot Telex souboru.
 * @param {Array[]} data
 * @param {string=} sourceName
 * @returns {Set<string>}
 */
function readOdpisyAkcniPluFromValues_(data, sourceName) {
  if (data.length < 2) return new Set();

  const headerRow = findOdpisyHeaderRowByKeywords_(data, [
    'akcnicena', 'akce', 'akcni', 'plu', 'artikl', 'article', 'matnr', 'w', 'ww'
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_TELEX] Nenalezen řádek záhlaví Telexu s akčním příznakem nebo artiklem; source=%s', sourceName || '');
    return new Set();
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const akcniCol = findOdpisyActionFlagCol_(data, headerRow, headers);
  const pluCol = findOdpisyPluCol_(headers);

  if (akcniCol < 0 || pluCol < 0) {
    Logger.log('[ODPISY_TELEX] Chybí sloupce: source=%s headerRow=%s akcniCol=%s pluCol=%s headers=%s',
      sourceName || '', headerRow + 1, akcniCol, pluCol, headers.slice(0, 30).join('|'));
    return new Set();
  }

  const akcniPlu = new Set();
  for (var row = headerRow + 1; row < data.length; row++) {
    var flag = String(data[row][akcniCol] || '').trim().toUpperCase();
    if (flag === 'W' || flag === 'WW') {
      var plu = normalizeOdpisyPlu_(data[row][pluCol]);
      if (plu) akcniPlu.add(plu);
    }
  }

  Logger.log('[ODPISY_TELEX] source=%s headerRow=%s akcniCol=%s pluCol=%s akcniPlu.size=%s',
    sourceName || '', headerRow + 1, akcniCol + 1, pluCol + 1, akcniPlu.size);
  return akcniPlu;
}

/**
 * Vrátí mapy z odpisů po filiálkách jedním průchodem.
 * @param {Array[]} data
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {{ byStore: Object, globalCelkem: Object }}
 */
function readOdpisyStoresFromValues_(data, weeks) {
  if (data.length < 2) return { byStore: {}, globalCelkem: {} };

  const headerRow = findOdpisyHeaderRow_(data, 'prodejna');
  if (headerRow < 0) {
    Logger.log('[ODPISY_STORES] Nenalezen řádek záhlaví s "prodejna"');
    return { byStore: {}, globalCelkem: {} };
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const storeCol = findOdpisyColByKeyword_(headers, 'prodejna');
  if (storeCol < 0) return { byStore: {}, globalCelkem: {} };

  const ktCols = buildOdpisyKtColMap_(data[headerRow], weeks);
  const byStore = {};
  const globalCelkem = {};
  weeks.forEach(function(w) { globalCelkem[w.label] = 0; });

  for (var row = headerRow + 1; row < data.length; row++) {
    var storeNum = normalizeOdpisyStoreNum_(data[row][storeCol]);
    if (!storeNum) continue;
    if (!byStore[storeNum]) byStore[storeNum] = {};
    weeks.forEach(function(w) {
      if (ktCols[w.label] !== undefined) {
        var value = parseOdpisyValue_(data[row][ktCols[w.label]]);
        byStore[storeNum][w.label] = (byStore[storeNum][w.label] || 0) + value;
        globalCelkem[w.label] += value;
      }
    });
  }

  return { byStore: byStore, globalCelkem: globalCelkem };
}

/**
 * Vrátí mapu storeNumber → { ktLabel: value } z souboru odpisů po filiálkách.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {Object}
 */
function readOdpisyCelkoveByStore_(sheet, weeks) {
  return readOdpisyStoresFromValues_(readOdpisySheetValues_(sheet), weeks).byStore;
}

/**
 * Vrátí mapu ktLabel → celkový odpis (součet všech filiálek) z souboru po filiálkách.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {Object}
 */
function readOdpisyGlobalCelkem_(sheet, weeks) {
  return readOdpisyStoresFromValues_(readOdpisySheetValues_(sheet), weeks).globalCelkem;
}

/**
 * Vrátí mapu ktLabel → celkový akční odpis (součet akčních artiklů) z souboru po artiklech.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @returns {Object}
 */
function readOdpisyAkcniByKt_(sheet, weeks, akcniPluSet) {
  return readOdpisyAkcniByKtOptimized_(sheet, weeks, akcniPluSet, sheet.getParent().getName());
}

/**
 * Vrátí mapy akčních odpisů z poartiklového souboru.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @param {string=} sourceName
 * @returns {{ byStore: Object, global: Object }}
 */
function readOdpisyAkcniMetricsOptimized_(sheet, weeks, akcniPluSet, sourceName) {
  const empty = { byStore: {}, global: buildOdpisyEmptyWeekMap_(weeks) };
  if (!akcniPluSet || akcniPluSet.size === 0) {
    Logger.log('[ODPISY_ARTICLES] Přeskakuji výpočet akčních odpisů, protože Telex nevrátil žádná akční PLU; source=%s', sourceName || '');
    return empty;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return empty;

  const previewRows = Math.min(lastRow, 15);
  const preview = sheet.getRange(1, 1, previewRows, lastCol).getValues();
  const headerRow = findOdpisyHeaderRowByKeywords_(preview, [
    'artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezen řádek záhlaví se sloupcem artiklu/PLU; source=%s', sourceName || '');
    return empty;
  }

  const header = preview[headerRow];
  const headers = header.map(normalizeOdpisyHeader_);
  const pluCol = findOdpisyPluCol_(headers);
  const storeCol = findOdpisyStoreCol_(headers);
  if (pluCol < 0 || storeCol < 0) {
    Logger.log('[ODPISY_ARTICLES] Chybí sloupce pro výpočet po filiálkách: source=%s headerRow=%s pluCol=%s storeCol=%s headers=%s',
      sourceName || '', headerRow + 1, pluCol, storeCol, headers.slice(0, 30).join('|'));
    return empty;
  }

  const ktCols = buildOdpisyKtColMap_(header, weeks);
  const dataStartRow = headerRow + 2;
  const numRows = Math.max(lastRow - headerRow - 1, 0);
  if (numRows < 1) return empty;

  const pluValues = sheet.getRange(dataStartRow, pluCol + 1, numRows, 1).getValues();
  const storeValues = sheet.getRange(dataStartRow, storeCol + 1, numRows, 1).getValues();
  const weekValues = {};
  weeks.forEach(function(w) {
    if (ktCols[w.label] !== undefined) {
      weekValues[w.label] = sheet.getRange(dataStartRow, ktCols[w.label] + 1, numRows, 1).getValues();
    }
  });

  const byStore = {};
  const global = buildOdpisyEmptyWeekMap_(weeks);
  var matchedRows = 0;
  var matchedRowsWithStore = 0;

  for (var row = 0; row < numRows; row++) {
    var plu = normalizeOdpisyPlu_(pluValues[row][0]);
    if (!plu || !akcniPluSet.has(plu)) continue;
    matchedRows++;

    var storeNum = normalizeOdpisyStoreNum_(storeValues[row][0]);
    if (storeNum && !byStore[storeNum]) byStore[storeNum] = buildOdpisyEmptyWeekMap_(weeks);
    if (storeNum) matchedRowsWithStore++;

    weeks.forEach(function(w) {
      if (!weekValues[w.label]) return;
      var value = parseOdpisyValue_(weekValues[w.label][row][0]);
      global[w.label] += value;
      if (storeNum) byStore[storeNum][w.label] += value;
    });
  }

  Logger.log('[ODPISY_ARTICLES_OPT] source=%s headerRow=%s pluCol=%s storeCol=%s matchedRows=%s matchedStores=%s stores=%s akcniPlu=%s rows=%s',
    sourceName || '', headerRow + 1, pluCol + 1, storeCol + 1, matchedRows, matchedRowsWithStore, Object.keys(byStore).length, akcniPluSet.size, numRows);
  return { byStore: byStore, global: global };
}

/**
 * Vrátí mapu ktLabel → akční odpis s načtením pouze potřebných sloupců.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @param {string=} sourceName
 * @returns {Object}
 */
function readOdpisyAkcniByKtOptimized_(sheet, weeks, akcniPluSet, sourceName) {
  return readOdpisyAkcniMetricsOptimized_(sheet, weeks, akcniPluSet, sourceName).global;
}

/**
 * Vrátí mapu ktLabel → celkový akční odpis z načtených hodnot souboru po artiklech.
 * @param {Array[]} data
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @param {string=} sourceName
 * @returns {Object}
 */
function readOdpisyAkcniByKtFromValues_(data, weeks, akcniPluSet, sourceName) {
  if (data.length < 2) return {};
  if (!akcniPluSet || akcniPluSet.size === 0) {
    const emptyResult = {};
    weeks.forEach(function(w) { emptyResult[w.label] = 0; });
    Logger.log('[ODPISY_ARTICLES] Přeskakuji výpočet akčních odpisů, protože Telex nevrátil žádná akční PLU; source=%s', sourceName || '');
    return emptyResult;
  }

  const headerRow = findOdpisyHeaderRowByKeywords_(data, [
    'artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezen řádek záhlaví se sloupcem artiklu/PLU; source=%s', sourceName || '');
    return {};
  }

  const headers = data[headerRow].map(normalizeOdpisyHeader_);
  const pluCol = findOdpisyPluCol_(headers);
  if (pluCol < 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezen sloupec artiklu/PLU; source=%s headerRow=%s headers=%s',
      sourceName || '', headerRow + 1, headers.slice(0, 30).join('|'));
    return {};
  }

  const ktCols = buildOdpisyKtColMap_(data[headerRow], weeks);
  const result = {};
  weeks.forEach(function(w) { result[w.label] = 0; });
  var matchedRows = 0;

  for (var row = headerRow + 1; row < data.length; row++) {
    var plu = normalizeOdpisyPlu_(data[row][pluCol]);
    if (!plu || !akcniPluSet.has(plu)) continue;
    matchedRows++;
    weeks.forEach(function(w) {
      if (ktCols[w.label] !== undefined) {
        result[w.label] += parseOdpisyValue_(data[row][ktCols[w.label]]);
      }
    });
  }

  Logger.log('[ODPISY_ARTICLES] source=%s headerRow=%s pluCol=%s matchedRows=%s akcniPlu=%s',
    sourceName || '', headerRow + 1, pluCol + 1, matchedRows, akcniPluSet.size);
  return result;
}

// ---------------------------------------------------------------------------
// Pomocné funkce pro zpracování dat
// ---------------------------------------------------------------------------

/**
 * Najde index prvního řádku záhlaví, jehož normalizovaný obsah obsahuje keyword.
 * Prohledává prvních 10 řádků.
 * @param {Array[]} data
 * @param {string} keyword - normalizovaný (bez diakritiky, malý)
 * @returns {number} index řádku nebo -1
 */
function findOdpisyHeaderRow_(data, keyword) {
  for (var row = 0; row < Math.min(data.length, 10); row++) {
    var normalized = data[row].map(normalizeOdpisyHeader_);
    if (normalized.some(function(h) { return h.indexOf(keyword) >= 0; })) return row;
  }
  return -1;
}

/**
 * Najde index prvního řádku záhlaví, jehož normalizovaný obsah obsahuje alespoň jedno z klíčových slov.
 * @param {Array[]} data
 * @param {string[]} keywords
 * @returns {number} index řádku nebo -1
 */
function findOdpisyHeaderRowByKeywords_(data, keywords) {
  for (var row = 0; row < Math.min(data.length, 15); row++) {
    var normalized = data[row].map(normalizeOdpisyHeader_);
    for (var k = 0; k < keywords.length; k++) {
      var keyword = normalizeOdpisyHeader_(keywords[k]);
      if (normalized.some(function(h) {
        return keyword.length <= 2 ? h === keyword : h.indexOf(keyword) >= 0;
      })) return row;
    }
  }
  return -1;
}

/**
 * Najde index sloupce, jehož normalizovaný název obsahuje keyword.
 * @param {string[]} headers - normalizovaná záhlaví
 * @param {string} keyword
 * @returns {number} index nebo -1
 */
function findOdpisyColByKeyword_(headers, keyword) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].indexOf(keyword) >= 0) return i;
  }
  return -1;
}

/**
 * Najde index sloupce podle více možných názvů.
 * @param {string[]} headers - normalizovaná záhlaví
 * @param {string[]} keywords
 * @returns {number} index nebo -1
 */
function findOdpisyColByKeywords_(headers, keywords) {
  for (var k = 0; k < keywords.length; k++) {
    var col = findOdpisyColByKeyword_(headers, normalizeOdpisyHeader_(keywords[k]));
    if (col >= 0) return col;
  }
  return -1;
}

/**
 * Najde sloupec s číselným identifikátorem artiklu/PLU.
 * Sloupce s názvem artiklu záměrně ignoruje, protože obsahují textový název zboží.
 * @param {string[]} headers - normalizovaná záhlaví
 * @returns {number} index nebo -1
 */
function findOdpisyPluCol_(headers) {
  const strongKeywords = ['plu', 'matnr', 'artiklcislo', 'cisloartiklu', 'articleid', 'artcislo'];
  for (var k = 0; k < strongKeywords.length; k++) {
    var keyword = normalizeOdpisyHeader_(strongKeywords[k]);
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i] || '');
      if (header.indexOf('nazev') >= 0 || header.indexOf('name') >= 0) continue;
      if (header.indexOf(keyword) >= 0) return i;
    }
  }

  for (var col = 0; col < headers.length; col++) {
    var h = String(headers[col] || '');
    if (h.indexOf('nazev') >= 0 || h.indexOf('name') >= 0) continue;
    if (h.indexOf('artikl') >= 0 || h.indexOf('article') >= 0) return col;
  }

  return -1;
}

/**
 * Najde sloupec s číslem filiálky/prodejny.
 * @param {string[]} headers - normalizovaná záhlaví
 * @returns {number} index nebo -1
 */
function findOdpisyStoreCol_(headers) {
  const keywords = ['prodejna', 'filialka', 'filiale', 'store', 'pobocka'];
  for (var k = 0; k < keywords.length; k++) {
    var keyword = normalizeOdpisyHeader_(keywords[k]);
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i] || '');
      if (header.indexOf('nazev') >= 0 || header.indexOf('name') >= 0) continue;
      if (header.indexOf(keyword) >= 0) return i;
    }
  }
  return -1;
}

/**
 * Najde sloupec s příznakem akce. Nejdřív podle hlavičky, potom podle hodnot W/WW ve sloupci.
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {string[]} headers
 * @returns {number} index nebo -1
 */
function findOdpisyActionFlagCol_(data, headerRow, headers) {
  const preferredCol = findOdpisyColByKeywords_(headers, [
    'akcnicena', 'akcicena', 'akce', 'akcni', 'promo'
  ]);

  var bestCol = -1;
  var bestScore = 0;
  for (var col = 0; col < headers.length; col++) {
    var score = 0;
    for (var row = headerRow + 1; row < data.length; row++) {
      var value = String(data[row][col] || '').trim().toUpperCase();
      if (isOdpisyActionFlag_(value)) score++;
    }
    if (col === preferredCol && score > 0) {
      Logger.log('[ODPISY_TELEX] Sloupec akčního příznaku potvrzen podle hlavičky i hodnot W/WW: col=%s rows=%s', col, score);
      return col;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  if (bestCol >= 0) {
    Logger.log('[ODPISY_TELEX] Sloupec akčního příznaku nalezen podle hodnot W/WW: col=%s rows=%s', bestCol, bestScore);
  }
  return bestScore > 0 ? bestCol : -1;
}

/**
 * Vrátí true, pokud buňka reprezentuje akční příznak W/WW.
 * @param {*} value
 * @returns {boolean}
 */
function isOdpisyActionFlag_(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return normalized === 'W' || normalized === 'WW';
}

/**
 * Sestaví mapu ktLabel → index sloupce v záhlaví.
 * @param {Array} headerRow - raw hodnoty řádku záhlaví
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {Object}
 */
function buildOdpisyKtColMap_(headerRow, weeks) {
  const map = {};
  weeks.forEach(function(w) {
    for (var i = 0; i < headerRow.length; i++) {
      var h = normalizeOdpisyHeader_(headerRow[i]);
      // Hledáme "2026kt20" nebo "2026kt 20" atd.
      var yearStr = String(w.year);
      var ktStr   = String(w.kt);
      var ktPad   = w.kt < 10 ? '0' + ktStr : ktStr;
      if (h.indexOf(yearStr) >= 0 && (h.indexOf('kt' + ktStr) >= 0 || h.indexOf('kt' + ktPad) >= 0)) {
        map[w.label] = i;
        break;
      }
    }
    if (map[w.label] === undefined) {
      Logger.log('[ODPISY_KT_COL] Nenalezen sloupec pro %s', w.label);
    }
  });
  return map;
}

/**
 * Normalizuje záhlaví: malá písmena, bez diakritiky, bez mezer a speciálních znaků.
 * @param {*} s
 * @returns {string}
 */
function normalizeOdpisyHeader_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[áčďéěíňóřšťúůýž]/g, function(c) {
      var map = {
        'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i',
        'ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z',
      };
      return map[c] || c;
    })
    .replace(/[\s\-_|()\[\]/\\:,.]+/g, '');
}

/**
 * Parsuje hodnotu odpisu na číslo.
 * Zvládá: číslo, "--", Czech formát "-30 197,50".
 * @param {*} val
 * @returns {number}
 */
function parseOdpisyValue_(val) {
  if (val === null || val === undefined || val === '' || val === '--' || val === '---') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var str = String(val).replace(/\s/g, '').replace(',', '.');
  var n   = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

/**
 * Normalizuje PLU/artiklové číslo na stringový klíč.
 * @param {*} val
 * @returns {string}
 */
function normalizeOdpisyPlu_(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return String(Math.round(val));
  var n = parseInt(String(val).replace(/\s/g, ''), 10);
  return isNaN(n) ? '' : String(n);
}

/**
 * Normalizuje číslo filiálky na stringový klíč.
 * @param {*} val
 * @returns {string}
 */
function normalizeOdpisyStoreNum_(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return isNaN(val) ? '' : String(Math.round(val));
  var n = parseInt(String(val).replace(/\s/g, ''), 10);
  return (isNaN(n) || n <= 0) ? '' : String(n);
}
