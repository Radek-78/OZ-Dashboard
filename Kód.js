const DATABASE_SCHEMA_VERSION = '1';
const DATABASE_CACHE_TTL_SECONDS = 21600;

function doGet() {
  const bootstrap = getAppBootstrap();

  return renderPage('index', {
    appName: APP_CONFIG.appName,
    appSubtitle: APP_CONFIG.appSubtitle,
    logoUrl: APP_CONFIG.logoUrl,
    version: APP_CONFIG.version,
    theme: APP_CONFIG.theme,
    user: bootstrap.user.email,
    auth: bootstrap.auth,
    renderedAt: new Date().toISOString(),
  })
    .setTitle(APP_CONFIG.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderPage(fileName, data) {
  const template = HtmlService.createTemplateFromFile(fileName);
  template.app = data || {};
  return template.evaluate();
}

function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

function getAppBootstrap() {
  const context = getCurrentUserContext_();

  return {
    appName: APP_CONFIG.appName,
    appSubtitle: APP_CONFIG.appSubtitle,
    logoUrl: APP_CONFIG.logoUrl,
    version: APP_CONFIG.version,
    theme: APP_CONFIG.theme,
    user: context.user,
    auth: context.auth,
    database: {
      spreadsheetId: context.database.spreadsheetId,
      spreadsheetUrl: context.database.spreadsheetUrl,
    },
    loadedAt: new Date().toISOString(),
  };
}

function getHomeData() {
  const context = getCurrentUserContext_();
  if (!context.auth.hasAccess || !hasPermission_(context.auth, 'dashboard.view')) {
    return {
      auth: context.auth,
      stats: [],
      modules: [],
      team: [],
    };
  }

  const loadedAt = new Date();
  const modules = listDashboardSubApps_(context.database.spreadsheet, context.auth);

  return {
    auth: context.auth,
    project: {
      name: APP_CONFIG.appName,
      state: 'Prehled modulu',
    },
    stats: [
      { label: 'Stav systemu', value: 'Pripraveno', tone: 'success', icon: 'check' },
      { label: 'Nacteno', value: Utilities.formatDate(loadedAt, Session.getScriptTimeZone(), 'd.M.yyyy HH:mm'), tone: 'info', icon: 'calendar' },
      { label: 'Prihlaseny uzivatel', value: context.user.email, tone: 'neutral', icon: 'user' },
      { label: 'Role pristupu', value: context.auth.accessRole || '-', tone: 'neutral', icon: 'info' },
    ],
    modules: modules,
    team: [],
  };
}

function getUsersAdminData() {
  const context = requirePermission_('users.manage');
  return buildUsersAdminData_(context);
}

function buildUsersAdminData_(context) {
  const spreadsheet = context.database.spreadsheet;
  return {
    auth: context.auth,
    currentUserId: context.user.id,
    users: listUsers_(spreadsheet),
    roles: listRoles_(spreadsheet),
    systemRoles: [
      { value: 'SUPERADMIN', label: 'Superadmin' },
      { value: 'ADMIN', label: 'Admin' },
      { value: 'USER', label: 'Uzivatel' },
    ],
    locations: listLocations_(spreadsheet),
    departments: listDepartments_(spreadsheet),
    subApps: listSubApps_(spreadsheet),
  };
}

function saveUser(payload) {
  const context = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const data = normalizeUserPayload_(payload);
  validateUserPayload_(data, spreadsheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = spreadsheet.getSheetByName('USERS');
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');
    const emailIndex = headers.indexOf('email');
    const now = new Date();

    let targetRow = -1;
    let original = null;
    for (let row = 1; row < values.length; row++) {
      const rowId = String(values[row][idIndex] || '');
      const rowEmail = String(values[row][emailIndex] || '').trim().toLowerCase();
      if (data.id && rowId === data.id) {
        targetRow = row + 1;
        original = rowToObject_(headers, values[row]);
      } else if (rowEmail === data.email) {
        throw new Error('Uzivatel s timto e-mailem uz existuje.');
      }
    }

    if (data.id && targetRow < 0) throw new Error('Uzivatel nebyl nalezen.');
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

function deleteUser(userId) {
  const context = requirePermission_('users.manage');
  const spreadsheet = context.database.spreadsheet;
  const normalizedId = String(userId || '').trim();

  if (!normalizedId) throw new Error('Chybi ID uzivatele.');
  if (normalizedId === context.user.id) throw new Error('Nemuzete smazat sami sebe.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = spreadsheet.getSheetByName('USERS');
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') === normalizedId) {
        const target = rowToObject_(headers, values[row]);
        assertLastSuperadminIsProtected_(spreadsheet, target, { active: false, accessRole: '', systemRole: '' });
        sheet.deleteRow(row + 1);
        Logger.log('[USER_DELETE] by=%s target=%s', context.user.email, target.email || normalizedId);
        return buildUsersAdminData_(context);
      }
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Uzivatel nebyl nalezen.');
}


function removeDiacritics_(str) {
  return String(str || '').toLowerCase().split('').map(function(c) {
    return {'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z'}[c] || c;
  }).join('').replace(/[^a-z0-9]/g, '');
}
function getCurrentUserContext_() {
  const database = ensureDatabase_();
  const email = getSignedInUser_();
  const user = findUserByEmail_(database.spreadsheet, email);

  if (!user || !isTruthy_(user.active)) {
    return {
      database,
      user: {
        email,
        id: user ? user.id : '',
        firstName: user ? user.firstName : '',
        lastName: user ? user.lastName : '',
      },
      auth: {
        hasAccess: false,
        reason: 'Ucet neni uveden v seznamu aktivnich uzivatelu aplikace.',
        systemRole: user ? user.systemRole : '',
        accessRole: user ? user.accessRole : '',
        permissions: [],
        subApps: {},
      },
    };
  }

  updateUserLastVisit_(database.spreadsheet, user.id);
  Logger.log('[ACCESS] %s role=%s/%s', email, user.systemRole, user.accessRole);

  return {
    database,
    user: {
      email: user.email,
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      locationType: user.locationType,
      locationName: user.locationName,
      department: user.department,
    },
    auth: {
      hasAccess: true,
      reason: '',
      systemRole: user.systemRole,
      accessRole: user.accessRole,
      permissions: getRolePermissions_(database.spreadsheet, user.accessRole),
      subApps: getUserSubAppAccess_(database.spreadsheet, user),
    },
  };
}

function ensureDatabase_() {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const cachedId = cache.get('DATABASE_SPREADSHEET_ID');

  if (cachedId) {
    try {
      const spreadsheet = SpreadsheetApp.openById(cachedId);
      ensureDatabaseSchema_(spreadsheet, props);
      return { spreadsheet, spreadsheetId: cachedId, spreadsheetUrl: spreadsheet.getUrl() };
    } catch (e) {
      cache.remove('DATABASE_SPREADSHEET_ID');
      Logger.log('[DATABASE_CACHE_INVALID] id=%s error=%s', cachedId, e && e.message ? e.message : e);
    }
  }

  const storedId = props.getProperty('DATABASE_SPREADSHEET_ID');

  if (storedId) {
    try {
      const spreadsheet = SpreadsheetApp.openById(storedId);
      cache.put('DATABASE_SPREADSHEET_ID', storedId, DATABASE_CACHE_TTL_SECONDS);
      ensureDatabaseSchema_(spreadsheet, props);
      return { spreadsheet, spreadsheetId: storedId, spreadsheetUrl: spreadsheet.getUrl() };
    } catch (e) {
      // Spreadsheet byl smazán — znovu inicializujeme
      props.deleteProperty('DATABASE_SPREADSHEET_ID');
      props.deleteProperty('DATABASE_SPREADSHEET_URL');
      props.deleteProperty('DATABASE_SCHEMA_VERSION');
      cache.remove('DATABASE_SPREADSHEET_ID');
      Logger.log('[DATABASE_MISSING] id=%s error=%s', storedId, e && e.message ? e.message : e);
    }
  }

  // První spuštění nebo obnova po smazání — pouze jednou
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const recheckId = props.getProperty('DATABASE_SPREADSHEET_ID');
    if (recheckId) {
      const spreadsheet = SpreadsheetApp.openById(recheckId);
      cache.put('DATABASE_SPREADSHEET_ID', recheckId, DATABASE_CACHE_TTL_SECONDS);
      if (props.getProperty('DATABASE_SCHEMA_VERSION') !== DATABASE_SCHEMA_VERSION) {
        setupDatabaseSheets_(spreadsheet);
        props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
      }
      return { spreadsheet, spreadsheetId: recheckId, spreadsheetUrl: spreadsheet.getUrl() };
    }

    const spreadsheet = SpreadsheetApp.create(APP_CONFIG.appName + ' - databaze');
    const spreadsheetId = spreadsheet.getId();
    props.setProperty('DATABASE_SPREADSHEET_ID', spreadsheetId);
    props.setProperty('DATABASE_SPREADSHEET_URL', spreadsheet.getUrl());
    cache.put('DATABASE_SPREADSHEET_ID', spreadsheetId, DATABASE_CACHE_TTL_SECONDS);

    setupDatabaseSheets_(spreadsheet);
    props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
    seedInitialUserIfNeeded_(spreadsheet);

    return { spreadsheet, spreadsheetId, spreadsheetUrl: spreadsheet.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function ensureDatabaseSchema_(spreadsheet, props) {
  if (props.getProperty('DATABASE_SCHEMA_VERSION') === DATABASE_SCHEMA_VERSION) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (props.getProperty('DATABASE_SCHEMA_VERSION') === DATABASE_SCHEMA_VERSION) return;
    setupDatabaseSheets_(spreadsheet);
    props.setProperty('DATABASE_SCHEMA_VERSION', DATABASE_SCHEMA_VERSION);
    props.setProperty('DATABASE_SPREADSHEET_URL', spreadsheet.getUrl());
    Logger.log('[DATABASE_SCHEMA] migrated to version %s', DATABASE_SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

function setupDatabaseSheets_(spreadsheet) {
  ensureSheet_(spreadsheet, 'CONFIG', [
    'key', 'value', 'description', 'updatedAt', 'updatedBy',
  ], [
    ['appName', APP_CONFIG.appName, 'Nazev aplikace', new Date(), getSignedInUser_()],
    ['appVersion', APP_CONFIG.version, 'Verze aplikace', new Date(), getSignedInUser_()],
    ['databaseSchemaVersion', DATABASE_SCHEMA_VERSION, 'Verze databazove struktury', new Date(), getSignedInUser_()],
  ]);

  ensureSheet_(spreadsheet, 'USERS', [
    'id', 'email', 'firstName', 'lastName', 'lastVisitAt', 'locationType', 'locationName', 'department',
    'systemRole', 'accessRole', 'active', 'createdAt', 'updatedAt',
  ]);

  ensureSheet_(spreadsheet, 'ROLES', [
    'roleKey', 'roleName', 'description', 'active', 'createdAt', 'updatedAt',
  ], [
    ['SUPERADMIN', 'Superadmin', 'Plny pristup k aplikaci a administraci', true, new Date(), new Date()],
    ['ADMIN', 'Admin', 'Sprava vybranych casti aplikace', true, new Date(), new Date()],
    ['EDITOR', 'Editor', 'Prace s daty v pridelenych modulech', true, new Date(), new Date()],
    ['VIEWER', 'Viewer', 'Pouze cteni pridelenych modulu', true, new Date(), new Date()],
  ]);

  ensureSheet_(spreadsheet, 'ROLE_PERMISSIONS', [
    'roleKey', 'permissionKey', 'allowed', 'description', 'updatedAt',
  ], [
    ['SUPERADMIN', '*', true, 'Vsechna opravneni', new Date()],
    ['ADMIN', 'dashboard.view', true, 'Zobrazeni dashboardu', new Date()],
    ['ADMIN', 'users.manage', true, 'Sprava uzivatelu', new Date()],
    ['EDITOR', 'dashboard.view', true, 'Zobrazeni dashboardu', new Date()],
    ['VIEWER', 'dashboard.view', true, 'Zobrazeni dashboardu', new Date()],
  ]);

  ensureSheet_(spreadsheet, 'SUBAPP_PERMISSIONS', [
    'userId', 'email', 'subAppKey', 'accessLevel', 'active', 'updatedAt', 'updatedBy',
  ]);

  ensureSheet_(spreadsheet, 'SUBAPPS', [
    'id', 'key', 'name', 'status', 'icon', 'description', 'targetUrl', 'lastUpdatedAt',
    'sortOrder', 'active', 'createdAt', 'updatedAt',
  ]);

  ensureSheet_(spreadsheet, 'LOCATIONS', [
    'id', 'type', 'code', 'abbreviation', 'city', 'active', 'createdAt', 'updatedAt',
  ], [
    [Utilities.getUuid(), 'CENTRALA', '', '', '', true, new Date(), new Date()],
  ]);

  ensureSheet_(spreadsheet, 'DEPARTMENTS', [
    'id', 'name', 'locationIds', 'active', 'createdAt', 'updatedAt',
  ], [
    [Utilities.getUuid(), 'OZ', '', true, new Date(), new Date()],
  ]);
}

function ensureSheet_(spreadsheet, name, headers, seedRows) {
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
    if (seedRows && seedRows.length) {
      sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
    }
    return sheet;
  }

  // List existuje — pouze přidáme chybějící sloupce, nikdy nesmažeme existující data.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
    : [];

  const missing = headers.filter(function(h) { return existingHeaders.indexOf(h) < 0; });
  if (missing.length > 0) {
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
    Logger.log('[SCHEMA] List "%s": přidány sloupce: %s', name, missing.join(', '));
  }

  if (seedRows && seedRows.length && sheet.getLastRow() < 2) {
    const currentHeaders = lastCol > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      : headers;
    const reordered = seedRows.map(function(row) {
      return currentHeaders.map(function(h) {
        const i = headers.indexOf(h);
        return i >= 0 ? row[i] : '';
      });
    });
    sheet.getRange(2, 1, reordered.length, currentHeaders.length).setValues(reordered);
  }

  return sheet;
}

function seedInitialUserIfNeeded_(spreadsheet) {
  const usersSheet = spreadsheet.getSheetByName('USERS');
  if (usersSheet.getLastRow() > 1) return;

  const email = getSignedInUser_();
  const now = new Date();
  usersSheet.appendRow([
    Utilities.getUuid(),
    email,
    getFirstNameFromEmail_(email),
    '',
    now,
    'CENTRALA',
    'Centrala',
    'OZ',
    'SUPERADMIN',
    'SUPERADMIN',
    true,
    now,
    now,
  ]);
  Logger.log('[SEED] Prvni superadmin vytvoren: %s v %s', email, now.toISOString());
}

function listUsers_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('USERS'))
    .map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      lastVisitAt: formatDateValue_(user.lastVisitAt),
      locationType: user.locationType,
      locationName: user.locationName,
      department: user.department,
      systemRole: user.systemRole,
      accessRole: user.accessRole,
      active: isTruthy_(user.active),
      createdAt: formatDateValue_(user.createdAt),
      updatedAt: formatDateValue_(user.updatedAt),
    }))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'cs'));
}

