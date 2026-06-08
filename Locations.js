/**
 * OZ Dashboard — Správa umístění a úseků
 *
 * CRUD operace pro listy LOCATIONS a DEPARTMENTS.
 * Obě entity jsou spravovány společně, protože úseky odkazují na umístění.
 */

// ===========================================================================
// UMÍSTĚNÍ (LOCATIONS)
// ===========================================================================

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

function getLocationsData() {
  const context = requirePermission_('users.manage');
  return buildLocationsData_(context);
}

/**
 * Uloží umístění (vytvoří nebo aktualizuje dle přítomnosti payload.id).
 * @param {Object} payload
 * @returns {Object}
 */
function saveLocation(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data = payload || {};
  const id          = String(data.id          || '').trim();
  const type        = String(data.type        || 'LC').trim().toUpperCase();
  const code        = String(data.code        || '').trim();
  const abbreviation = String(data.abbreviation || '').trim().toUpperCase();
  const city        = String(data.city        || '').trim();
  const name        = String(data.name        || '').trim();
  const active      = data.active === true || data.active === 'true';

  if (type === 'LC' && !code) throw new Error('Vyplňte číslo LC.');
  if (type === 'LC' && !city) throw new Error('Vyplňte město.');
  if (type === 'OSTATNI' && !name) throw new Error('Vyplňte název umístění.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now    = new Date();
    const sheet  = spreadsheet.getSheetByName('LOCATIONS');
    const values = sheet.getDataRange().getValues();
    const headers   = values[0];
    const idIndex   = headers.indexOf('id');
    const codeIndex = headers.indexOf('code');
    let targetRow = -1;

    for (let row = 1; row < values.length; row++) {
      if (id && String(values[row][idIndex] || '') === id) {
        targetRow = row + 1;
      } else if (type === 'LC' && code && String(values[row][codeIndex] || '').trim() === code) {
        throw new Error('Umístění s tímto kódem LC již existuje.');
      }
    }

    const map = { id: id || Utilities.getUuid(), type, code, abbreviation, city, name, active, updatedAt: now };
    if (!id) map.createdAt = now;
    const rowValues = headers.map(function(h) {
      if (map[h] !== undefined) return map[h];
      return targetRow > 0 ? values[targetRow - 1][headers.indexOf(h)] : '';
    });

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[LOCATION_UPDATE] by=%s id=%s code=%s', context.user.email, id, code);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[LOCATION_CREATE] by=%s type=%s code=%s', context.user.email, type, code);
    }
  } finally {
    lock.releaseLock();
  }

  return buildLocationsData_(context);
}

/**
 * Smaže umístění. Centrálu nelze smazat, ani umístění přiřazené úseku nebo uživateli.
 * @param {string} locationId
 * @returns {Object}
 */
function deleteLocation(locationId) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalized  = String(locationId || '').trim();
  if (!normalized) throw new Error('Chybí ID umístění.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet    = spreadsheet.getSheetByName('LOCATIONS');
    const values   = sheet.getDataRange().getValues();
    const headers  = values[0];
    const idIndex  = headers.indexOf('id');
    const typeIndex = headers.indexOf('type');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') !== normalized) continue;

      if (String(values[row][typeIndex] || '') === 'CENTRALA') {
        throw new Error('Centrálu nelze smazat.');
      }

      // Ověřit, zda umístění nepoužívají úseky
      const deptRows = getObjects_(spreadsheet.getSheetByName('DEPARTMENTS'));
      const deptUsing = deptRows.filter(function(d) {
        return String(d.locationIds || '').split(',')
          .map(function(s) { return s.trim(); })
          .indexOf(normalized) >= 0;
      });
      if (deptUsing.length > 0) {
        throw new Error(
          'Umístění nelze smazat — používají ho tyto úseky: ' +
          deptUsing.map(function(d) { return d.name; }).join(', ') + '.',
        );
      }

      // Ověřit, zda umístění nepoužívají uživatelé
      const location     = rowToObject_(headers, values[row]);
      const locationName = mapLocationDisplayName_(location);
      const usersUsing   = getObjects_(spreadsheet.getSheetByName('USERS')).filter(function(user) {
        return String(user.locationName || '').trim() === locationName;
      });
      if (usersUsing.length > 0) {
        throw new Error(
          'Umístění nelze smazat — je přiřazeno ' + usersUsing.length +
          (usersUsing.length === 1 ? ' uživateli.' : ' uživatelům.'),
        );
      }

      sheet.deleteRow(row + 1);
      Logger.log('[LOCATION_DELETE] by=%s id=%s', context.user.email, normalized);
      return buildLocationsData_(context);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Umístění nebylo nalezeno.');
}

