/**
 * OZ Dashboard — Správa dlaždic (SubApps)
 *
 * CRUD operace pro list SUBAPPS, normalizace statusů a renderování
 * dlaždic na domovském dashboardu.
 */

// Konstanty pro platné stavy dlaždic
var SUBAPP_STATUSES = ['ACTIVE', 'PREPARING', 'DISABLED'];

/**
 * Mapa interních subaplikací: normalizovaný název (bez diakritiky, bez mezer) → interní view URL.
 * Tyto URL jsou spravovány kódem — uživatel je nenastavuje ručně.
 * Přidejte každou novou interní subaplikaci sem.
 */
var INTERNAL_SUBAPP_URLS = [
  { nameContains: 'vyhodnoceniodpisuakcnich', url: '?page=odpisy' },
];

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

/**
 * Uloží dlaždici (vytvoří nebo aktualizuje dle přítomnosti payload.id).
 * @param {Object} payload
 * @returns {Object}
 */
function saveSubApp(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data        = normalizeSubAppPayload_(payload);
  validateSubAppPayload_(data);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now    = new Date();
    const sheet  = spreadsheet.getSheetByName('SUBAPPS');
    const values = sheet.getDataRange().getValues();
    const headers       = values[0];
    const idIndex       = headers.indexOf('id');
    const keyIndex      = headers.indexOf('key');
    const sortOrderIndex = headers.indexOf('sortOrder');
    let targetRow = -1;

    // Sestavíme sadu existujících klíčů a max sortOrder jedním průchodem
    const existingKeys = [];
    let maxSortOrder = 0;
    for (let row = 1; row < values.length; row++) {
      existingKeys.push(String(values[row][keyIndex] || '').trim().toUpperCase());
      maxSortOrder = Math.max(maxSortOrder, Number(values[row][sortOrderIndex] || 0));
    }

    // Auto-generace klíče a sortOrder pro nové dlaždice
    if (!data.id && !data.key) {
      const base = normalizeSubAppKey_(removeDiacritics_(data.name).toUpperCase()) || 'SUBAPP';
      let candidate = base;
      let suffix    = 2;
      while (existingKeys.indexOf(candidate) >= 0) { candidate = base + '_' + suffix; suffix++; }
      data.key = candidate;
    }
    if (!data.id && !data.sortOrder) {
      data.sortOrder = maxSortOrder + 1;
    }

    for (let row = 1; row < values.length; row++) {
      const rowId  = String(values[row][idIndex]  || '');
      const rowKey = String(values[row][keyIndex]  || '').trim().toUpperCase();
      if (data.id && rowId === data.id) {
        targetRow = row + 1;
      } else if (rowKey === data.key) {
        throw new Error('Dlaždice s tímto klíčem už existuje.');
      }
    }

    if (data.id && targetRow < 0) throw new Error('Dlaždice nebyla nalezena.');

    const source    = targetRow > 0 ? rowToObject_(headers, values[targetRow - 1]) : {};
    const rowValues = buildSubAppRow_(headers, data, source, now);

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[SUBAPP_UPDATE] by=%s key=%s', context.user.email, data.key);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[SUBAPP_CREATE] by=%s key=%s name=%s', context.user.email, data.key, data.name);
    }
  } finally {
    lock.releaseLock();
  }

  return buildUsersAdminData_(context);
}

/**
 * Smaže dlaždici a všechna navázaná oprávnění (SUBAPP_PERMISSIONS).
 * @param {string} subAppId
 * @returns {Object}
 */
function deleteSubApp(subAppId) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalized  = String(subAppId || '').trim();
  if (!normalized) throw new Error('Chybí ID dlaždice.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet   = spreadsheet.getSheetByName('SUBAPPS');
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');
    const keyIndex = headers.indexOf('key');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') !== normalized) continue;

      const subAppKey = String(values[row][keyIndex] || '');
      sheet.deleteRow(row + 1);

      // Kaskádové smazání oprávnění
      if (subAppKey) {
        const permSheet  = spreadsheet.getSheetByName('SUBAPP_PERMISSIONS');
        const permValues = permSheet.getDataRange().getValues();
        const permKeyIdx = permValues[0].indexOf('subAppKey');
        for (let pr = permValues.length - 1; pr >= 1; pr--) {
          if (String(permValues[pr][permKeyIdx] || '') === subAppKey) permSheet.deleteRow(pr + 1);
        }
        Logger.log('[SUBAPP_DELETE] by=%s id=%s key=%s perms_cleaned=true', context.user.email, normalized, subAppKey);
      } else {
        Logger.log('[SUBAPP_DELETE] by=%s id=%s', context.user.email, normalized);
      }

      return buildUsersAdminData_(context);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Dlaždice nebyla nalezena.');
}

