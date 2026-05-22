/**
 * OZ Dashboard — Správa uživatelů
 *
 * CRUD operace pro list USERS, normalizace a validace payloadu,
 * ochrana posledního superadmina.
 */

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

function getUsersAdminData() {
  const context = requirePermission_('users.manage');
  return buildUsersAdminData_(context);
}

/**
 * Uloží uživatele (vytvoří nebo aktualizuje dle přítomnosti payload.id).
 * Vrátí aktuální stav administrace uživatelů.
 * @param {Object} payload
 * @returns {Object}
 */
function saveUser(payload) {
  const context = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data = normalizeUserPayload_(payload);
  validateUserPayload_(data, spreadsheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet  = spreadsheet.getSheetByName('USERS');
    const values = sheet.getDataRange().getValues();
    const headers    = values[0];
    const idIndex    = headers.indexOf('id');
    const emailIndex = headers.indexOf('email');
    const now = new Date();

    let targetRow = -1;
    let original  = null;

    for (let row = 1; row < values.length; row++) {
      const rowId    = String(values[row][idIndex]    || '');
      const rowEmail = String(values[row][emailIndex] || '').trim().toLowerCase();
      if (data.id && rowId === data.id) {
        targetRow = row + 1;
        original  = rowToObject_(headers, values[row]);
      } else if (rowEmail === data.email) {
        throw new Error('Uživatel s tímto e-mailem již existuje.');
      }
    }

    if (data.id && targetRow < 0) throw new Error('Uživatel nebyl nalezen.');
    if (original) assertLastSuperadminIsProtected_(spreadsheet, original, data);

    const rowValues = buildUserRow_(headers, data, original, now);
    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[USER_UPDATE] by=%s target=%s', context.user.email, data.email);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[USER_CREATE] by=%s target=%s role=%s', context.user.email, data.email, data.accessRole);
    }
  } finally {
    lock.releaseLock();
  }

  return buildUsersAdminData_(context);
}

/**
 * Smaže uživatele dle ID. Nelze smazat sami sebe ani posledního superadmina.
 * @param {string} userId
 * @returns {Object}
 */
function deleteUser(userId) {
  const context      = requirePermission_('users.manage');
  const spreadsheet  = context.database.spreadsheet;
  const normalizedId = String(userId || '').trim();

  if (!normalizedId)                      throw new Error('Chybí ID uživatele.');
  if (normalizedId === context.user.id)   throw new Error('Nemůžete smazat sami sebe.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet   = spreadsheet.getSheetByName('USERS');
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') !== normalizedId) continue;
      const target = rowToObject_(headers, values[row]);
      assertLastSuperadminIsProtected_(spreadsheet, target, { active: false, accessRole: '', systemRole: '' });
      sheet.deleteRow(row + 1);
      Logger.log('[USER_DELETE] by=%s target=%s', context.user.email, target.email || normalizedId);
      return buildUsersAdminData_(context);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Uživatel nebyl nalezen.');
}

// ---------------------------------------------------------------------------
// Sestavení dat pro UI
// ---------------------------------------------------------------------------

/**
 * Sestaví kompletní datový objekt pro administraci uživatelů.
 * @param {Object} context - výstup z getCurrentUserContext_() nebo requirePermission_()
 * @returns {Object}
 */
function buildUsersAdminData_(context) {
  const spreadsheet = context.database.spreadsheet;
  return {
    auth:        context.auth,
    currentUserId: context.user.id,
    users:       listUsers_(spreadsheet),
    roles:       listRoles_(spreadsheet),
    systemRoles: [
      { value: 'SUPERADMIN', label: 'Superadmin' },
      { value: 'ADMIN',      label: 'Admin' },
      { value: 'USER',       label: 'Uživatel' },
    ],
    locations:   listLocations_(spreadsheet),
    departments: listDepartments_(spreadsheet),
    subApps:     listSubApps_(spreadsheet),
  };
}

// ---------------------------------------------------------------------------
// Čtení z databáze
// ---------------------------------------------------------------------------

/**
 * Vrátí seřazený seznam všech uživatelů pro UI.
 * @param {Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function listUsers_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('USERS'))
    .map(function(user) {
      return {
        id:          user.id,
        email:       user.email,
        firstName:   user.firstName,
        lastName:    user.lastName,
        fullName:    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        lastVisitAt: formatDateValue_(user.lastVisitAt),
        locationType: user.locationType,
        locationName: user.locationName,
        department:  user.department,
        systemRole:  user.systemRole,
        accessRole:  user.accessRole,
        active:      isTruthy_(user.active),
        createdAt:   formatDateValue_(user.createdAt),
        updatedAt:   formatDateValue_(user.updatedAt),
      };
    })
    .sort(function(a, b) { return String(a.fullName).localeCompare(String(b.fullName), 'cs'); });
}

/**
 * Nalezne uživatele podle e-mailu (case-insensitive).
 * @param {Spreadsheet} spreadsheet
 * @param {string} email
 * @returns {Object|null}
 */
function findUserByEmail_(spreadsheet, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return getObjects_(spreadsheet.getSheetByName('USERS')).find(function(row) {
    return String(row.email || '').trim().toLowerCase() === normalized;
  }) || null;
}

/**
 * Aktualizuje datum poslední návštěvy uživatele (neblokující — voláno v try/catch).
 * @param {Spreadsheet} spreadsheet
 * @param {string} userId
 */
function updateUserLastVisit_(spreadsheet, userId) {
  const sheet   = spreadsheet.getSheetByName('USERS');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex        = headers.indexOf('id');
  const lastVisitIndex = headers.indexOf('lastVisitAt');
  const updatedAtIndex = headers.indexOf('updatedAt');

  for (let row = 1; row < values.length; row++) {
    if (String(values[row][idIndex] || '') !== String(userId || '')) continue;
    const now     = new Date();
    const rowData = values[row].slice();
    rowData[lastVisitIndex] = now;
    rowData[updatedAtIndex] = now;
    sheet.getRange(row + 1, 1, 1, headers.length).setValues([rowData]);
    return;
  }
}

/**
 * Aktualizuje poslední návštěvu nejvýše jednou za 6 hodin na uživatele.
 * @param {Spreadsheet} spreadsheet
 * @param {string} userId
 */
function updateUserLastVisitThrottled_(spreadsheet, userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) return;

  const cache = CacheService.getScriptCache();
  const key = 'LAST_VISIT_UPDATED_' + normalized;
  if (cache.get(key)) return;

  updateUserLastVisit_(spreadsheet, normalized);
  cache.put(key, '1', 21600);
}