function listRoles_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('ROLES'))
    .filter((role) => isTruthy_(role.active))
    .map((role) => ({ value: role.roleKey, label: role.roleName || role.roleKey }));
}

function listLocations_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('LOCATIONS'))
    .filter(function(loc) { return isTruthy_(loc.active); })
    .map(function(loc) {
      var displayName = loc.type === 'CENTRALA'
        ? 'Centrála'
        : [loc.code, loc.abbreviation, loc.city].filter(Boolean).join(' ');
      return {
        id: loc.id,
        type: loc.type,
        code: loc.code,
        abbreviation: loc.abbreviation,
        city: loc.city,
        displayName: displayName,
        active: isTruthy_(loc.active),
      };
    })
    .sort(function(a, b) {
      if (a.type === 'CENTRALA') return -1;
      if (b.type === 'CENTRALA') return 1;
      return parseInt(a.code, 10) - parseInt(b.code, 10);
    });
}

function listDepartments_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('DEPARTMENTS'))
    .filter(function(d) { return isTruthy_(d.active); })
    .map(function(d) {
      return {
        id: d.id,
        name: d.name,
        locationIds: String(d.locationIds || '').split(',').filter(Boolean),
        active: isTruthy_(d.active),
      };
    })
    .sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'cs'); });
}

