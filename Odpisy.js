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

const ODPISY_SOURCE_FOLDER_ID_PROP  = 'ODPISY_SOURCE_FOLDER_ID';
const ODPISY_CACHE_BUSTER_PROP      = 'ODPISY_CACHE_BUSTER';
const ODPISY_CACHE_TTL_SECONDS      = 300;
const ODPISY_KNOWN_MTIMES_PROP      = 'ODPISY_KNOWN_MTIMES';   // JSON {telex,stores,articles} v ms
const ODPISY_LAST_BUILD_TS_PROP     = 'ODPISY_LAST_BUILD_TS';  // ISO timestamp posledního buildu
const ODPISY_LAST_CHECK_TS_PROP     = 'ODPISY_LAST_CHECK_TS';  // ISO timestamp poslední kontroly zdrojových souborů
const ODPISY_NEXT_CHECK_TS_PROP     = 'ODPISY_NEXT_CHECK_TS';  // ISO timestamp odhadované příští kontroly
const ODPISY_CHECK_INTERVAL_MIN     = 30;                      // interval auto-kontroly v minutách

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
  const result  = buildOdpisyData_(context);
  const updateStatus = getOdpisyUpdateStatus_();
  result.updateStatus = updateStatus;
  result.lastBuildTs = updateStatus.lastBuildTs || '';
  return result;
}

/**
 * Nastaví (nebo přenastaví) time-driven trigger pro automatickou kontrolu souborů.
 * Spouštět jednou — z nastavení aplikace nebo z GAS editoru jako vlastník skriptu.
 * Trigger běží každých ODPISY_CHECK_INTERVAL_MIN minut jako účet vlastníka skriptu.
 * @returns {{ ok: boolean, message: string }}
 */
function setupOdpisyTrigger() {
  requirePermission_('branches.sync');
  try {
    // Odstraníme stávající triggery pro tuto funkci, aby nevznikly duplicity
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'triggerOdpisyCheck') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('triggerOdpisyCheck')
      .timeBased()
      .everyMinutes(ODPISY_CHECK_INTERVAL_MIN)
      .create();
    storeOdpisyCheckStatus_(null, new Date(Date.now() + ODPISY_CHECK_INTERVAL_MIN * 60000));
    Logger.log('[ODPISY_TRIGGER_SETUP] Trigger nastaven každých %s minut', ODPISY_CHECK_INTERVAL_MIN);
    return {
      ok: true,
      message: 'Trigger nastaven — kontrola každých ' + ODPISY_CHECK_INTERVAL_MIN + ' minut.',
      updateStatus: getOdpisyUpdateStatus_(),
    };
  } catch (e) {
    Logger.log('[ODPISY_TRIGGER_SETUP_ERROR] %s', e && e.message ? e.message : e);
    return { ok: false, message: 'Chyba při nastavení triggeru: ' + (e && e.message ? e.message : String(e)) };
  }
}

/**
 * Handler time-driven triggeru — kontroluje změny souborů a spouští refresh.
 * Název funkce NESMÍ být změněn — musí odpovídat registraci triggeru.
 */
