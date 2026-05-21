/**
 * OZ Dashboard — Správa rolí a oprávnění rolí
 *
 * CRUD operace pro listy ROLES a ROLE_PERMISSIONS.
 * Systémové role (SUPERADMIN, ADMIN, EDITOR, VIEWER) nelze smazat.
 * Wildcard oprávnění '*' nelze přiřadit přes UI.
 */

/**
 * Whitelist platných oprávnění přiřaditelných přes UI.
 * Wildcard '*' je záměrně vynechán — přiřazuje se pouze přes seed dat (SUPERADMIN).
 */
const KNOWN_PERMISSIONS = ['dashboard.view', 'branches.view', 'branches.sync', 'users.manage', 'roles.manage'];

/** Role, které nelze smazat (jsou součástí pevné struktury aplikace). */
const SYSTEM_ROLE_KEYS = ['SUPERADMIN', 'ADMIN', 'EDITOR', 'VIEWER'];

// ---------------------------------------------------------------------------
// Veřejné API endpointy
// ---------------------------------------------------------------------------

function getRolesAdminData() {
  const context = requirePermission_('users.manage');
  return buildRolesAdminData_(context);
}

/**
 * Uloží roli (vytvoří nebo aktualizuje dle přítomnosti roleKey v databázi).
 * @param {Object} payload
 * @returns {Object}
 */
function saveRole(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data        = payload || {};
  const roleKey     = String(data.roleKey    || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const roleName    = String(data.roleName   || '').trim();
  const description = String(data.description || '').trim();
  const active      = data.active === true || data.active === 'true' || data.active === '1';

  if (!roleKey)   throw new Error('Vyplňte klíč role.');
  if (!roleName)  throw new Error('Vyplňte název role.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet      = spreadsheet.getSheetByName('ROLES');
    const values     = sheet.getDataRange().getValues();
    const headers    = values[0];
    const roleKeyIdx = headers.indexOf('roleKey');
    const now        = new Date();
    let targetRow    = -1;

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][roleKeyIdx] || '').trim().toUpperCase() === roleKey) {
        targetRow = row + 1;
        break;
      }
    }

    const map = { roleKey, roleName, description, active, updatedAt: now };
    if (targetRow <= 0) map.createdAt = now;
    const rowValues = headers.map(function(h) {
      if (map[h] !== undefined) return map[h];
      return targetRow > 0 && values[targetRow - 1] ? values[targetRow - 1][headers.indexOf(h)] : '';
    });

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log('[ROLE_UPDATE] by=%s key=%s', context.user.email, roleKey);
    } else {
      sheet.appendRow(rowValues);
      Logger.log('[ROLE_CREATE] by=%s key=%s', context.user.email, roleKey);
    }
  } finally {
    lock.releaseLock();
  }

  return buildRolesAdminData_(context);
}

/**
 * Smaže roli a všechna její ROLE_PERMISSIONS.
 * Systémové role a role přiřazené aktivním uživatelům nelze smazat.
 * @param {string} roleKey
 * @returns {Object}
 */
function deleteRole(roleKey) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalized  = String(roleKey || '').trim().toUpperCase();
  if (!normalized) throw new Error('Chybí klíč role.');

  if (SYSTEM_ROLE_KEYS.indexOf(normalized) >= 0) throw new Error('Systémové role nelze smazat.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Kontrola uživatelů UVNITŘ locku — zabraňuje race condition
    const usersUsing = getObjects_(spreadsheet.getSheetByName('USERS')).filter(function(u) {
      return String(u.accessRole || '').trim().toUpperCase() === normalized && isTruthy_(u.active);
    });
    if (usersUsing.length > 0) {
      throw new Error(
        'Roli nelze smazat — je přiřazena ' + usersUsing.length +
        (usersUsing.length === 1 ? ' uživateli.' : ' uživatelům.'),
      );
    }

    const sheet      = spreadsheet.getSheetByName('ROLES');
    const values     = sheet.getDataRange().getValues();
    const headers    = values[0];
    const roleKeyIdx = headers.indexOf('roleKey');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][roleKeyIdx] || '').trim().toUpperCase() !== normalized) continue;

      sheet.deleteRow(row + 1);

      // Kaskádové smazání oprávnění role
      const permSheet  = spreadsheet.getSheetByName('ROLE_PERMISSIONS');
      const permValues = permSheet.getDataRange().getValues();
      const permKeyIdx = permValues[0].indexOf('roleKey');
      for (let pr = permValues.length - 1; pr >= 1; pr--) {
        if (String(permValues[pr][permKeyIdx] || '').trim().toUpperCase() === normalized) {
          permSheet.deleteRow(pr + 1);
        }
      }

      Logger.log('[ROLE_DELETE] by=%s key=%s', context.user.email, normalized);
      return buildRolesAdminData_(context);
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Role nebyla nalezena.');
}

/**
 * Přidá oprávnění roli. Wildcard a neznámá oprávnění jsou blokována server-side.
 * @param {Object} payload - { roleKey, permissionKey }
 * @returns {Object}
 */