function getLocationsData() {
  var context = requirePermission_('users.manage');
  return buildLocationsData_(context);
}

function buildLocationsData_(context) {
  var spreadsheet = context.database.spreadsheet;
  return {
    auth: context.auth,
    locations: getObjects_(spreadsheet.getSheetByName('LOCATIONS')).map(function(loc) {
      var displayName = loc.type === 'CENTRALA'
        ? 'Centrála'
        : [loc.code, loc.abbreviation, loc.city].filter(Boolean).join(' ');
      return {
        id: loc.id, type: loc.type, code: String(loc.code || ''), abbreviation: String(loc.abbreviation || ''),
        city: String(loc.city || ''), displayName: displayName, active: isTruthy_(loc.active),
        createdAt: formatDateValue_(loc.createdAt), updatedAt: formatDateValue_(loc.updatedAt),
      };
    }).sort(function(a, b) {
      if (a.type === 'CENTRALA') return -1;
      if (b.type === 'CENTRALA') return 1;
      return parseInt(a.code, 10) - parseInt(b.code, 10);
    }),
  };
}

function saveLocation(payload) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var data = payload || {};
  var id = String(data.id || '').trim();
  var type = String(data.type || 'LC').trim().toUpperCase();
  var code = String(data.code || '').trim();
  var abbreviation = String(data.abbreviation || '').trim().toUpperCase();
  var city = String(data.city || '').trim();
  var active = data.active === true || data.active === 'true';

  if (type === 'LC' && !code) throw new Error('Vyplňte číslo LC.');
  if (type === 'LC' && !city) throw new Error('Vyplňte město.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    var sheet = spreadsheet.getSheetByName('LOCATIONS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');
    var codeIndex = headers.indexOf('code');
    var targetRow = -1;

    for (var row = 1; row < values.length; row++) {
      if (id && String(values[row][idIndex] || '') === id) {
        targetRow = row + 1;
      } else if (type === 'LC' && code && String(values[row][codeIndex] || '').trim() === code) {
        throw new Error('Umístění s tímto kódem LC již existuje.');
      }
    }

    var rowValues = headers.map(function(h) {
      var map = { id: id || Utilities.getUuid(), type: type, code: code, abbreviation: abbreviation,
        city: city, active: active, updatedAt: now };
      if (!id) map.createdAt = now;
      return map[h] !== undefined ? map[h] : (targetRow > 0 && values[targetRow - 1][headers.indexOf(h)] !== undefined ? values[targetRow - 1][headers.indexOf(h)] : '');
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

function deleteLocation(locationId) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var normalized = String(locationId || '').trim();
  if (!normalized) throw new Error('Chybí ID umístění.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = spreadsheet.getSheetByName('LOCATIONS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');
    var typeIndex = headers.indexOf('type');

    for (var row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') === normalized) {
        if (String(values[row][typeIndex] || '') === 'CENTRALA') throw new Error('Centrálu nelze smazat.');

        var deptRows = getObjects_(spreadsheet.getSheetByName('DEPARTMENTS'));
        var deptUsing = deptRows.filter(function(d) {
          return String(d.locationIds || '').split(',').map(function(s) { return s.trim(); }).indexOf(normalized) >= 0;
        });
        if (deptUsing.length > 0) {
          throw new Error(
            'Umístění nelze smazat — používají ho tyto úseky: ' +
            deptUsing.map(function(d) { return d.name; }).join(', ') + '.'
          );
        }

        var location = rowToObject_(headers, values[row]);
        var locationName = location.type === 'CENTRALA'
          ? 'Centrála'
          : [location.code, location.abbreviation, location.city].filter(Boolean).join(' ');
        var userRows = getObjects_(spreadsheet.getSheetByName('USERS'));
        var usersUsing = userRows.filter(function(user) {
          return String(user.locationName || '').trim() === locationName;
        });
        if (usersUsing.length > 0) {
          throw new Error(
            'Umístění nelze smazat — je přiřazeno ' + usersUsing.length +
            (usersUsing.length === 1 ? ' uživateli.' : ' uživatelům.')
          );
        }

        sheet.deleteRow(row + 1);
        Logger.log('[LOCATION_DELETE] by=%s id=%s', context.user.email, normalized);
        return buildLocationsData_(context);
      }
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Umístění nebylo nalezeno.');
}

function getDepartmentsData() {
  var context = requirePermission_('users.manage');
  return buildDepartmentsData_(context);
}

function buildDepartmentsData_(context) {
  var spreadsheet = context.database.spreadsheet;
  return {
    auth: context.auth,
    departments: getObjects_(spreadsheet.getSheetByName('DEPARTMENTS')).map(function(d) {
      return {
        id: d.id, name: String(d.name || ''),
        locationIds: String(d.locationIds || '').split(',').filter(Boolean),
        active: isTruthy_(d.active),
        createdAt: formatDateValue_(d.createdAt), updatedAt: formatDateValue_(d.updatedAt),
      };
    }).sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'cs'); }),
  };
}

