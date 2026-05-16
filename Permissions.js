/**
 * OZ Dashboard — Správa přístupů k dlaždicím (SubApp Permissions)
 *
 * CRUD operace pro list SUBAPP_PERMISSIONS.
 * Každý záznam přiřazuje konkrétnímu uživateli přístup k dané dlaždici
 * s definovanou úrovní přístupu (READ / WRITE / ADMIN).
 */

/** Platné úrovně přístupu k dlaždici. */
var ACCESS_LEVELS = ['READ', 'WRITE', 'ADMIN'];

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

/**
 * Vrátí oprávnění pro danou dlaždici (nebo všechna, pokud subAppKey není zadán).
 * @param {string} subAppKey
 * @returns {Object}
 */
function getSubAppPermissionsData(subAppKey) {
  const context = requirePermission_('users.manage');
  return buildPermissionsData_(context, subAppKey);
}

/**
 * Uloží oprávnění přístupu k dlaždici (vytvoří nebo aktualizuje).
 * Před zápisem ověří existenci uživatele i dlaždice.
 * @param {Object} payload
 * @returns {Object}
 */
function saveSubAppPermission(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data        = payload || {};
  const id          = String(data.id        || '').trim();
  const userId      = String(data.userId    || '').trim();
  const email       = String(data.email     || '').trim().toLowerCase();
  const subAppKey   = String(data.subAppKey || '').trim().toUpperCase();
  let   accessLevel = String(data.accessLevel || 'READ').trim().toUpperCase();
  const active      = data.active === true || data.active === 'true' || data.active === '1';

  if (!userId && !email) throw new Error('Vyberte uživatele.');
  if (!subAppKey)        throw new Error('Vyberte dlaždici.');
  if (ACCESS_LEVELS.indexOf(accessLevel) < 0) accessLevel = 'READ';

  // Validace existence entit (před zámkem — vyhneme se blokování při chybě)
  const userExists = getObjects_(spreadsheet.getSheetByName('USERS')).some(function(u) {
    return (userId && String(u.id || '') === userId) ||
           (email  && String(u.email || '').trim().toLowerCase() === email);
  });
  if (!userExists) throw new Error('Vybraný uživatel neexistuje v databázi.');

  const subAppExists = getObjects_(spreadsheet.getSheetByName('SUBAPPS')).some(function(s) {
    return String(s.key || '').trim().toUpperCase() === subAppKey && isTruthy_(s.active);
  });
  if (!subAppExists) throw new Error('Vybraná dlaždice neexistuje nebo není aktivní.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet      = spreadsheet.getSheetByName('SUBAPP_PERMISSIONS');
    const values     = sheet.getDataRange().getValues();
    const headers    = values[0];
    const idIdx      = headers.indexOf('id');
    const userIdIdx  = headers.indexOf('userId');
    const emailIdx   = headers.indexOf('email');
    const keyIdx     = headers.indexOf('subAppKey');
    let   targetRow  = -1;
    const now        = new Date();

    // Hledáme existující záznam (dle id, nebo dle kombinace user+dlaždice)
    for (let row = 1; row < values.length; row++) {
      const rowId     = String(values[row][idIdx]     || '');
      const rowUserId = String(values[row][userIdIdx]  || '');
      const rowEmail  = String(values[row][emailIdx]   || '').trim().toLowerCase();
      const rowKey    = String(values[row][keyIdx]     || '').trim().toUpperCase();

      const matchById   = id && rowId === id;
      const matchByUser = !id && ((userId && rowUserId === userId) || (email && rowEmail === email)) && rowKey === subAppKey;
      if (matchById || matchByUser) { targetRow = row + 1; break; }
    }

    const finalId   = id || Utilities.getUuid();
    const map       = { id: finalId, userId, email, subAppKey, accessLevel, active, updatedAt: now, updatedBy: context.user.email };
    const rowValues = headers.map(function(h) {
      if (map[h] !== undefined) return map[h];
      return targetRow > 0 ? values[targetRow - 1][headers.indexOf(h)] : '';
    });

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[PERM_UPDATE] by=%s user=%s subApp=%s level=%s active=%s', context.user.email, email, subAppKey, accessLevel, active);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[PERM_CREATE] by=%s user=%s subApp=%s level=%s', context.user.email, email, subAppKey, accessLevel);
    }
  } finally {
    lock.releaseLock();
  }

  return buildPermissionsData_(context, subAppKey);
}

/**
 * Smaže záznam oprávnění dle ID.
 * @param {string} permId
 * @returns {Object}
 */
function deleteSubAppPermission(permId) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalized  = String(permId || '').trim();
  if (!normalized) throw new Error('Chybí ID záznamu oprávnění.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet   = spreadsheet.getSheetByName('SUBAPP_PERMISSIONS');
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIdx   = headers.indexOf('id');
    const keyIdx  = headers.indexOf('subAppKey');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIdx] || '') !== normalized) continue;
      const deletedKey = String(values[row][keyIdx] || '').trim().toUpperCase();
      sheet.deleteRow(row + 1);
      Logger.log('[PERM_DELETE] by=%s id=%s subApp=%s', context.user.email, normalized, deletedKey);
      return buildPermissionsData_(context, deletedKey);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Záznam oprávnění nebyl nalezen.');
}

// ---------------------------------------------------------------------------
// Sestavení dat pro UI
// ---------------------------------------------------------------------------

/**
 * Sestaví datový objekt pro modal správy přístupů k dlaždici.
 * @param {Object} context
 * @param {string} subAppKey - klíč dlaždice (prázdný = vše)
 * @returns {Object}
 */
function buildPermissionsData_(context, subAppKey) {
  const spreadsheet = context.database.spreadsheet;
  const key         = String(subAppKey || '').trim().toUpperCase();

  const permissions = getObjects_(spreadsheet.getSheetByName('SUBAPP_PERMISSIONS'))
    .filter(function(r) { return !key || String(r.subAppKey || '').trim().toUpperCase() === key; })
    .map(function(r) {
      return {
        id:          String(r.id          || ''),
        userId:      String(r.userId      || ''),
        email:       String(r.email       || ''),
        subAppKey:   String(r.subAppKey   || ''),
        accessLevel: String(r.accessLevel || 'READ'),
        active:      isTruthy_(r.active),
        updatedAt:   formatDateValue_(r.updatedAt),
        updatedBy:   String(r.updatedBy   || ''),
      };
    });

  return {
    auth:              context.auth,
    permissions:       permissions,
    users:             listUsers_(spreadsheet),
    subApps:           listSubApps_(spreadsheet),
    currentSubAppKey:  key,
  };
}