function triggerOdpisyCheck() {
  try {
    checkOdpisyFilesAndRefresh_();
  } catch (e) {
    Logger.log('[ODPISY_TRIGGER_ERROR] %s', e && e.message ? e.message : e);
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
// Automatická kontrola souborů (trigger)
// ---------------------------------------------------------------------------

/**
 * Zkontroluje, zda se od poslední kontroly změnily všechny tři zdrojové soubory.
 * Pokud ano, spustí přegenerování dat, aktualizuje cache a timestamp dlaždice.
 *
 * Logika:
 *   1. Načte aktuální mtime všech tří souborů z Drive.
 *   2. Porovná s naposledy uloženými mtimes (Script Properties).
 *   3. Pokud se změnily VŠECHNY tři → refresh (nová data = nový týden).
 *   4. Uloží aktuální mtimes pro příští kontrolu.
 */
function checkOdpisyFilesAndRefresh_() {
  const props    = PropertiesService.getScriptProperties();
  const checkTs  = new Date();
  storeOdpisyCheckStatus_(checkTs, new Date(checkTs.getTime() + ODPISY_CHECK_INTERVAL_MIN * 60000));
  const folderId = props.getProperty(ODPISY_SOURCE_FOLDER_ID_PROP) || '';
  if (!folderId) {
    Logger.log('[ODPISY_CHECK] Přeskočeno — zdrojová složka není nastavena');
    return;
  }

  const files = findOdpisyFiles_(folderId);
  if (!files.telex || !files.stores || !files.articles) {
    Logger.log('[ODPISY_CHECK] Přeskočeno — jeden nebo více souborů nenalezeno');
    return;
  }

  const currentMtimes = {
    telex:    files.telex.updatedAt,
    stores:   files.stores.updatedAt,
    articles: files.articles.updatedAt,
  };

  const storedJson = props.getProperty(ODPISY_KNOWN_MTIMES_PROP);
  if (!storedJson) {
    // První spuštění — uložíme referenční časy, refresh nespouštíme
    props.setProperty(ODPISY_KNOWN_MTIMES_PROP, JSON.stringify(currentMtimes));
    Logger.log('[ODPISY_CHECK] První spuštění — referenční mtimes uloženy, refresh odložen');
    return;
  }

  const storedMtimes    = JSON.parse(storedJson);
  const telexChanged    = currentMtimes.telex    !== storedMtimes.telex;
  const storesChanged   = currentMtimes.stores   !== storedMtimes.stores;
  const articlesChanged = currentMtimes.articles !== storedMtimes.articles;

  Logger.log('[ODPISY_CHECK] telex=%s stores=%s articles=%s',
    telexChanged    ? 'CHANGED' : 'same',
    storesChanged   ? 'CHANGED' : 'same',
    articlesChanged ? 'CHANGED' : 'same'
  );

  // Vždy uložíme aktuální stav, abychom stopovat průběžné nahrávání
  props.setProperty(ODPISY_KNOWN_MTIMES_PROP, JSON.stringify(currentMtimes));

  if (!telexChanged || !storesChanged || !articlesChanged) {
    Logger.log('[ODPISY_CHECK] Čekám — ještě ne všechny tři soubory aktualizovány');
    return;
  }

  // Všechny tři soubory jsou nové → force-rebuild
  Logger.log('[ODPISY_CHECK] Všechny soubory změněny — spouštím přegenerování dat');
  bumpOdpisyCacheBuster_();

  const database = ensureDatabase_();
  const fakeContext = {
    database: database,
    user:     { email: 'system@trigger' },
    auth:     { hasAccess: true, permissions: [], subApps: {} },
  };
  buildOdpisyData_(fakeContext);
  Logger.log('[ODPISY_CHECK] Automatická aktualizace dokončena');
}

/**
 * Uloží aktuální mtime všech tří souborů do Script Properties.
 * Voláno po každém úspěšném manuálním i automatickém buildu.
 * @param {{ telex, stores, articles }} files - výsledek findOdpisyFiles_
 */
function storeOdpisyMtimes_(files) {
  try {
    const mtimes = {
      telex:    files.telex    ? files.telex.updatedAt    : 0,
      stores:   files.stores   ? files.stores.updatedAt   : 0,
      articles: files.articles ? files.articles.updatedAt : 0,
    };
    PropertiesService.getScriptProperties().setProperty(ODPISY_KNOWN_MTIMES_PROP, JSON.stringify(mtimes));
  } catch (e) {
    Logger.log('[ODPISY_MTIME_STORE_ERROR] %s', e && e.message ? e.message : e);
  }
}

/**
 * Uloží stav časů automatické kontroly do Script Properties.
 * @param {Date|null} lastCheck
 * @param {Date|null} nextCheck
 */
function storeOdpisyCheckStatus_(lastCheck, nextCheck) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (lastCheck) props.setProperty(ODPISY_LAST_CHECK_TS_PROP, lastCheck.toISOString());
    if (nextCheck) props.setProperty(ODPISY_NEXT_CHECK_TS_PROP, nextCheck.toISOString());
  } catch (e) {
    Logger.log('[ODPISY_CHECK_STATUS_STORE_ERROR] %s', e && e.message ? e.message : e);
  }
}

/**
 * Vrátí uložený stav aktualizací a kontrol pro toolbar.
 * @returns {{ lastBuildTs: string, lastCheckTs: string, nextCheckTs: string, intervalMinutes: number }}
 */