function getSubAppsData() {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  return {
    auth: context.auth,
    subApps: listSubApps_(spreadsheet),
  };
}

function saveSubApp(payload) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var data = normalizeSubAppPayload_(payload);
  validateSubAppPayload_(data);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    var sheet = spreadsheet.getSheetByName('SUBAPPS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');
    var keyIndex = headers.indexOf('key');
    var targetRow = -1;

    if (!data.id && !data.key) {
      data.key = makeUniqueSubAppKey_(spreadsheet, data.name);
    }
    if (!data.id && !data.sortOrder) {
      data.sortOrder = getNextSubAppSortOrder_(spreadsheet);
    }

    for (var row = 1; row < values.length; row++) {
      var rowId = String(values[row][idIndex] || '');
      var rowKey = String(values[row][keyIndex] || '').trim().toUpperCase();
      if (data.id && rowId === data.id) {
        targetRow = row + 1;
      } else if (rowKey === data.key) {
        throw new Error('Dlaždice s tímto klíčem už existuje.');
      }
    }

    if (data.id && targetRow < 0) throw new Error('Dlaždice nebyla nalezena.');

    var source = targetRow > 0 ? rowToObject_(headers, values[targetRow - 1]) : {};
    var rowValues = buildSubAppRow_(headers, data, source, now);
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

