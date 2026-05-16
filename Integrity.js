/**
 * OZ Dashboard — Audit datové integrity
 *
 * Kontroluje konzistenci dat napříč všemi listy databáze.
 * Hlásí osiřelé reference (neexistující umístění, role, uživatelé atd.).
 */

/**
 * Provede audit datové integrity a vrátí strukturovaný report.
 *
 * Kontrolované vztahy:
 *   1. USERS.locationName     → existence v LOCATIONS (aktivní)
 *   2. USERS.department       → existence v DEPARTMENTS (aktivní)
 *   3. USERS.accessRole       → existence v ROLES (aktivní)
 *   4. SUBAPP_PERMISSIONS.userId → existence v USERS
 *   5. SUBAPP_PERMISSIONS.email  → existence v USERS
 *   6. SUBAPP_PERMISSIONS.subAppKey → existence v SUBAPPS (aktivní)
 *   7. DEPARTMENTS.locationIds  → existence v LOCATIONS (aktivní)
 *
 * @returns {{ ok: boolean, checkedAt: string, issues: Object[], summary: Object }}
 */
function checkDataIntegrity() {
  const context     = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const issues      = [];
  const now         = new Date().toISOString();

  // Načteme všechna data jedním průchodem
  const users      = getObjects_(spreadsheet.getSheetByName('USERS'));
  const locations  = getObjects_(spreadsheet.getSheetByName('LOCATIONS'));
  const departments = getObjects_(spreadsheet.getSheetByName('DEPARTMENTS'));
  const roles      = getObjects_(spreadsheet.getSheetByName('ROLES'));
  const subApps    = getObjects_(spreadsheet.getSheetByName('SUBAPPS'));
  const subAppPerms = getObjects_(spreadsheet.getSheetByName('SUBAPP_PERMISSIONS'));

  // Sestavíme sady platných hodnot pro rychlé vyhledávání (O(1))
  const validLocationNames = new Set(
    locations
      .filter(function(l) { return isTruthy_(l.active); })
      .map(function(l) {
        return l.type === 'CENTRALA'
          ? 'Centrála'
          : [l.code, l.abbreviation, l.city].filter(Boolean).join(' ');
      }),
  );
  const validLocationIds = new Set(
    locations.filter(function(l) { return isTruthy_(l.active); }).map(function(l) { return String(l.id || ''); }),
  );
  const validDeptNames = new Set(
    departments.filter(function(d) { return isTruthy_(d.active); }).map(function(d) { return String(d.name || ''); }),
  );
  const validRoleKeys = new Set(
    roles.filter(function(r) { return isTruthy_(r.active); }).map(function(r) { return String(r.roleKey || '').toUpperCase(); }),
  );
  const validUserIds    = new Set(users.map(function(u) { return String(u.id    || ''); }));
  const validUserEmails = new Set(users.map(function(u) { return String(u.email || '').toLowerCase(); }));
  const validSubAppKeys = new Set(
    subApps.filter(function(s) { return isTruthy_(s.active); }).map(function(s) { return String(s.key || '').toUpperCase(); }),
  );

  // --- 1–3: Kontrola USERS (pouze aktivní) ---
  users.forEach(function(user) {
    if (!isTruthy_(user.active)) return;

    const loc = String(user.locationName || '').trim();
    if (loc && !validLocationNames.has(loc)) {
      issues.push({ sheet: 'USERS', id: user.id, email: user.email, field: 'locationName',
        value: loc, reason: 'Umístění neexistuje nebo není aktivní' });
    }

    const dept = String(user.department || '').trim();
    if (dept && !validDeptNames.has(dept)) {
      issues.push({ sheet: 'USERS', id: user.id, email: user.email, field: 'department',
        value: dept, reason: 'Úsek neexistuje nebo není aktivní' });
    }

    const role = String(user.accessRole || '').toUpperCase();
    if (role && !validRoleKeys.has(role)) {
      issues.push({ sheet: 'USERS', id: user.id, email: user.email, field: 'accessRole',
        value: role, reason: 'Role přístupu neexistuje nebo není aktivní' });
    }
  });

  // --- 4–6: Kontrola SUBAPP_PERMISSIONS ---
  subAppPerms.forEach(function(perm) {
    const uid  = String(perm.userId   || '').trim();
    const mail = String(perm.email    || '').trim().toLowerCase();
    const key  = String(perm.subAppKey || '').toUpperCase();

    if (uid  && !validUserIds.has(uid)) {
      issues.push({ sheet: 'SUBAPP_PERMISSIONS', id: perm.id, field: 'userId',
        value: uid, reason: 'Uživatel s tímto ID neexistuje' });
    }
    if (mail && !validUserEmails.has(mail)) {
      issues.push({ sheet: 'SUBAPP_PERMISSIONS', id: perm.id, field: 'email',
        value: mail, reason: 'Uživatel s tímto e-mailem neexistuje' });
    }
    if (key  && !validSubAppKeys.has(key)) {
      issues.push({ sheet: 'SUBAPP_PERMISSIONS', id: perm.id, field: 'subAppKey',
        value: key, reason: 'Dlaždice s tímto klíčem neexistuje nebo není aktivní' });
    }
  });

  // --- 7: Kontrola DEPARTMENTS.locationIds ---
  departments.forEach(function(dept) {
    if (!isTruthy_(dept.active)) return;
    String(dept.locationIds || '').split(',')
      .map(function(s) { return s.trim(); })
      .filter(Boolean)
      .forEach(function(lid) {
        if (!validLocationIds.has(lid)) {
          issues.push({ sheet: 'DEPARTMENTS', id: dept.id, name: dept.name, field: 'locationIds',
            value: lid, reason: 'Umístění s tímto ID neexistuje nebo není aktivní' });
        }
      });
  });

  Logger.log('[DATA_INTEGRITY] by=%s issues=%d checkedAt=%s', context.user.email, issues.length, now);

  return {
    ok:         issues.length === 0,
    checkedAt:  now,
    issues:     issues,
    summary: {
      total:             issues.length,
      users:             issues.filter(function(i) { return i.sheet === 'USERS'; }).length,
      subAppPermissions: issues.filter(function(i) { return i.sheet === 'SUBAPP_PERMISSIONS'; }).length,
      departments:       issues.filter(function(i) { return i.sheet === 'DEPARTMENTS'; }).length,
    },
  };
}