function getOdpisyUpdateStatus_() {
  const props = PropertiesService.getScriptProperties();
  return {
    lastBuildTs: props.getProperty(ODPISY_LAST_BUILD_TS_PROP) || '',
    lastCheckTs: props.getProperty(ODPISY_LAST_CHECK_TS_PROP) || '',
    nextCheckTs: props.getProperty(ODPISY_NEXT_CHECK_TS_PROP) || '',
    intervalMinutes: ODPISY_CHECK_INTERVAL_MIN,
  };
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
      Logger.log('[ODPISY_CACHE_HIT] key=%s elapsedMs=%s', cacheKey, Date.now() - startedAt);
      return cached;
    }

    const readStartedAt = Date.now();
    const telexValues  = readOdpisySheetValues_(files.telex.spreadsheet.getSheets()[0]);
    const akcniTelex   = readOdpisyAkcniDataFromValues_(telexValues, files.telex.name);
    const akcniPluSet  = akcniTelex.pluSet;
    const storesValues = readOdpisySheetValues_(files.stores.spreadsheet.getSheets()[0]);
    const storesData   = readOdpisyStoresFromValues_(storesValues, weeks);
    const storeValues  = storesData.byStore;
    const globalCelkem = storesData.globalCelkem;
    const akcniData    = akcniPluSet.size > 0
      ? readOdpisyAkcniMetricsOptimized_(files.articles.spreadsheet.getSheets()[0], weeks, akcniPluSet, files.articles.name)
      : { byStore: {}, global: buildOdpisyEmptyWeekMap_(weeks) };
    const akcniByStore = akcniData.byStore || {};
    const globalAkcni  = akcniData.global  || buildOdpisyEmptyWeekMap_(weeks);
    Logger.log('[ODPISY_READ] telexRows=%s storesRows=%s elapsedMs=%s',
      telexValues.length, storesValues.length, Date.now() - readStartedAt);

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

    const lcGroups = {};
    Object.keys(storeValues).forEach(function(storeNum) {
      const abbr = (storeToLcAbbr[storeNum] || '').toUpperCase();
      if (!abbr) return;
      if (!lcGroups[abbr]) lcGroups[abbr] = { stores: [] };
      lcGroups[abbr].stores.push({
        storeNumber: parseInt(storeNum, 10) || 0,
        storeName:   storeToName[storeNum] || '',
        rm:          storeToRm[storeNum] || '',
        values:      storeValues[storeNum],
        akcniValues: akcniByStore[storeNum] || buildOdpisyEmptyWeekMap_(weeks),
      });
    });

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
          var rmA = (a.rm || '').toLowerCase();
          var rmB = (b.rm || '').toLowerCase();
          if (rmA < rmB) return -1;
          if (rmA > rmB) return 1;
          return a.storeNumber - b.storeNumber;
        });
        const storeCount = storesSorted.length || 1;

        const totals      = {};
        const akcniTotals = {};
        weeks.forEach(function(w) { totals[w.label] = 0; akcniTotals[w.label] = 0; });
        storesSorted.forEach(function(s) {
          weeks.forEach(function(w) {
            totals[w.label]      += (s.values[w.label] || 0);
            akcniTotals[w.label] += (s.akcniValues[w.label] || 0);
          });
        });

        const avgTotals      = {};
        const avgAkcniTotals = {};
        const pct            = {};
        weeks.forEach(function(w) {
          avgTotals[w.label]      = totals[w.label] / storeCount;
          avgAkcniTotals[w.label] = akcniTotals[w.label] / storeCount;
          const celkem = totals[w.label] || 0;
          const akcni  = akcniTotals[w.label] || 0;
          pct[w.label] = celkem !== 0 ? Math.abs(akcni) / Math.abs(celkem) * 100 : 0;
        });

        return {
          code:            lc.code,
          abbreviation:    lc.abbreviation,
          city:            lc.city || '',
          stores: storesSorted.map(function(s) {
            const row = { storeNumber: s.storeNumber, storeName: s.storeName, rm: s.rm || '' };
            weeks.forEach(function(w) { row[w.label] = s.values[w.label] || 0; });
            row.akcni = {};
            weeks.forEach(function(w) { row.akcni[w.label] = s.akcniValues[w.label] || 0; });
            return row;
          }),
          totals:           totals,
          avgTotals:        avgTotals,
          akcniTotals:      akcniTotals,
          avgAkcniTotals:   avgAkcniTotals,
          pct:              pct,
        };
      });

    Logger.log('[ODPISY_BUILD] lcs=%s akcniPlu=%s elapsedMs=%s', lcsResult.length, akcniPluSet.size, Date.now() - startedAt);
    const result = {
      configured:   true,
      canConfigure: canConfigure,
      folderId:     folderId,
      weeks:          weeks,
      lcs:            lcsResult,
      akcniCount:     akcniPluSet.size,
      akcniArticles:  akcniTelex.articles,
      globalAkcni:  globalAkcni,
      globalCelkem: globalCelkem,
      error:        null,
    };
    putOdpisyCachedResult_(cacheKey, result);

    // Uložíme mtimes a timestamp pro trigger i pro zobrazení v toolbaru
    storeOdpisyMtimes_(files);
    const buildTs = new Date();
    try { PropertiesService.getScriptProperties().setProperty(ODPISY_LAST_BUILD_TS_PROP, buildTs.toISOString()); } catch (e) { /* nevadí */ }
    updateSubAppLastUpdatedByUrl_(context.database.spreadsheet, '?page=odpisy', buildTs);
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
 * Projde složku a identifikuje tři zdrojové soubory dle obsahu a názvu.
 * @param {string} folderId
 * @returns {{ telex: Object|null, stores: Object|null, articles: Object|null }}
 */