function deleteSubApp(subAppId) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var normalized = String(subAppId || '').trim();
  if (!normalized) throw new Error('Chybí ID dlaždice.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = spreadsheet.getSheetByName('SUBAPPS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');

    var keyIndex = headers.indexOf('key');

    for (var row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') === normalized) {
        var subAppKey = String(values[row][keyIndex] || '');
        sheet.deleteRow(row + 1);

        if (subAppKey) {
          var permSheet = spreadsheet.getSheetByName('SUBAPP_PERMISSIONS');
          var permValues = permSheet.getDataRange().getValues();
          var permHeaders = permValues[0];
          var permKeyIndex = permHeaders.indexOf('subAppKey');
          for (var pr = permValues.length - 1; pr >= 1; pr--) {
            if (String(permValues[pr][permKeyIndex] || '') === subAppKey) {
              permSheet.deleteRow(pr + 1);
            }
          }
          Logger.log('[SUBAPP_DELETE] by=%s id=%s key=%s perms_cleaned=true', context.user.email, normalized, subAppKey);
        } else {
          Logger.log('[SUBAPP_DELETE] by=%s id=%s', context.user.email, normalized);
        }

        return buildUsersAdminData_(context);
      }
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Dlaždice nebyla nalezena.');
}

function listSubApps_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('SUBAPPS'))
    .map(function(item) {
      return {
        id: item.id,
        key: String(item.key || ''),
        name: String(item.name || ''),
        status: normalizeSubAppStatus_(item.status),
        icon: String(item.icon || 'briefcase'),
        description: String(item.description || ''),
        targetUrl: String(item.targetUrl || ''),
        lastUpdatedAt: formatDateValue_(item.lastUpdatedAt),
        sortOrder: Number(item.sortOrder || 0),
        active: isTruthy_(item.active),
        createdAt: formatDateValue_(item.createdAt),
        updatedAt: formatDateValue_(item.updatedAt),
      };
    })
    .sort(function(a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name).localeCompare(String(b.name), 'cs');
    });
}

