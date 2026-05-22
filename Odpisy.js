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

    // Čtení dat ze zdrojových souborů
    const telexSheet    = files.telex.getSheets()[0];
    const storesSheet   = files.stores.getSheets()[0];
    const articlesSheet = files.articles.getSheets()[0];

    const akcniPluSet  = readOdpisyAkcniPlu_(telexSheet);
    const storeValues  = readOdpisyCelkoveByStore_(storesSheet, weeks);
    const globalCelkem = readOdpisyGlobalCelkem_(storesSheet, weeks);
    const globalAkcni  = readOdpisyAkcniByKt_(articlesSheet, weeks, akcniPluSet);

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
        weeks.forEach(function(w) { totals[w.label] = 0; });
        storesSorted.forEach(function(s) {
          weeks.forEach(function(w) {
            totals[w.label] += (s.values[w.label] || 0);
          });
        });

        // Procentuální podíl akčních artiklů: globální akční / globální celkový
        const pct = {};
        weeks.forEach(function(w) {
          const celkem = globalCelkem[w.label] || 0;
          const akcni  = globalAkcni[w.label]  || 0;
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
            return row;
          }),
          totals: totals,
          pct:    pct,
        };
      });

    Logger.log('[ODPISY_BUILD] lcs=%s akcniPlu=%s', lcsResult.length, akcniPluSet.size);
    return {
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
      const ss  = SpreadsheetApp.openById(file.getId());
      const a1  = String(ss.getSheets()[0].getRange(1, 1).getValue() || '').toLowerCase();

      if (a1.includes('celkov')) {
        result.stores = ss;
      } else if (a1.includes('artikl')) {
        result.articles = ss;
      } else {
        result.telex = ss;
      }
      Logger.log('[ODPISY_FILE_ID] name=%s a1=%s', file.getName(), a1.slice(0, 40));
    } catch (e) {
      Logger.log('[ODPISY_FILE_SKIP] file=%s error=%s', file.getName(), e && e.message ? e.message : e);
    }
  }

  return result;
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
 * Přečte akční PLU čísla z Telex souboru.
 * Hledá sloupec s příznakem "Akční cena (W)" a sloupec s číslem artiklu.
 * @param {Sheet} sheet
 * @returns {Set<string>}
 */
function readOdpisyAkcniPlu_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return new Set();

  const headerRow = findOdpisyHeaderRowByKeywords_(data, [
    'akcnicena', 'akce', 'akcni', 'plu', 'artikl', 'article'
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_TELEX] Nenalezen řádek záhlaví Telexu s akčním příznakem nebo artiklem');
    return new Set();
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const akcniCol = findOdpisyActionFlagCol_(data, headerRow, headers);
  const pluCol   = findOdpisyColByKeywords_(headers, [
    'artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'
  ]);

  if (akcniCol < 0 || pluCol < 0) {
    Logger.log('[ODPISY_TELEX] Chybí sloupce: akcniCol=%s pluCol=%s', akcniCol, pluCol);
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

  Logger.log('[ODPISY_TELEX] akcniPlu.size=%s', akcniPlu.size);
  return akcniPlu;
}

/**
 * Vrátí mapu storeNumber → { ktLabel: value } z souboru odpisů po filiálkách.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {Object}
 */
function readOdpisyCelkoveByStore_(sheet, weeks) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  const headerRow = findOdpisyHeaderRow_(data, 'prodejna');
  if (headerRow < 0) {
    Logger.log('[ODPISY_STORES] Nenalezen řádek záhlaví s "prodejna"');
    return {};
  }

  const headers  = data[headerRow].map(normalizeOdpisyHeader_);
  const storeCol = findOdpisyColByKeyword_(headers, 'prodejna');
  if (storeCol < 0) return {};

  const ktCols = buildOdpisyKtColMap_(data[headerRow], weeks);
  const result = {};

  for (var row = headerRow + 1; row < data.length; row++) {
    var storeNum = normalizeOdpisyStoreNum_(data[row][storeCol]);
    if (!storeNum) continue;
    if (!result[storeNum]) result[storeNum] = {};
    weeks.forEach(function(w) {
      if (ktCols[w.label] !== undefined) {
        result[storeNum][w.label] = (result[storeNum][w.label] || 0)
          + parseOdpisyValue_(data[row][ktCols[w.label]]);
      }
    });
  }

  return result;
}

/**
 * Vrátí mapu ktLabel → celkový odpis (součet všech filiálek) z souboru po filiálkách.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @returns {Object}
 */
function readOdpisyGlobalCelkem_(sheet, weeks) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  const headerRow = findOdpisyHeaderRow_(data, 'prodejna');
  if (headerRow < 0) return {};

  const ktCols = buildOdpisyKtColMap_(data[headerRow], weeks);
  const result = {};
  weeks.forEach(function(w) { result[w.label] = 0; });

  for (var row = headerRow + 1; row < data.length; row++) {
    weeks.forEach(function(w) {
      if (ktCols[w.label] !== undefined) {
        result[w.label] += parseOdpisyValue_(data[row][ktCols[w.label]]);
      }
    });
  }

  return result;
}

/**
 * Vrátí mapu ktLabel → celkový akční odpis (součet akčních artiklů) z souboru po artiklech.
 * @param {Sheet} sheet
 * @param {{ year: number, kt: number, label: string }[]} weeks
 * @param {Set<string>} akcniPluSet
 * @returns {Object}
 */
function readOdpisyAkcniByKt_(sheet, weeks, akcniPluSet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  const headerRow = findOdpisyHeaderRowByKeywords_(data, [
    'artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'
  ]);
  if (headerRow < 0) {
    Logger.log('[ODPISY_ARTICLES] Nenalezen řádek záhlaví se sloupcem artiklu/PLU');
    return {};
  }

  const headers = data[headerRow].map(normalizeOdpisyHeader_);
  const pluCol  = findOdpisyColByKeywords_(headers, [
    'artikl', 'artiklcislo', 'cisloartiklu', 'article', 'articleid', 'plu', 'matnr'
  ]);
  if (pluCol < 0) return {};

  const ktCols = buildOdpisyKtColMap_(data[headerRow], weeks);
  const result = {};
  weeks.forEach(function(w) { result[w.label] = 0; });

  for (var row = headerRow + 1; row < data.length; row++) {
    var plu = normalizeOdpisyPlu_(data[row][pluCol]);
    if (!plu || !akcniPluSet.has(plu)) continue;
    weeks.forEach(function(w) {
      if (ktCols[w.label] !== undefined) {
        result[w.label] += parseOdpisyValue_(data[row][ktCols[w.label]]);
      }
    });
  }

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
      if (normalized.some(function(h) { return h.indexOf(keyword) >= 0; })) return row;
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
 * Najde sloupec s příznakem akce. Nejdřív podle hlavičky, potom podle hodnot W/WW ve sloupci.
 * @param {Array[]} data
 * @param {number} headerRow
 * @param {string[]} headers
 * @returns {number} index nebo -1
 */
function findOdpisyActionFlagCol_(data, headerRow, headers) {
  const byHeader = findOdpisyColByKeywords_(headers, [
    'akcnicena', 'akcicena', 'akce', 'akcni', 'promo'
  ]);
  if (byHeader >= 0) return byHeader;

  var bestCol = -1;
  var bestScore = 0;
  for (var col = 0; col < headers.length; col++) {
    var score = 0;
    for (var row = headerRow + 1; row < data.length; row++) {
      var value = String(data[row][col] || '').trim().toUpperCase();
      if (value === 'W' || value === 'WW') score++;
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