// ---------------------------------------------------------------------------
// Sestavení dat pro UI
// ---------------------------------------------------------------------------

/**
 * Sestaví datový objekt pro administraci umístění (včetně dat auditního záznamu).
 * @param {Object} context
 * @returns {Object}
 */
function buildLocationsData_(context) {
  const spreadsheet = context.database.spreadsheet;
  return {
    auth: context.auth,
    locations: getObjects_(spreadsheet.getSheetByName('LOCATIONS'))
      .map(function(loc) {
        return Object.assign({}, mapLocationRow_(loc), {
          createdAt: formatDateValue_(loc.createdAt),
          updatedAt: formatDateValue_(loc.updatedAt),
        });
      })
      .sort(locationSortFn_),
  };
}

// ---------------------------------------------------------------------------
// Čtení z databáze
// ---------------------------------------------------------------------------

/**
 * Vrátí aktivní umístění seřazená (Centrála první, pak LC vzestupně).
 * @param {Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function listLocations_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('LOCATIONS'))
    .filter(function(loc) { return isTruthy_(loc.active); })
    .map(mapLocationRow_)
    .sort(locationSortFn_);
}

/**
 * Převede surový řádek LOCATIONS na normalizovaný objekt včetně displayName.
 * @param {Object} loc
 * @returns {Object}
 */
function mapLocationRow_(loc) {
  return {
    id:           loc.id,
    type:         String(loc.type         || ''),
    code:         String(loc.code         || ''),
    abbreviation: String(loc.abbreviation || ''),
    city:         String(loc.city         || ''),
    name:         String(loc.name         || ''),
    displayName:  mapLocationDisplayName_(loc),
    active:       isTruthy_(loc.active),
  };
}

/**
 * Vrátí lidsky čitelné jméno umístění (Centrála, nebo "LC123 PRH Praha").
 * @param {Object} loc
 * @returns {string}
 */
function mapLocationDisplayName_(loc) {
  if (loc.type === 'CENTRALA') return 'Centrála';
  if (loc.type === 'LC') return [loc.code, loc.abbreviation, loc.city].filter(Boolean).join(' ');
  return String(loc.name || '').trim() || String(loc.city || '').trim() || 'Umístění';
}

/**
 * Komparátor řazení umístění: Centrála první, pak LC dle kódu, pak ostatní dle názvu.
 */
function locationSortFn_(a, b) {
  if (a.type === 'CENTRALA') return -1;
  if (b.type === 'CENTRALA') return  1;
  if (a.type !== b.type) return a.type === 'LC' ? -1 : 1;
  if (a.type === 'LC') return parseInt(a.code, 10) - parseInt(b.code, 10);
  return String(a.displayName || '').localeCompare(String(b.displayName || ''), 'cs');
}

// ===========================================================================
// ÚSEKY (DEPARTMENTS)
// ===========================================================================

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

function getDepartmentsData() {
  const context = requirePermission_('users.manage');
  return buildDepartmentsData_(context);
}

/**
 * Uloží úsek (vytvoří nebo aktualizuje dle přítomnosti payload.id).
 * @param {Object} payload
 * @returns {Object}
 */