// ---------------------------------------------------------------------------
// Čtení z databáze
// ---------------------------------------------------------------------------

/**
 * Vrátí seznam všech dlaždic seřazených dle sortOrder, pak dle názvu.
 * @param {Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function listSubApps_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('SUBAPPS'))
    .map(function(item) {
      return {
        id:           item.id,
        key:          String(item.key         || ''),
        name:         String(item.name        || ''),
        status:       normalizeSubAppStatus_(item.status),
        icon:         String(item.icon        || 'briefcase'),
        description:  String(item.description || ''),
        targetUrl:    String(item.targetUrl   || ''),
        lastUpdatedAt: formatDateValue_(item.lastUpdatedAt),
        sortOrder:    Number(item.sortOrder   || 0),
        active:       isTruthy_(item.active),
        createdAt:    formatDateValue_(item.createdAt),
        updatedAt:    formatDateValue_(item.updatedAt),
      };
    })
    .sort(function(a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name).localeCompare(String(b.name), 'cs');
    });
}

/**
 * Vrátí dlaždice připravené k zobrazení na dashboardu.
 * Admini vidí i PREPARING dlaždice; běžní uživatelé jen ACTIVE a PREPARING (jen čtení).
 * @param {Spreadsheet} spreadsheet
 * @param {Object} auth
 * @returns {Object[]}
 */
function listDashboardSubApps_(spreadsheet, auth) {
  const canOpenPreparing = isAdminAuth_(auth);
  const userAccess = auth && auth.subApps ? auth.subApps : {};

  return listSubApps_(spreadsheet)
    .filter(function(item) { return item.active; })
    .filter(function(item) {
      if (canOpenPreparing) return true;
      return item.status === 'ACTIVE' || item.status === 'PREPARING';
    })
    .map(function(item) {
      const isActive    = item.status === 'ACTIVE';
      const isPreparing = item.status === 'PREPARING';
      const enabled     = isActive || (isPreparing && canOpenPreparing);
      const accessKey   = String(item.key || '').trim().toUpperCase();
      return {
        id:          item.id,
        key:         item.key,
        title:       item.name,
        status:      subAppStatusLabel_(item.status),
        statusKey:   item.status,
        icon:        item.icon,
        description: item.description,
        updated:     item.lastUpdatedAt
                       ? 'Aktualizováno: ' + item.lastUpdatedAt
                       : 'Aktualizace zatím není uvedena',
        targetUrl:   resolveInternalSubAppUrl_(item.name, item.targetUrl),
        enabled:     enabled,
        accent:      item.status === 'ACTIVE' ? 'blue' : (item.status === 'PREPARING' ? 'red' : 'muted'),
        accessLevel: userAccess[accessKey] || null,
      };
    });
}

// ---------------------------------------------------------------------------
// Normalizace payloadu
// ---------------------------------------------------------------------------

/**
 * Normalizuje payload z UI na standardizovaný datový objekt dlaždice.
 * @param {Object} payload
 * @returns {Object}
 */
function normalizeSubAppPayload_(payload) {
  const data = payload || {};
  return {
    id:           String(data.id           || '').trim(),
    key:          normalizeSubAppKey_(data.key),
    name:         String(data.name         || '').trim(),
    status:       normalizeSubAppStatus_(data.status),
    icon:         String(data.icon         || 'briefcase').trim(),
    description:  String(data.description  || '').trim(),
    targetUrl:    String(data.targetUrl    || '').trim(),
    lastUpdatedAt: String(data.lastUpdatedAt || '').trim(),
    sortOrder:    Number(data.sortOrder    || 0),
    active: data.active === true || data.active === 'true' || data.active === '1',
  };
}

/**
 * Validuje normalizovaný payload dlaždice — vyhodí Error při první chybě.
 * @param {Object} data
 * @throws {Error}
 */
function validateSubAppPayload_(data) {
  if (!data.name) throw new Error('Vyplňte název dlaždice.');
  if (SUBAPP_STATUSES.indexOf(data.status) < 0) throw new Error('Vyberte platný stav dlaždice.');
}

