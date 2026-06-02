/**
 * OZ Dashboard — Autentizace a autorizace
 *
 * Řeší identitu přihlášeného uživatele, ověření oprávnění a sestavení
 * auth kontextu předávaného každým API handlerem.
 */

// ---------------------------------------------------------------------------
// Kontext přihlášeného uživatele
// ---------------------------------------------------------------------------

/**
 * Sestaví a vrátí kontext přihlášeného uživatele: databáze, identita, role, oprávnění.
 * Volá se na začátku každého API requestu.
 *
 * @returns {{ database: Object, user: Object, auth: Object }}
 */
function getCurrentUserContext_() {
  const database = ensureDatabase_();
  const email = getSignedInUser_();
  const user = findUserByEmail_(database.spreadsheet, email);

  if (!user || !isTruthy_(user.active)) {
    return {
      database,
      user: {
        email,
        id:        user ? user.id        : '',
        firstName: user ? user.firstName : '',
        lastName:  user ? user.lastName  : '',
      },
      auth: {
        hasAccess:  false,
        reason:     'Účet není uveden v seznamu aktivních uživatelů aplikace.',
        systemRole: user ? user.systemRole : '',
        accessRole: user ? user.accessRole : '',
        permissions: [],
        subApps:     {},
      },
    };
  }

  Logger.log('[ACCESS] %s role=%s/%s', email, user.systemRole, user.accessRole);

  return {
    database,
    user: {
      email:        user.email,
      id:           user.id,
      firstName:    user.firstName,
      lastName:     user.lastName,
      lastVisitAt:  formatDateValue_(user.lastVisitAt),
      locationType: user.locationType,
      locationName: user.locationName,
      department:   user.department,
    },
    auth: {
      hasAccess:   true,
      reason:      '',
      systemRole:  user.systemRole,
      accessRole:  user.accessRole,
      permissions: getRolePermissions_(database.spreadsheet, user.accessRole),
      subApps:     getUserSubAppAccess_(database.spreadsheet, user),
    },
  };
}

// ---------------------------------------------------------------------------
// Kontrola oprávnění
// ---------------------------------------------------------------------------

/**
 * Ověří, zda má přihlášený uživatel dané oprávnění. Při nedostatku práv vyhodí chybu.
 *
 * @param {string} permission - klíč oprávnění, např. 'users.manage'
 * @returns {{ database: Object, user: Object, auth: Object }} kontext přihlášeného uživatele
 * @throws {Error} pokud uživatel nemá přístup nebo oprávnění
 */
function requirePermission_(permission) {
  const context = getCurrentUserContext_();
  if (!context.auth.hasAccess || !hasPermission_(context.auth, permission)) {
    throw new Error('K této akci nemáte oprávnění.');
  }
  return context;
}

/**
 * Zkontroluje, zda auth objekt obsahuje dané oprávnění (nebo wildcard '*').
 *
 * @param {Object} auth - auth objekt z getCurrentUserContext_()
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission_(auth, permission) {
  const permissions = auth && auth.permissions ? auth.permissions : [];
  return permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0;
}

// ---------------------------------------------------------------------------
// Načítání oprávnění z databáze
// ---------------------------------------------------------------------------

/**
 * Vrátí seznam klíčů oprávnění přiřazených dané roli přístupu (allowed = true).
 * @param {Spreadsheet} spreadsheet
 * @param {string} accessRole - klíč role přístupu (např. 'ADMIN')
 * @returns {string[]}
 */
function getRolePermissions_(spreadsheet, accessRole) {
  const rows = getObjects_(spreadsheet.getSheetByName('ROLE_PERMISSIONS'));
  const role = String(accessRole || '').trim().toUpperCase();
  return rows
    .filter(function(row) {
      return String(row.roleKey || '').trim().toUpperCase() === role && isTruthy_(row.allowed);
    })
    .map(function(row) { return row.permissionKey; });
}

/**
 * Vrátí mapu { KEY_DLAZDICE → accessLevel } pro daného uživatele.
 * Shoda se hledá podle userId nebo e-mailu (pro zpětnou kompatibilitu).
 * @param {Spreadsheet} spreadsheet
 * @param {Object} user - objekt uživatele z USERS listu
 * @returns {Object} { 'KLÍČ': 'READ'|'WRITE'|'ADMIN', ... }
 */
function getUserSubAppAccess_(spreadsheet, user) {
  const rows = getObjects_(spreadsheet.getSheetByName('SUBAPP_PERMISSIONS'));
  const byUser = rows.filter(function(row) {
    const sameId    = row.userId && String(row.userId) === String(user.id);
    const sameEmail = String(row.email  || '').trim().toLowerCase()
                   === String(user.email || '').trim().toLowerCase();
    return (sameId || sameEmail) && isTruthy_(row.active);
  });

  return byUser.reduce(function(result, row) {
    const key = String(row.subAppKey || '').trim().toUpperCase();
    if (key) result[key] = row.accessLevel;
    return result;
  }, {});
}

// ---------------------------------------------------------------------------
// Identita
// ---------------------------------------------------------------------------

/**
 * Vrátí e-mail aktuálně přihlášeného uživatele.
 * Vyhodí descriptivní chybu, pokud GAS není nakonfigurován správně.
 *
 * POZOR: getEffectiveUser() vrací vlastníka skriptu, nikoli návštěvníka.
 * Správné nastavení nasazení: "Execute as: User accessing the web app".
 *
 * @returns {string} e-mail uživatele
 * @throws {Error} pokud nelze identitu zjistit
 */
function getSignedInUser_() {
  const email = Session.getActiveUser().getEmail();
  if (email) return email;
  throw new Error(
    'Nepodařilo se zjistit identitu přihlášeného uživatele. ' +
    'Zkontrolujte nastavení nasazení: "Execute as" musí být "User accessing the web app".',
  );
}