function saveDepartment(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data      = payload || {};
  const id        = String(data.id          || '').trim();
  const name      = String(data.name        || '').trim();
  const locationIds = String(data.locationIds || '').trim();
  const active    = data.active === true || data.active === 'true';
  if (!name) throw new Error('Vyplňte název úseku.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now    = new Date();
    const sheet  = spreadsheet.getSheetByName('DEPARTMENTS');
    const values = sheet.getDataRange().getValues();
    const headers   = values[0];
    const idIndex   = headers.indexOf('id');
    const nameIndex = headers.indexOf('name');
    let targetRow = -1;

    for (let row = 1; row < values.length; row++) {
      if (id && String(values[row][idIndex] || '') === id) {
        targetRow = row + 1;
      } else if (String(values[row][nameIndex] || '').trim().toLowerCase() === name.toLowerCase()) {
        throw new Error('Úsek s tímto názvem již existuje.');
      }
    }

    const map = { id: id || Utilities.getUuid(), name, locationIds, active, updatedAt: now };
    if (!id) map.createdAt = now;
    const rowValues = headers.map(function(h) {
      if (map[h] !== undefined) return map[h];
      return targetRow > 0 ? values[targetRow - 1][headers.indexOf(h)] : '';
    });

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[DEPT_UPDATE] by=%s id=%s name=%s', context.user.email, id, name);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[DEPT_CREATE] by=%s name=%s', context.user.email, name);
    }
  } finally {
    lock.releaseLock();
  }

  return buildDepartmentsData_(context);
}

/**
 * Smaže úsek. Nelze smazat úsek přiřazený aktivním uživatelům.
 * @param {string} departmentId
 * @returns {Object}
 */
function deleteDepartment(departmentId) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalized  = String(departmentId || '').trim();
  if (!normalized) throw new Error('Chybí ID úseku.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet    = spreadsheet.getSheetByName('DEPARTMENTS');
    const values   = sheet.getDataRange().getValues();
    const headers  = values[0];
    const idIndex  = headers.indexOf('id');
    const nameIndex = headers.indexOf('name');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') !== normalized) continue;

      const deptName  = String(values[row][nameIndex] || '');
      const usersUsing = getObjects_(spreadsheet.getSheetByName('USERS')).filter(function(u) {
        return String(u.department || '').trim() === deptName && isTruthy_(u.active);
      });
      if (usersUsing.length > 0) {
        throw new Error(
          'Úsek nelze smazat — je přiřazen ' + usersUsing.length +
          (usersUsing.length === 1 ? ' uživateli.' : ' uživatelům.'),
        );
      }

      sheet.deleteRow(row + 1);
      Logger.log('[DEPT_DELETE] by=%s id=%s name=%s', context.user.email, normalized, deptName);
      return buildDepartmentsData_(context);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Úsek nebyl nalezen.');
}

// ---------------------------------------------------------------------------
// Sestavení dat pro UI a čtení z databáze
// ---------------------------------------------------------------------------

/**
 * Sestaví datový objekt pro administraci úseků.
 * @param {Object} context
 * @returns {Object}
 */
function buildDepartmentsData_(context) {
  return {
    auth:        context.auth,
    departments: listDepartmentsFull_(context.database.spreadsheet),
  };
}

/**
 * Vrátí aktivní úseky seřazené dle názvu (pro výběrové seznamy v UI).
 * @param {Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function listDepartments_(spreadsheet) {
  return listDepartmentsFull_(spreadsheet).filter(function(d) { return d.active; });
}

/**
 * Vrátí všechny úseky (aktivní i neaktivní) se všemi poli včetně auditních.
 * @param {Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function listDepartmentsFull_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('DEPARTMENTS'))
    .map(function(d) {
      return {
        id:          d.id,
        name:        String(d.name || ''),
        locationIds: String(d.locationIds || '').split(',').filter(Boolean),
        active:      isTruthy_(d.active),
        createdAt:   formatDateValue_(d.createdAt),
        updatedAt:   formatDateValue_(d.updatedAt),
      };
    })
    .sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'cs'); });
}