function findOdpisyFiles_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files  = folder.getFiles();
  const result = { telex: null, stores: null, articles: null };

  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;

    try {
      const ss    = SpreadsheetApp.openById(file.getId());
      const sheet = ss.getSheets()[0];
      const kind  = classifyOdpisySourceFile_(sheet, file.getName());
      const item  = {
        spreadsheet: ss,
        id:          file.getId(),
        name:        file.getName(),
        updatedAt:   file.getLastUpdated().getTime(),
      };

      if (kind === 'stores')        result.stores   = item;
      else if (kind === 'articles') result.articles = item;
      else                          result.telex    = item;

      Logger.log('[ODPISY_FILE_ID] name=%s kind=%s', file.getName(), kind);
    } catch (e) {
      Logger.log('[ODPISY_FILE_SKIP] file=%s error=%s', file.getName(), e && e.message ? e.message : e);
    }
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

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Sestaví stabilní cache key podle složky, týdnů a verzí zdrojových souborů.
 * @param {string} folderId
 * @param {Array} weeks
 * @param {Object} files
 * @returns {string}
 */
function buildOdpisyCacheKey_(folderId, weeks, files) {
  const buster  = PropertiesService.getScriptProperties().getProperty(ODPISY_CACHE_BUSTER_PROP) || '0';
  const fileSig = ['telex', 'stores', 'articles'].map(function(key) {
    const f = files[key] || {};
    return [key, f.id || '', f.updatedAt || ''].join(':');
  }).join('|');
  const weekSig = weeks.map(function(w) { return w.label; }).join('|');
  return 'ODPISY_DATA_V4_' + Utilities.base64EncodeWebSafe(folderId + '|' + weekSig + '|' + fileSig + '|' + buster).slice(0, 120);
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
  const now         = new Date();
  const currentKt   = odpisyIsoWeek_(now);
  const currentYear = odpisyIsoYear_(now);
  const weeks       = [];

  for (var i = 2; i >= 1; i--) {
    var kt   = currentKt - i;
    var year = currentYear;
    if (kt <= 0) {
      year -= 1;
      kt   += odpisyIsoWeeksInYear_(year);
    }
    weeks.push({ year: year, kt: kt, label: String(year) + ' KT ' + (kt < 10 ? '0' + kt : String(kt)) });
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
  return odpisyIsoWeek_(new Date(year, 11, 28));
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
 * Vrátí akční PLU set + seznam artiklů {plu, name} z hodnot Telex souboru.
 * @param {Array[]} data
 * @param {string=} sourceName
 * @returns {{ pluSet: Set<string>, articles: {plu:string,name:string}[] }}
 */
function readOdpisyAkcniDataFromValues_(data, sourceName) {
  if (data.length < 2) return { pluSet: new Set(), articles: [] };

  const headerRow = findOdpisyHeaderRowByKeywords_(data, [
    'akcnicena', 'akce', 'akcni', 'plu', 'artikl', 'article', 'matnr', 'w', 'ww',
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_TELEX] Nenalezen řádek záhlaví; source=%s', sourceName || '');
    return { pluSet: new Set(), articles: [] };
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const akcniCol = findOdpisyActionFlagCol_(data, headerRow, headers);
  const pluCol   = findOdpisyPluCol_(headers);
  const nameCol  = findOdpisyArtiklNameCol_(headers);

  if (akcniCol < 0 || pluCol < 0) {
    Logger.log('[ODPISY_TELEX] Chybí sloupce; source=%s headerRow=%s akcniCol=%s pluCol=%s',
      sourceName || '', headerRow + 1, akcniCol, pluCol);
    return { pluSet: new Set(), articles: [] };
  }

  const pluSet  = new Set();
  const articles = [];
  for (var row = headerRow + 1; row < data.length; row++) {
    var flag = String(data[row][akcniCol] || '').trim().toUpperCase();
    if (flag === 'W' || flag === 'WW') {
      var plu = normalizeOdpisyPlu_(data[row][pluCol]);
      if (plu && !pluSet.has(plu)) {
        pluSet.add(plu);
        var name = nameCol >= 0 ? String(data[row][nameCol] || '').trim() : '';
        articles.push({ plu: plu, name: name, flag: flag });
      }
    }
  }

  Logger.log('[ODPISY_TELEX] source=%s headerRow=%s pluCol=%s nameCol=%s pluSet.size=%s',
    sourceName || '', headerRow + 1, pluCol + 1, nameCol, pluSet.size);
  return { pluSet: pluSet, articles: articles };
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
    'akcnicena', 'akce', 'akcni', 'plu', 'artikl', 'article', 'matnr', 'w', 'ww',
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_TELEX] Nenalezen řádek záhlaví; source=%s', sourceName || '');
    return new Set();
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const akcniCol = findOdpisyActionFlagCol_(data, headerRow, headers);
  const pluCol   = findOdpisyPluCol_(headers);

  if (akcniCol < 0 || pluCol < 0) {
    Logger.log('[ODPISY_TELEX] Chybí sloupce: source=%s headerRow=%s akcniCol=%s pluCol=%s',
      sourceName || '', headerRow + 1, akcniCol, pluCol);
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
 * Vrátí mapy akčních odpisů z poartiklového souboru.
 * Čte všechny potřebné sloupce v jediném getRange() volání.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @param {string=} sourceName
 * @returns {{ byStore: Object, global: Object }}
 */
function readOdpisyAkcniMetricsOptimized_(sheet, weeks, akcniPluSet, sourceName) {
  const empty = { byStore: {}, global: buildOdpisyEmptyWeekMap_(weeks) };
  if (!akcniPluSet || akcniPluSet.size === 0) {
    Logger.log('[ODPISY_ARTICLES] Přeskakuji — žádná akční PLU; source=%s', sourceName || '');
    return empty;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return empty;

  // Detekce záhlaví z prvních 15 řádků
  const previewRows = Math.min(lastRow, 15);
  const preview = sheet.getRange(1, 1, previewRows, lastCol).getValues();
  const headerRow = findOdpisyArticlesHeaderRow_(preview, weeks);
  if (headerRow < 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezen řádek záhlaví; source=%s', sourceName || '');
    return empty;
  }

  const header  = preview[headerRow];
  const headers = header.map(normalizeOdpisyHeader_);
  const pluCol   = findOdpisyPluCol_(headers);
  const storeCol = findOdpisyStoreCol_(headers);
  if (pluCol < 0 || storeCol < 0) {
    Logger.log('[ODPISY_ARTICLES] Chybí sloupce plu/prodejna; source=%s headerRow=%s', sourceName || '', headerRow + 1);
    return empty;
  }

  const ktCols      = buildOdpisyKtColMap_(header, weeks);
  const ktColValues = Object.values(ktCols);
  if (ktColValues.length === 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezeny KT sloupce; source=%s', sourceName || '');
    return empty;
  }

  const dataStartRow = headerRow + 2;
  const numRows      = Math.max(lastRow - headerRow - 1, 0);
  if (numRows < 1) return empty;

  // Jeden getRange() místo N separátních volání
  const allCols = [pluCol, storeCol].concat(ktColValues);
  const minCol  = Math.min.apply(null, allCols);
  const maxCol  = Math.max.apply(null, allCols);
  const block   = sheet.getRange(dataStartRow, minCol + 1, numRows, maxCol - minCol + 1).getValues();

  const localPlu   = pluCol   - minCol;
  const localStore = storeCol - minCol;
  const localKt    = {};
  weeks.forEach(function(w) {
    if (ktCols[w.label] !== undefined) localKt[w.label] = ktCols[w.label] - minCol;
  });

  const byStore = {};
  const global  = buildOdpisyEmptyWeekMap_(weeks);
  var matchedRows = 0;
  var matchedWithStore = 0;

  for (var row = 0; row < numRows; row++) {
    var plu = normalizeOdpisyPlu_(block[row][localPlu]);
    if (!plu || !akcniPluSet.has(plu)) continue;
    matchedRows++;

    var storeNum = normalizeOdpisyStoreNum_(block[row][localStore]);
    if (storeNum && !byStore[storeNum]) byStore[storeNum] = buildOdpisyEmptyWeekMap_(weeks);
    if (storeNum) matchedWithStore++;

    weeks.forEach(function(w) {
      if (localKt[w.label] === undefined) return;
      var value = parseOdpisyValue_(block[row][localKt[w.label]]);
      global[w.label] += value;
      if (storeNum) byStore[storeNum][w.label] += value;
    });
  }

  Logger.log('[ODPISY_ARTICLES_OPT] source=%s headerRow=%s pluCol=%s storeCol=%s matchedRows=%s stores=%s akcniPlu=%s rows=%s',
    sourceName || '', headerRow + 1, pluCol + 1, storeCol + 1, matchedRows, Object.keys(byStore).length, akcniPluSet.size, numRows);
  return { byStore: byStore, global: global };
}

// ---------------------------------------------------------------------------
// Pomocné funkce pro zpracování dat
// ---------------------------------------------------------------------------

/**
 * Najde index prvního řádku záhlaví obsahujícího keyword (prvních 10 řádků).
 * @param {Array[]} data
 * @param {string} keyword
 * @returns {number}
 */
function findOdpisyHeaderRow_(data, keyword) {
  for (var row = 0; row < Math.min(data.length, 10); row++) {
    if (data[row].map(normalizeOdpisyHeader_).some(function(h) { return h.indexOf(keyword) >= 0; })) return row;
  }
  return -1;
}

/**
 * Najde index prvního řádku záhlaví obsahujícího alespoň jedno z klíčových slov.
 * @param {Array[]} data
 * @param {string[]} keywords
 * @returns {number}
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
 * Najde skutečný řádek záhlaví v poartiklovém exportu.
 * Vyžaduje přítomnost PLU sloupce, sloupce prodejny a alespoň jednoho KT sloupce.
 * @param {Array[]} data
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {number}
 */
function findOdpisyArticlesHeaderRow_(data, weeks) {
  var bestRow = -1;
  var bestScore = 0;
  for (var row = 0; row < Math.min(data.length, 30); row++) {
    var rawHeaders = data[row] || [];
    var headers    = rawHeaders.map(normalizeOdpisyHeader_);
    var pluCol     = findOdpisyPluCol_(headers);
    var storeCol   = findOdpisyStoreCol_(headers);
    var ktCols     = buildOdpisyKtColMap_(rawHeaders, weeks, true);
    var ktCount    = Object.keys(ktCols).length;

    if (pluCol < 0 || storeCol < 0 || ktCount < 1) continue;

    var score = 10 + ktCount * 5;
    if (headers.some(function(h) { return h.indexOf('tyden') >= 0 || h.indexOf('week') >= 0; })) score += 2;
    if (score > bestScore) { bestScore = score; bestRow = row; }
  }
  return bestRow;
}

/**
 * Najde index sloupce, jehož normalizovaný název obsahuje keyword.
 * @param {string[]} headers
 * @param {string} keyword
 * @returns {number}
 */
function findOdpisyColByKeyword_(headers, keyword) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].indexOf(keyword) >= 0) return i;
  }
  return -1;
}

/**
 * Najde index sloupce podle více možných názvů.
 * @param {string[]} headers
 * @param {string[]} keywords
 * @returns {number}
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
 * Ignoruje sloupce s názvem artiklu (textový název zboží).
 * @param {string[]} headers
 * @returns {number}
 */
function findOdpisyPluCol_(headers) {
  const strongKeywords = ['plu', 'matnr', 'artiklcislo', 'cisloartiklu', 'articleid', 'artcislo'];
  for (var k = 0; k < strongKeywords.length; k++) {
    var keyword = normalizeOdpisyHeader_(strongKeywords[k]);
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '');
      if (h.indexOf('nazev') >= 0 || h.indexOf('name') >= 0) continue;
      if (h.indexOf(keyword) >= 0) return i;
    }
  }
  for (var col = 0; col < headers.length; col++) {
    var h2 = String(headers[col] || '');
    if (h2.indexOf('nazev') >= 0 || h2.indexOf('name') >= 0) continue;
    if (h2.indexOf('artikl') >= 0 || h2.indexOf('article') >= 0) return col;
  }
  return -1;
}

