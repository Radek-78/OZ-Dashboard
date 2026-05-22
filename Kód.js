/**
 * OZ Dashboard — Vstupní bod aplikace
 *
 * Tento soubor obsahuje pouze vstupní funkce GAS web aplikace (doGet, renderPage, include)
 * a high-level API endpointy volané přes google.script.run.
 *
 * Doménová logika je organizována do samostatných souborů:
 *   Helpers.js     — sdílené pomocné funkce (getObjects_, isTruthy_, formatDateValue_, …)
 *   Database.js    — správa databáze, schéma, seed dat
 *   Auth.js        — autentizace a autorizace
 *   Users.js       — správa uživatelů
 *   Locations.js   — správa umístění a úseků
 *   SubApps.js     — správa dlaždic dashboardu
 *   Roles.js       — správa rolí a oprávnění rolí
 *   Permissions.js — správa přístupů k dlaždicím
 *   Integrity.js   — audit datové integrity
 *   Config.js      — konfigurace aplikace a changelog
 */

// ---------------------------------------------------------------------------
// Web App vstupní bod
// ---------------------------------------------------------------------------

/**
 * Zpracuje GET request — vrátí renderovanou HTML stránku.
 * Nasazení: "Execute as: User accessing the web app", "Who has access: Anyone within Lidl".
 * @param {Object=} e - GET event s query parametry.
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const page = String(e && e.parameter && e.parameter.page || '').trim().toLowerCase();
  if (page === 'odpisy' || page === 'vyhodnoceni-odpisu-akcnich-artiklu') {
    return renderOdpisyAppPage_();
  }

  const bootstrap = getAppBootstrap();

  return renderPage('index', {
    appName:    APP_CONFIG.appName,
    appSubtitle: APP_CONFIG.appSubtitle,
    logoUrl:    APP_CONFIG.logoUrl,
    version:    APP_CONFIG.version,
    theme:      APP_CONFIG.theme,
    user:       bootstrap.user.email,
    auth:       bootstrap.auth,
    webAppUrl:  getWebAppUrl_(),
    renderedAt: new Date().toISOString(),
    changelog:  APP_CHANGELOG,
  })
    .setTitle(APP_CONFIG.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Renderuje samostatnou stránku subaplikace Vyhodnocení odpisů.
 * @returns {HtmlOutput}
 */