// ---------------------------------------------------------------------------
// Normalizace a validace payloadu
// ---------------------------------------------------------------------------

/**
 * Normalizuje surový payload z UI na standardizovaný datový objekt.
 * @param {Object} payload
 * @returns {Object}
 */
function normalizeUserPayload_(payload) {
  const data = payload || {};
  return {
    id:           String(data.id          || '').trim(),
    email:        String(data.email       || '').trim().toLowerCase(),
    firstName:    String(data.firstName   || '').trim(),
    lastName:     String(data.lastName    || '').trim(),
    locationType: String(data.locationType || 'CENTRALA').trim().toUpperCase(),
    locationName: String(data.locationName || '').trim(),
    department:   String(data.department  || '').trim(),
    systemRole:   String(data.systemRole  || 'USER').trim().toUpperCase(),
    accessRole:   String(data.accessRole  || 'VIEWER').trim().toUpperCase(),
    active: data.active === true || data.active === 'true' || data.active === '1',
  };
}

/**
 * Validuje normalizovaný payload — vyhodí Error při první chybě.
 * @param {Object} data - výstup normalizeUserPayload_()
 * @param {Spreadsheet} spreadsheet
 * @throws {Error}
 */
function validateUserPayload_(data, spreadsheet) {
  if (!data.email || data.email.indexOf('@') < 1) throw new Error('Vyplňte platný e-mail uživatele.');
  if (!data.firstName)    throw new Error('Vyplňte jméno uživatele.');
  if (!data.lastName)     throw new Error('Vyplňte příjmení uživatele.');
  if (!data.locationName) throw new Error('Vyplňte místo zařazení.');
  if (!data.department)   throw new Error('Vyplňte úsek.');

  const validSystemRoles = ['SUPERADMIN', 'ADMIN', 'USER'];
  if (validSystemRoles.indexOf(data.systemRole) < 0) {
    throw new Error('Vybraná systémová role neexistuje.');
  }

  const roleKeys = listRoles_(spreadsheet).map(function(role) { return role.value; });
  if (roleKeys.indexOf(data.accessRole) < 0) {
    throw new Error('Vybraná role přístupu neexistuje.');
  }
}

// ---------------------------------------------------------------------------
// Sestavení řádku pro spreadsheet
// ---------------------------------------------------------------------------

/**
 * Sestaví pole hodnot pro jeden řádek USERS listu (insert nebo update).
 * @param {string[]} headers
 * @param {Object} data - normalizovaný payload
 * @param {Object|null} original - stávající řádek (null při vytváření)
 * @param {Date} now
 * @returns {Array}
 */
function buildUserRow_(headers, data, original, now) {
  const source = original || {};
  const values = {
    id:          data.id || Utilities.getUuid(),
    email:       data.email,
    firstName:   data.firstName,
    lastName:    data.lastName,
    lastVisitAt: source.lastVisitAt || '',
    locationType: data.locationType,
    locationName: data.locationName,
    department:  data.department,
    systemRole:  data.systemRole,
    accessRole:  data.accessRole,
    active:      data.active,
    createdAt:   source.createdAt || now,
    updatedAt:   now,
  };
  return headers.map(function(header) {
    return values[header] !== undefined ? values[header] : '';
  });
}

// ---------------------------------------------------------------------------
// Ochrana superadmina
// ---------------------------------------------------------------------------

/**
 * Vyhodí chybu, pokud by operace odebrala posledního aktivního superadmina.
 * @param {Spreadsheet} spreadsheet
 * @param {Object} original - stávající stav uživatele
 * @param {Object} nextData - nový stav uživatele
 * @throws {Error}
 */
function assertLastSuperadminIsProtected_(spreadsheet, original, nextData) {
  const wasActive = isTruthy_(original.active)
    && (String(original.accessRole || '').toUpperCase() === 'SUPERADMIN'
     || String(original.systemRole || '').toUpperCase() === 'SUPERADMIN');

  const willStayActive = nextData.active === true
    && (String(nextData.accessRole || '').toUpperCase() === 'SUPERADMIN'
     || String(nextData.systemRole || '').toUpperCase() === 'SUPERADMIN');

  if (!wasActive || willStayActive) return;

  if (countActiveSuperadmins_(spreadsheet) <= 1) {
    throw new Error('Nelze odebrat posledního aktivního superadmina.');
  }
}

/**
 * Spočítá počet aktivních superadminů (system nebo access role = SUPERADMIN).
 * @param {Spreadsheet} spreadsheet
 * @returns {number}
 */
function countActiveSuperadmins_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('USERS')).filter(function(user) {
    return isTruthy_(user.active)
      && (String(user.accessRole || '').toUpperCase() === 'SUPERADMIN'
       || String(user.systemRole || '').toUpperCase() === 'SUPERADMIN');
  }).length;
}