/**
 * Najde sloupec s číslem filiálky/prodejny.
 * @param {string[]} headers
 * @returns {number}
 */
function findOdpisyStoreCol_(headers) {
  const keywords = ['prodejna', 'filialka', 'filiale', 'store', 'pobocka'];
  for (var k = 0; k < keywords.length; k++) {
    var keyword = normalizeOdpisyHeader_(keywords[k]);
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '');
      if (h.indexOf('nazev') >= 0 || h.indexOf('name') >= 0) continue;
      if (h.indexOf(keyword) >= 0) return i;
    }
  }
  return -1;
}

/**
 * Najde sloupec s názvem/označením artiklu (textový popis).
 * @param {string[]} headers
 * @returns {number}
 */
function findOdpisyArtiklNameCol_(headers) {
  const strongKeywords = ['bezeichnung', 'artiklnazev', 'nazevartiklu', 'description', 'artiklbez'];
  for (var k = 0; k < strongKeywords.length; k++) {
    var keyword = normalizeOdpisyHeader_(strongKeywords[k]);
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].indexOf(keyword) >= 0) return i;
    }
  }
  var pluColIdx = findOdpisyPluCol_(headers);
  for (var j = 0; j < headers.length; j++) {
    if (j === pluColIdx) continue;
    var h = String(headers[j] || '');
    if (h.indexOf('nazev') >= 0 || h.indexOf('name') >= 0) return j;
  }
  return -1;
}