function saveRolePermission(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data        = payload || {};
  const roleKey     = String(data.roleKey      || '').trim().toUpperCase();
  const permKey     = String(data.permissionKey || '').trim();

  if (!roleKey) throw new Error('Chybí klíč role.');
  if (!permKey) throw new Error('Chybí klíč oprávnění.');

  // Bezpečnostní validace — blokujeme wildcard a neznámá oprávnění
  if (permKey === '*') {
    throw new Error('Oprávnění * (wildcard) nelze přiřadit přes rozhraní aplikace.');
  }
  if (KNOWN_PERMISSIONS.indexOf(permKey) < 0) {
    throw new Error(
      'Neznámé oprávnění: ' + permKey + '. ' +
      'Povolená oprávnění: ' + KNOWN_PERMISSIONS.join(', ') + '.',
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet      = spreadsheet.getSheetByName('ROLE_PERMISSIONS');
    const values     = sheet.getDataRange().getValues();
    const headers    = values[0];
    const roleKeyIdx = headers.indexOf('roleKey');
    const permKeyIdx = headers.indexOf('permissionKey');
    const now        = new Date();

    // Kontrola duplicity
    for (let row = 1; row < values.length; row++) {
      const rowRole = String(values[row][roleKeyIdx] || '').trim().toUpperCase();
      const rowPerm = String(values[row][permKeyIdx] || '').trim();
      if (rowRole === roleKey && rowPerm === permKey) {
        Logger.log('[ROLE_PERM_SKIP] by=%s role=%s perm=%s already_exists', context.user.email, roleKey, permKey);
        return buildRolesAdminData_(context);
      }
    }

    const rowValues = headers.map(function(h) {
      const map = { roleKey, permissionKey: permKey, allowed: true, description: 'Přidáno přes UI', updatedAt: now };
      return map[h] !== undefined ? map[h] : '';
    });
    sheet.appendRow(rowValues);
    Logger.log('[ROLE_PERM_ADD] by=%s role=%s perm=%s', context.user.email, roleKey, permKey);
  } finally {
    lock.releaseLock();
  }

  return buildRolesAdminData_(context);
}

/**
 * Odebere oprávnění roli.
 * @param {Object} payload - { roleKey, permissionKey }
 * @returns {Object}
 */
function deleteRolePermission(payload) {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data        = payload || {};
  const roleKey     = String(data.roleKey      || '').trim().toUpperCase();
  const permKey     = String(data.permissionKey || '').trim();

  if (!roleKey || !permKey) throw new Error('Chybí klíč role nebo oprávnění.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet      = spreadsheet.getSheetByName('ROLE_PERMISSIONS');
    const values     = sheet.getDataRange().getValues();
    const headers    = values[0];
    const roleKeyIdx = headers.indexOf('roleKey');
    const permKeyIdx = headers.indexOf('permissionKey');

    // Iterujeme od konce, aby deleteRow neposouval indexy
    for (let row = values.length - 1; row >= 1; row--) {
      const rowRole = String(values[row][roleKeyIdx] || '').trim().toUpperCase();
      const rowPerm = String(values[row][permKeyIdx] || '').trim();
      if (rowRole === roleKey && rowPerm === permKey) {
        sheet.deleteRow(row + 1);
        Logger.log('[ROLE_PERM_REMOVE] by=%s role=%s perm=%s', context.user.email, roleKey, permKey);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }

  return buildRolesAdminData_(context);
}

// ---------------------------------------------------------------------------
// Čtení z databáze
// ---------------------------------------------------------------------------

/**
 * Sestaví datový objekt pro administraci rolí.
 * @param {Object} context
 * @returns {Object}
 */
function buildRolesAdminData_(context) {
  const spreadsheet = context.database.spreadsheet;

  const roles = getObjects_(spreadsheet.getSheetByName('ROLES'))
    .map(function(r) {
      return {
        roleKey:     String(r.roleKey     || ''),
        roleName:    String(r.roleName    || ''),
        description: String(r.description || ''),
        active:      isTruthy_(r.active),
        createdAt:   formatDateValue_(r.createdAt),
        updatedAt:   formatDateValue_(r.updatedAt),
      };
    })
    .sort(function(a, b) { return String(a.roleKey).localeCompare(String(b.roleKey), 'cs'); });

  // Skupinování oprávnění dle role: { ADMIN: ['dashboard.view', ...], ... }
  const permsByRole = getObjects_(spreadsheet.getSheetByName('ROLE_PERMISSIONS'))
    .reduce(function(acc, row) {
      const key = String(row.roleKey || '').trim().toUpperCase();
      if (!acc[key]) acc[key] = [];
      if (isTruthy_(row.allowed)) acc[key].push(String(row.permissionKey || ''));
      return acc;
    }, {});

  return {
    auth:             context.auth,
    roles:            roles,
    permsByRole:      permsByRole,
    knownPermissions: KNOWN_PERMISSIONS,
  };
}

/**
 * Vrátí seznam aktivních rolí pro výběrové seznamy v UI.
 * @param {Spreadsheet} spreadsheet
 * @returns {{ value: string, label: string }[]}
 */
function listRoles_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('ROLES'))
    .filter(function(role) { return isTruthy_(role.active); })
    .map(function(role) {
      return { value: role.roleKey, label: role.roleName || role.roleKey };
    });
}