function listDashboardSubApps_(spreadsheet, auth) {
  var canOpenPreparing = isAdminAuth_(auth);
  var userAccess = auth && auth.subApps ? auth.subApps : {};
  return listSubApps_(spreadsheet)
    .filter(function(item) { return item.active; })
    .filter(function(item) {
      var accessKey = String(item.key || '').trim().toUpperCase();
      return canOpenPreparing || (item.status === 'ACTIVE' && Boolean(userAccess[accessKey]));
    })
    .map(function(item) {
      var isActive = item.status === 'ACTIVE';
      var isPreparing = item.status === 'PREPARING';
      var enabled = isActive || (isPreparing && canOpenPreparing);
      return {
        id: item.id,
        key: item.key,
        title: item.name,
        status: subAppStatusLabel_(item.status),
        statusKey: item.status,
        icon: item.icon,
        description: item.description,
        updated: item.lastUpdatedAt ? 'Aktualizováno: ' + item.lastUpdatedAt : 'Aktualizace zatím není uvedena',
        targetUrl: item.targetUrl,
        enabled: enabled,
        accent: item.status === 'ACTIVE' ? 'blue' : (item.status === 'PREPARING' ? 'red' : 'muted'),
        accessLevel: userAccess[String(item.key || '').trim().toUpperCase()] || null,
      };
    });
}