/**
 * Normalizuje klíč dlaždice: velká písmena, povoleny jen A–Z, 0–9, _.
 * @param {string} value
 * @returns {string}
 */
function normalizeSubAppKey_(value) {
  return String(value || '').trim().toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Normalizuje status dlaždice z různých variant na kanonický klíč.
 * @param {string} value
 * @returns {'ACTIVE'|'PREPARING'|'DISABLED'}
 */
function normalizeSubAppStatus_(value) {
  const s = String(value || 'DISABLED').trim().toUpperCase();
  if (['ACTIVE', 'AKTIVNI', 'AKTIVNÍ'].indexOf(s) >= 0)                               return 'ACTIVE';
  if (['PREPARING', 'V_PRIPRAVE', 'V_PŘÍPRAVĚ', 'V PRIPRAVE', 'V PŘÍPRAVĚ'].indexOf(s) >= 0) return 'PREPARING';
  return 'DISABLED';
}

/**
 * Vrátí lidsky čitelný label stavu dlaždice.
 * @param {string} status
 * @returns {string}
 */
function subAppStatusLabel_(status) {
  const labels = { ACTIVE: 'Aktivní', PREPARING: 'V přípravě', DISABLED: 'Vypnuto' };
  return labels[status] || 'Vypnuto';
}

// ---------------------------------------------------------------------------
// Sestavení řádku pro spreadsheet
// ---------------------------------------------------------------------------

/**
 * Sestaví pole hodnot pro jeden řádek SUBAPPS listu.
 * @param {string[]} headers
 * @param {Object} data - normalizovaný payload
 * @param {Object} original - stávající řádek (prázdný objekt při vytváření)
 * @param {Date} now
 * @returns {Array}
 */
function buildSubAppRow_(headers, data, original, now) {
  const source = original || {};
  const values = {
    id:           data.id || Utilities.getUuid(),
    key:          data.key,
    name:         data.name,
    status:       data.status,
    icon:         data.icon,
    description:  data.description,
    targetUrl:    data.targetUrl || source.targetUrl || '',
    lastUpdatedAt: data.lastUpdatedAt,
    sortOrder:    data.sortOrder,
    active:       data.active,
    createdAt:    source.createdAt || now,
    updatedAt:    now,
  };
  return headers.map(function(h) { return values[h] !== undefined ? values[h] : ''; });
}

// ---------------------------------------------------------------------------
// Migrace interních URL
// ---------------------------------------------------------------------------

/**
 * Vrátí interní URL pro dlaždici dle jejího názvu, nebo ponechá původní targetUrl.
 * @param {string} name - název dlaždice
 * @param {string} currentUrl - stávající targetUrl z DB
 * @returns {string}
 */
function resolveInternalSubAppUrl_(name, currentUrl) {
  var normalized = removeDiacritics_(String(name || ''));
  for (var i = 0; i < INTERNAL_SUBAPP_URLS.length; i++) {
    if (normalized.indexOf(INTERNAL_SUBAPP_URLS[i].nameContains) >= 0) {
      return INTERNAL_SUBAPP_URLS[i].url;
    }
  }
  return currentUrl || '';
}

/**
 * Zapíše správnou targetUrl pro všechny interní subaplikace v SUBAPPS listu.
 * Shoda probíhá dle normalizovaného názvu dlaždice (bez diakritiky, bez mezer).
 * Idempotentní — zapíše pouze pokud se hodnota v DB liší od očekávané.
 * Voláno při inicializaci aplikace z getInitData().
 * @param {Spreadsheet} spreadsheet
 */
function ensureInternalSubAppUrls_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('SUBAPPS');
  if (!sheet || sheet.getLastRow() < 2) return;

  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const nameIdx = headers.indexOf('name');
  const urlIdx  = headers.indexOf('targetUrl');
  if (nameIdx < 0 || urlIdx < 0) return;

  for (var row = 1; row < values.length; row++) {
    var name        = String(values[row][nameIdx] || '');
    var currentUrl  = String(values[row][urlIdx]  || '').trim();
    var expectedUrl = resolveInternalSubAppUrl_(name, '');
    if (!expectedUrl || currentUrl === expectedUrl) continue;
    sheet.getRange(row + 1, urlIdx + 1).setValue(expectedUrl);
    Logger.log('[SUBAPP_URL_MIGRATED] name=%s url=%s', name, expectedUrl);
  }
}