/**
 * Najde sloupec s příznakem akce (nejdřív podle hlavičky, pak podle hodnot W/WW).
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {string[]} headers
 * @returns {number}
 */
function findOdpisyActionFlagCol_(data, headerRow, headers) {
  const preferredCol = findOdpisyColByKeywords_(headers, [
    'akcnicena', 'akcicena', 'akce', 'akcni', 'promo',
  ]);

  var bestCol = -1;
  var bestScore = 0;
  for (var col = 0; col < headers.length; col++) {
    var score = 0;
    for (var row = headerRow + 1; row < data.length; row++) {
      if (isOdpisyActionFlag_(data[row][col])) score++;
    }
    if (col === preferredCol && score > 0) return col;
    if (score > bestScore) { bestScore = score; bestCol = col; }
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
 * @param {Array} headerRow
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {boolean=} silent
 * @returns {Object}
 */
function buildOdpisyKtColMap_(headerRow, weeks, silent) {
  const map = {};
  weeks.forEach(function(w) {
    for (var i = 0; i < headerRow.length; i++) {
      var h      = normalizeOdpisyHeader_(headerRow[i]);
      var yearStr = String(w.year);
      var ktStr   = String(w.kt);
      var ktPad   = w.kt < 10 ? '0' + ktStr : ktStr;
      if (h.indexOf(yearStr) >= 0 && (h.indexOf('kt' + ktStr) >= 0 || h.indexOf('kt' + ktPad) >= 0)) {
        map[w.label] = i;
        break;
      }
    }
    if (map[w.label] === undefined && !silent) {
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
 * Parsuje hodnotu odpisu na číslo. Zvládá: číslo, "--", Czech formát "-30 197,50".
 * @param {*} val
 * @returns {number}
 */
function parseOdpisyValue_(val) {
  if (val === null || val === undefined || val === '' || val === '--' || val === '---') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
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