function saveDepartment(payload) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var data = payload || {};
  var id = String(data.id || '').trim();
  var name = String(data.name || '').trim();
  var locationIds = String(data.locationIds || '').trim();
  var active = data.active === true || data.active === 'true';
  if (!name) throw new Error('Vyplňte název úseku.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    var sheet = spreadsheet.getSheetByName('DEPARTMENTS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');
    var nameIndex = headers.indexOf('name');
    var targetRow = -1;

    for (var row = 1; row < values.length; row++) {
      if (id && String(values[row][idIndex] || '') === id) {
        targetRow = row + 1;
      } else if (String(values[row][nameIndex] || '').trim().toLowerCase() === name.toLowerCase()) {
        throw new Error('Úsek s tímto názvem již existuje.');
      }
    }

    var rowValues = headers.map(function(h) {
      var map = { id: id || Utilities.getUuid(), name: name, locationIds: locationIds, active: active, updatedAt: now };
      if (!id) map.createdAt = now;
      return map[h] !== undefined ? map[h] : (targetRow > 0 && values[targetRow - 1][headers.indexOf(h)] !== undefined ? values[targetRow - 1][headers.indexOf(h)] : '');
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

function deleteDepartment(departmentId) {
  var context = requirePermission_('users.manage');
  var spreadsheet = context.database.spreadsheet;
  var normalized = String(departmentId || '').trim();
  if (!normalized) throw new Error('Chybí ID úseku.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = spreadsheet.getSheetByName('DEPARTMENTS');
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idIndex = headers.indexOf('id');
    var nameIndex = headers.indexOf('name');

    for (var row = 1; row < values.length; row++) {
      if (String(values[row][idIndex] || '') === normalized) {
        var deptName = String(values[row][nameIndex] || '');

        var userRows = getObjects_(spreadsheet.getSheetByName('USERS'));
        var usersUsing = userRows.filter(function(u) {
          return String(u.department || '').trim() === deptName && isTruthy_(u.active);
        });
        if (usersUsing.length > 0) {
          throw new Error(
            'Úsek nelze smazat — je přiřazen ' + usersUsing.length +
            (usersUsing.length === 1 ? ' uživateli.' : ' uživatelům.')
          );
        }

        sheet.deleteRow(row + 1);
        Logger.log('[DEPT_DELETE] by=%s id=%s name=%s', context.user.email, normalized, deptName);
        return buildDepartmentsData_(context);
      }
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error('Úsek nebyl nalezen.');
}

function findUserByEmail_(spreadsheet, email) {
  const sheet = spreadsheet.getSheetByName('USERS');
  const rows = getObjects_(sheet);
  const normalized = String(email || '').trim().toLowerCase();
  return rows.find((row) => String(row.email || '').trim().toLowerCase() === normalized) || null;
}

function updateUserLastVisit_(spreadsheet, userId) {
  const sheet = spreadsheet.getSheetByName('USERS');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf('id');
  const lastVisitIndex = headers.indexOf('lastVisitAt');
  const updatedAtIndex = headers.indexOf('updatedAt');

  for (let row = 1; row < values.length; row++) {
    if (String(values[row][idIndex] || '') === String(userId || '')) {
      const now = new Date();
      const rowData = values[row].slice();
      rowData[lastVisitIndex] = now;
      rowData[updatedAtIndex] = now;
      sheet.getRange(row + 1, 1, 1, headers.length).setValues([rowData]);
      return;
    }
  }
}

function getRolePermissions_(spreadsheet, accessRole) {
  const rows = getObjects_(spreadsheet.getSheetByName('ROLE_PERMISSIONS'));
  const role = String(accessRole || '').trim().toUpperCase();
  return rows
    .filter((row) => String(row.roleKey || '').trim().toUpperCase() === role && isTruthy_(row.allowed))
    .map((row) => row.permissionKey);
}

function getUserSubAppAccess_(spreadsheet, user) {
  const rows = getObjects_(spreadsheet.getSheetByName('SUBAPP_PERMISSIONS'));
  const byUser = rows.filter((row) => {
    const sameId = row.userId && String(row.userId) === String(user.id);
    const sameEmail = String(row.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
    return (sameId || sameEmail) && isTruthy_(row.active);
  });

  return byUser.reduce((result, row) => {
    const key = String(row.subAppKey || '').trim().toUpperCase();
    if (key) result[key] = row.accessLevel;
    return result;
  }, {});
}

function requirePermission_(permission) {
  const context = getCurrentUserContext_();
  if (!context.auth.hasAccess || !hasPermission_(context.auth, permission)) {
    throw new Error('K teto akci nemate opravneni.');
  }
  return context;
}

function hasPermission_(auth, permission) {
  const permissions = auth && auth.permissions ? auth.permissions : [];
  return permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0;
}

function normalizeUserPayload_(payload) {
  const data = payload || {};
  return {
    id: String(data.id || '').trim(),
    email: String(data.email || '').trim().toLowerCase(),
    firstName: String(data.firstName || '').trim(),
    lastName: String(data.lastName || '').trim(),
    locationType: String(data.locationType || 'CENTRALA').trim().toUpperCase(),
    locationName: String(data.locationName || '').trim(),
    department: String(data.department || '').trim(),
    systemRole: String(data.systemRole || 'USER').trim().toUpperCase(),
    accessRole: String(data.accessRole || 'VIEWER').trim().toUpperCase(),
    active: data.active === true || data.active === 'true' || data.active === '1',
  };
}

function validateUserPayload_(data, spreadsheet) {
  if (!data.email || data.email.indexOf('@') < 1) throw new Error('Vyplnte platny e-mail uzivatele.');
  if (!data.firstName) throw new Error('Vyplnte jmeno uzivatele.');
  if (!data.lastName) throw new Error('Vyplnte prijmeni uzivatele.');
  if (!data.locationName) throw new Error('Vyplnte misto zarazeni.');
  if (!data.department) throw new Error('Vyplnte usek.');

  const validSystemRoles = ['SUPERADMIN', 'ADMIN', 'USER'];
  if (validSystemRoles.indexOf(data.systemRole) < 0) throw new Error('Vybrana systemova role neexistuje.');

  const roleKeys = listRoles_(spreadsheet).map((role) => role.value);
  if (roleKeys.indexOf(data.accessRole) < 0) throw new Error('Vybrana role pristupu neexistuje.');
}

function normalizeSubAppPayload_(payload) {
  var data = payload || {};
  return {
    id: String(data.id || '').trim(),
    key: normalizeSubAppKey_(data.key),
    name: String(data.name || '').trim(),
    status: normalizeSubAppStatus_(data.status),
    icon: String(data.icon || 'briefcase').trim(),
    description: String(data.description || '').trim(),
    targetUrl: String(data.targetUrl || '').trim(),
    lastUpdatedAt: String(data.lastUpdatedAt || '').trim(),
    sortOrder: Number(data.sortOrder || 0),
    active: data.active === true || data.active === 'true' || data.active === '1',
  };
}

function validateSubAppPayload_(data) {
  if (!data.name) throw new Error('Vyplňte název dlaždice.');
  if (['ACTIVE', 'PREPARING', 'DISABLED'].indexOf(data.status) < 0) throw new Error('Vyberte platný stav dlaždice.');
  if (data.targetUrl) {
    var url = String(data.targetUrl).trim().toLowerCase();
    if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Cílová URL musí začínat https:// nebo http://');
    }
  }
}

function normalizeSubAppKey_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function makeUniqueSubAppKey_(spreadsheet, name) {
  var base = normalizeSubAppKey_(removeDiacritics_(name).toUpperCase()) || 'SUBAPP';
  var existing = listSubApps_(spreadsheet).map(function(item) { return String(item.key || '').toUpperCase(); });
  var candidate = base;
  var suffix = 2;
  while (existing.indexOf(candidate) >= 0) {
    candidate = base + '_' + suffix;
    suffix += 1;
  }
  return candidate;
}

function getNextSubAppSortOrder_(spreadsheet) {
  var values = listSubApps_(spreadsheet).map(function(item) { return Number(item.sortOrder || 0); });
  if (!values.length) return 1;
  return Math.max.apply(null, values) + 1;
}

function buildSubAppRow_(headers, data, original, now) {
  var source = original || {};
  var values = {
    id: data.id || Utilities.getUuid(),
    key: data.key,
    name: data.name,
    status: data.status,
    icon: data.icon,
    description: data.description,
    targetUrl: data.targetUrl,
    lastUpdatedAt: data.lastUpdatedAt,
    sortOrder: data.sortOrder,
    active: data.active,
    createdAt: source.createdAt || now,
    updatedAt: now,
  };
  return headers.map(function(header) { return values[header] !== undefined ? values[header] : ''; });
}

function normalizeSubAppStatus_(value) {
  var normalized = String(value || 'DISABLED').trim().toUpperCase();
  if (['ACTIVE', 'AKTIVNI', 'AKTIVNÍ'].indexOf(normalized) >= 0) return 'ACTIVE';
  if (['PREPARING', 'V_PRIPRAVE', 'V_PŘÍPRAVĚ', 'V PRIPRAVE', 'V PŘÍPRAVĚ'].indexOf(normalized) >= 0) return 'PREPARING';
  return 'DISABLED';
}

function subAppStatusLabel_(status) {
  if (status === 'ACTIVE') return 'Aktivní';
  if (status === 'PREPARING') return 'V přípravě';
  return 'Vypnuto';
}

function isAdminAuth_(auth) {
  var systemRole = String(auth && auth.systemRole || '').toUpperCase();
  var accessRole = String(auth && auth.accessRole || '').toUpperCase();
  return ['SUPERADMIN', 'ADMIN'].indexOf(systemRole) >= 0 || ['SUPERADMIN', 'ADMIN'].indexOf(accessRole) >= 0;
}

function buildUserRow_(headers, data, original, now) {
  const source = original || {};
  const values = {
    id: data.id || Utilities.getUuid(),
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    lastVisitAt: source.lastVisitAt || '',
    locationType: data.locationType,
    locationName: data.locationName,
    department: data.department,
    systemRole: data.systemRole,
    accessRole: data.accessRole,
    active: data.active,
    createdAt: source.createdAt || now,
    updatedAt: now,
  };

  return headers.map((header) => values[header] !== undefined ? values[header] : '');
}

function assertLastSuperadminIsProtected_(spreadsheet, original, nextData) {
  const wasActiveSuperadmin = isTruthy_(original.active)
    && (String(original.accessRole || '').toUpperCase() === 'SUPERADMIN' || String(original.systemRole || '').toUpperCase() === 'SUPERADMIN');
  const staysActiveSuperadmin = nextData.active === true
    && (String(nextData.accessRole || '').toUpperCase() === 'SUPERADMIN' || String(nextData.systemRole || '').toUpperCase() === 'SUPERADMIN');

  if (!wasActiveSuperadmin || staysActiveSuperadmin) return;
  if (countActiveSuperadmins_(spreadsheet) <= 1) {
    throw new Error('Nelze odebrat posledniho aktivniho superadmina.');
  }
}

function countActiveSuperadmins_(spreadsheet) {
  return getObjects_(spreadsheet.getSheetByName('USERS')).filter((user) => (
    isTruthy_(user.active)
    && (String(user.accessRole || '').toUpperCase() === 'SUPERADMIN' || String(user.systemRole || '').toUpperCase() === 'SUPERADMIN')
  )).length;
}

function getObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map((row) => rowToObject_(headers, row));
}

function rowToObject_(headers, row) {
  return headers.reduce((object, header, index) => {
    object[header] = row[index];
    return object;
  }, {});
}

function isTruthy_(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'ano', 'yes', 'active', 'aktivni'].includes(normalized);
}

function formatDateValue_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return String(value);
}

function getFirstNameFromEmail_(email) {
  const local = String(email || '').split('@')[0];
  const first = local.split(/[._-]+/).filter(Boolean)[0] || local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

function getSignedInUser_() {
  const email = Session.getActiveUser().getEmail();
  if (email) return email;
  // EffectiveUser vraci vlastnika skriptu, ne navstevnika — nikdy nepouzivat pro autorizaci.
  // Prazdny ActiveUser nastava pri deploymentu "Execute as: Me"; spravne nastaveni je
  // "Execute as: User accessing the web app".
  throw new Error(
    'Nepodařilo se zjistit identitu přihlášeného uživatele. ' +
    'Zkontrolujte nastavení nasazení: "Execute as" musí být "User accessing the web app".'
  );
}