function renderOdpisyAppPage_() {
  const bootstrap = getAppBootstrap();
  const webAppUrl = getWebAppUrl_();

  return renderPage('OdpisyApp', {
    appName:      'Vyhodnocení odpisů akčních artiklů',
    appSubtitle:  APP_CONFIG.appName,
    logoUrl:      APP_CONFIG.logoUrl,
    version:      APP_CONFIG.version,
    theme:        APP_CONFIG.theme,
    user:         bootstrap.user.email,
    auth:         bootstrap.auth,
    webAppUrl:    webAppUrl,
    dashboardUrl: webAppUrl,
    renderedAt:   new Date().toISOString(),
  })
    .setTitle('Vyhodnocení odpisů akčních artiklů')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Renderuje HTML šablonu se zadanými daty dostupnými jako `app.*` v šabloně.
 * @param {string} fileName - název souboru bez přípony (např. 'index')
 * @param {Object} data - data předaná do šablony
 * @returns {HtmlOutput}
 */
function renderPage(fileName, data) {
  const template = HtmlService.createTemplateFromFile(fileName);
  template.app   = data || {};
  return template.evaluate();
}

/**
 * Vloží obsah HTML souboru do šablony (používá se v index.html pro styly a skripty).
 * @param {string} fileName - název souboru bez přípony
 * @returns {string} raw HTML obsah souboru
 */
function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

// ---------------------------------------------------------------------------
// Bootstrap a inicializace klienta
// ---------------------------------------------------------------------------

/**
 * Vrátí základní bootstrap data pro inicializaci klientské aplikace.
 * Volá se při prvním načtení nebo obnovení stránky.
 * @returns {Object}
 */
function getAppBootstrap() {
  const context = getCurrentUserContext_();

  return {
    appName:     APP_CONFIG.appName,
    appSubtitle: APP_CONFIG.appSubtitle,
    logoUrl:     APP_CONFIG.logoUrl,
    version:     APP_CONFIG.version,
    theme:       APP_CONFIG.theme,
    user:        context.user,
    auth:        context.auth,
    webAppUrl:   getWebAppUrl_(),
    database: {
      spreadsheetId:  context.database.spreadsheetId,
      spreadsheetUrl: context.database.spreadsheetUrl,
    },
    loadedAt: new Date().toISOString(),
  };
}

/**
 * Vrátí kombinovaná inicializační data pro jediný serverový round-trip při startu aplikace.
 * Obsahuje bootstrap, data domovské stránky a data nastavení (pokud má uživatel oprávnění).
 * @returns {{ bootstrap: Object, homeData: Object|null, settingsData: Object|null }}
 */
function getInitData() {
  const context = getCurrentUserContext_();

  const bootstrap = {
    appName:     APP_CONFIG.appName,
    appSubtitle: APP_CONFIG.appSubtitle,
    logoUrl:     APP_CONFIG.logoUrl,
    version:     APP_CONFIG.version,
    theme:       APP_CONFIG.theme,
    user:        context.user,
    auth:        context.auth,
    webAppUrl:   getWebAppUrl_(),
    database: {
      spreadsheetId:  context.database.spreadsheetId,
      spreadsheetUrl: context.database.spreadsheetUrl,
    },
    loadedAt: new Date().toISOString(),
  };

  let homeData = null;
  if (context.auth.hasAccess && hasPermission_(context.auth, 'dashboard.view')) {
    const loadedAt = new Date();
    homeData = {
      auth:    context.auth,
      project: { name: APP_CONFIG.appName, state: 'Přehled modulů' },
      stats:   buildDashboardStats_(context.user, context.auth, loadedAt),
      modules: listDashboardSubApps_(context.database.spreadsheet, context.auth),
      team:    [],
    };

    try {
      updateUserLastVisit_(context.database.spreadsheet, context.user.id);
    } catch (e) {
      Logger.log('[VISIT_UPDATE_FAIL] user=%s error=%s', context.user.email, e && e.message ? e.message : e);
    }
  }

  let settingsData = null;
  if (context.auth.hasAccess && hasPermission_(context.auth, 'users.manage')) {
    settingsData = buildUsersAdminData_(context);
  }

  // Zajistíme správné targetUrl pro interní subaplikace (idempotentní)
  try {
    ensureInternalSubAppUrls_(context.database.spreadsheet);
  } catch (e) {
    Logger.log('[ENSURE_INTERNAL_URLS_FAIL] %s', e && e.message ? e.message : e);
  }

  return { bootstrap, homeData, settingsData };
}

/**
 * Bezpečně vrátí URL aktuálně nasazené web aplikace.
 * @returns {string}
 */
function getWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    Logger.log('[WEB_APP_URL_FAIL] %s', e && e.message ? e.message : e);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Domovská stránka
// ---------------------------------------------------------------------------

/**
 * Vrátí data pro domovský dashboard (stats, moduly, tým).
 * Voláno při přechodu na domovskou stránku po inicializaci.
 * @returns {Object}
 */
function getHomeData() {
  const context = getCurrentUserContext_();

  if (!context.auth.hasAccess || !hasPermission_(context.auth, 'dashboard.view')) {
    return { auth: context.auth, stats: [], modules: [], team: [] };
  }

  const loadedAt = new Date();
  return {
    auth:    context.auth,
    project: { name: APP_CONFIG.appName, state: 'Přehled modulů' },
    stats:   buildDashboardStats_(context.user, context.auth, loadedAt),
    modules: listDashboardSubApps_(context.database.spreadsheet, context.auth),
    team:    [],
  };
}

// ---------------------------------------------------------------------------
// Health check (pro diagnostiku nasazení)
// ---------------------------------------------------------------------------

/**
 * Vrátí stav aplikace a databáze pro diagnostické účely.
 * @returns {{ status: string, timestamp: string, [key: string]: * }}
 */
function getHealthData() {
  try {
    const context = getCurrentUserContext_();
    return {
      status:           'ok',
      timestamp:        new Date().toISOString(),
      spreadsheetId:    context.database.spreadsheetId,
      sheets:           context.database.spreadsheet.getSheets().map(function(s) { return s.getName(); }),
      user:             context.user.email,
      schemaVersion:    DATABASE_SCHEMA_VERSION,
    };
  } catch (e) {
    return {
      status:    'error',
      timestamp: new Date().toISOString(),
      error:     e && e.message ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Interní pomocná funkce
// ---------------------------------------------------------------------------

/**
 * Sestaví statistické karty pro domovský dashboard.
 * @param {Object} user
 * @param {Object} auth
 * @param {Date} loadedAt
 * @returns {Object[]}
 */
function buildDashboardStats_(user, auth, loadedAt) {
  return [
    { label: 'Stav systému',         value: 'Připraveno',   tone: 'success', icon: 'check' },
    { label: 'Načteno',              value: Utilities.formatDate(loadedAt, Session.getScriptTimeZone(), 'd.M.yyyy HH:mm'), tone: 'info', icon: 'calendar' },
    { label: 'Přihlášený uživatel',  value: user.email,     tone: 'neutral', icon: 'user' },
    { label: 'Role přístupu',        value: auth.accessRole || '-', tone: 'neutral', icon: 'info' },
  ];
}
