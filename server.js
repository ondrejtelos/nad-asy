const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BACKUP_SECRET = process.env.BACKUP_SECRET || "";
const ONLINE_MODE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const HOSTED_MODE = Boolean(
  process.env.RENDER ||
  process.env.VERCEL ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.NODE_ENV === "production"
);
const ALLOW_LOCAL_DATA = process.env.ALLOW_LOCAL_DATA === "true" || !HOSTED_MODE;
const DATABASE_REQUIRED = HOSTED_MODE && !ALLOW_LOCAL_DATA;
const DATABASE_READY = ONLINE_MODE || !DATABASE_REQUIRED;
const MISSING_DATABASE_VARIABLES = [
  ["SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY]
].filter(([, value]) => !value).map(([name]) => name);
const sessions = new Map();

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function defaultState() {
  return {
    settings: {
      activeMonth: currentMonth(),
      editFromDay: 5,
      editUntilDay: 29,
      schoolName: "Spojená škola, Ružínska ulica 210/22, Kysak"
    },
    users: [
      {
        id: "local-admin",
        email: "adminzskysak",
        name: "Administrátor",
        role: "admin",
        mustChangePassword: false,
        passwordResetRequested: false,
        passwordHash: hashPassword("Kysak@210")
      },
      {
        id: "local-teacher",
        email: "ucitel@skola.local",
        name: "Skúšobný učiteľ",
        role: "teacher",
        mustChangePassword: true,
        passwordResetRequested: false,
        passwordHash: hashPassword("ucitel123")
      }
    ],
    entries: [],
    usages: []
  };
}

function readState() {
  let state;
  if (!fs.existsSync(DATA_FILE)) {
    state = defaultState();
    writeState(state);
    return state;
  }
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    state = defaultState();
  }
  state.settings ||= defaultState().settings;
  state.entries ||= [];
  state.usages ||= [];
  if (!Array.isArray(state.users) || !state.users.length) {
    state.users = defaultState().users;
    writeState(state);
  } else {
    let changed = false;
    for (const user of state.users) {
      if (typeof user.mustChangePassword !== "boolean") {
        user.mustChangePassword = user.role !== "admin";
        changed = true;
      }
      if (typeof user.passwordResetRequested !== "boolean") {
        user.passwordResetRequested = false;
        changed = true;
      }
    }
    if (changed) writeState(state);
  }
  return state;
}

function writeState(state) {
  if (!ALLOW_LOCAL_DATA) {
    throw new Error("Lokálne súborové úložisko je na verejnom serveri zakázané.");
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10_000_000) {
        req.destroy();
        reject(new Error("Požiadavka je príliš veľká."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Neplatné dáta požiadavky."));
      }
    });
  });
}

function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function publicUser(user) {
  const appMetadata = user.app_metadata || {};
  const schoolRoles = ["teacher", "thp", "educator", "special_pedagogue", "assistant", "admin"];
  const role = appMetadata.role || (schoolRoles.includes(user.role) ? user.role : "teacher");
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.user_metadata?.full_name || user.email,
    role,
    mustChangePassword: Boolean(user.mustChangePassword ?? appMetadata.must_change_password),
    passwordResetRequested: Boolean(user.passwordResetRequested ?? appMetadata.password_reset_requested)
  };
}

function isTeacherEditOpen(settings) {
  const now = new Date();
  if (settings.activeMonth !== currentMonth()) return false;
  return now.getDate() >= Number(settings.editFromDay || 5) &&
    now.getDate() <= Number(settings.editUntilDay || 29);
}

function normalizeEntry(input, settings, user, existing = {}) {
  const date = cleanText(input.date || existing.date, 20);
  const hours = Number(input.hours ?? existing.hours);
  const reason = cleanText(input.reason || existing.reason, 240);
  const note = cleanText(input.note || existing.note, 240);
  const month = cleanText(input.month || existing.month || settings.activeMonth, 7);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Chýba platný dátum.");
  if (!date.startsWith(`${settings.activeMonth}-`)) {
    throw new Error("Dátum musí patriť do aktívneho mesiaca.");
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error("Počet hodín musí byť medzi 0 a 24.");
  }
  if (!reason) throw new Error("Chýba dôvod nadčasu.");
  if (month !== settings.activeMonth) throw new Error("Záznam patrí mimo aktívneho mesiaca.");

  return {
    ...existing,
    userId: existing.userId || user.id,
    teacher: existing.teacher || user.name,
    date,
    hours,
    reason,
    note,
    month,
    updatedAt: new Date().toISOString()
  };
}

async function supabaseFetch(pathname, options = {}, key = SUPABASE_SERVICE_ROLE_KEY) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.token || key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || "Chyba online databázy.");
  }
  return payload;
}

async function authenticate(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  if (ONLINE_MODE) {
    const user = await supabaseFetch("/auth/v1/user", { method: "GET", token }, SUPABASE_ANON_KEY);
    return publicUser(user);
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const current = readState().users.find(item => item.id === session.user.id);
  return current ? publicUser(current) : null;
}

async function requireUser(req, res) {
  try {
    const user = await authenticate(req);
    if (!user) {
      sendJson(res, 401, { error: "Prihlásenie vypršalo. Prihláste sa znova." });
      return null;
    }
    return user;
  } catch {
    sendJson(res, 401, { error: "Prihlásenie sa nepodarilo overiť." });
    return null;
  }
}

function requireAdmin(user, res) {
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Túto operáciu môže vykonať iba administrátor." });
    return false;
  }
  return true;
}

async function loadOnlineState(user) {
  const settingsRows = await supabaseFetch("/rest/v1/app_settings?id=eq.1&select=*", { method: "GET" });
  const settingsRow = settingsRows[0];
  if (!settingsRow) throw new Error("V Supabase chýba tabuľka nastavení.");
  const settings = {
    activeMonth: settingsRow.active_month,
    editFromDay: settingsRow.edit_from_day,
    editUntilDay: settingsRow.edit_until_day,
    schoolName: settingsRow.school_name
  };
  const filter = user.role === "admin" ? "" : `&user_id=eq.${encodeURIComponent(user.id)}`;
  const rows = await supabaseFetch(
    `/rest/v1/overtime_entries?select=*&order=work_date.asc${filter}`,
    { method: "GET" }
  );
  const usageFilter = user.role === "admin" ? "" : `&user_id=eq.${encodeURIComponent(user.id)}`;
  const usageRows = await supabaseFetch(
    `/rest/v1/overtime_usage?select=*${usageFilter}`,
    { method: "GET" }
  );
  return {
    settings,
    entries: rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      teacher: row.teacher_name,
      date: row.work_date,
      hours: Number(row.hours),
      reason: row.reason,
      note: row.note || "",
      month: row.month,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    usages: usageRows.map(row => ({
      id: row.id,
      userId: row.user_id,
      month: row.month,
      hours: Number(row.hours),
      note: row.note || "",
      updatedAt: row.updated_at
    }))
  };
}

async function loadStateForUser(user) {
  if (ONLINE_MODE) return loadOnlineState(user);
  const state = readState();
  const entries = user.role === "admin"
    ? state.entries
    : state.entries.filter(entry => entry.userId === user.id);
  const usages = user.role === "admin"
    ? state.usages
    : state.usages.filter(usage => usage.userId === user.id);
  return { settings: state.settings, entries, usages };
}

async function loadBackup() {
  if (ONLINE_MODE) {
    const usersResult = await supabaseFetch("/auth/v1/admin/users?page=1&per_page=1000", { method: "GET" });
    const state = await loadOnlineState({ role: "admin" });
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: "supabase",
      settings: state.settings,
      users: usersResult.users.map(publicUser),
      entries: state.entries,
      usages: state.usages
    };
  }

  const state = readState();
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "local",
    settings: state.settings,
    users: state.users.map(publicUser),
    entries: state.entries,
    usages: state.usages
  };
}

function validateBackup(backup) {
  if (!backup || backup.version !== 1 ||
      !Array.isArray(backup.users) ||
      !Array.isArray(backup.entries) ||
      !Array.isArray(backup.usages)) {
    throw new Error("Súbor nie je platná záloha aplikácie Nadčasy.");
  }
}

async function restoreBackupMerge(backup) {
  validateBackup(backup);

  if (ONLINE_MODE) {
    const currentUsersResult = await supabaseFetch(
      "/auth/v1/admin/users?page=1&per_page=1000",
      { method: "GET" }
    );
    const currentUsersByEmail = new Map(
      currentUsersResult.users.map(user => [String(user.email || "").toLowerCase(), user])
    );
    const userIdMap = new Map();
    const skippedAccounts = [];

    for (const backupUser of backup.users) {
      const currentUser = currentUsersByEmail.get(String(backupUser.email || "").toLowerCase());
      if (currentUser) {
        userIdMap.set(backupUser.id, currentUser.id);
      } else if (backupUser.role !== "admin") {
        skippedAccounts.push(backupUser.email || backupUser.name || backupUser.id);
      }
    }

    const entries = backup.entries.flatMap(entry => {
      const userId = userIdMap.get(entry.userId);
      if (!userId || !entry.id || !entry.date || !entry.month || Number(entry.hours) <= 0) return [];
      const currentUser = currentUsersResult.users.find(user => user.id === userId);
      return [{
        id: entry.id,
        user_id: userId,
        teacher_name: currentUser?.user_metadata?.full_name || entry.teacher || currentUser?.email,
        work_date: entry.date,
        hours: Number(entry.hours),
        reason: cleanText(entry.reason, 160),
        note: cleanText(entry.note, 500),
        month: entry.month,
        created_at: entry.createdAt || new Date().toISOString(),
        updated_at: entry.updatedAt || new Date().toISOString()
      }];
    });

    const usages = backup.usages.flatMap(usage => {
      const userId = userIdMap.get(usage.userId);
      if (!userId || !usage.month || Number(usage.hours) < 0) return [];
      return [{
        id: usage.id || crypto.randomUUID(),
        user_id: userId,
        month: usage.month,
        hours: Number(usage.hours),
        note: cleanText(usage.note, 500),
        updated_at: usage.updatedAt || new Date().toISOString()
      }];
    });

    if (entries.length) {
      await supabaseFetch("/rest/v1/overtime_entries?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(entries)
      });
    }
    if (usages.length) {
      await supabaseFetch("/rest/v1/overtime_usage?on_conflict=user_id,month", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(usages)
      });
    }

    return {
      mode: "merge",
      restoredEntries: entries.length,
      restoredUsages: usages.length,
      matchedAccounts: userIdMap.size,
      skippedAccounts
    };
  }

  const state = readState();
  const currentUsersByEmail = new Map(
    state.users.map(user => [String(user.email || "").toLowerCase(), user])
  );
  const userIdMap = new Map();
  const skippedAccounts = [];
  for (const backupUser of backup.users) {
    const currentUser = currentUsersByEmail.get(String(backupUser.email || "").toLowerCase());
    if (currentUser) userIdMap.set(backupUser.id, currentUser.id);
    else if (backupUser.role !== "admin") {
      skippedAccounts.push(backupUser.email || backupUser.name || backupUser.id);
    }
  }

  let restoredEntries = 0;
  for (const entry of backup.entries) {
    const userId = userIdMap.get(entry.userId);
    if (!userId || !entry.id) continue;
    const currentUser = state.users.find(user => user.id === userId);
    const restored = { ...entry, userId, teacher: currentUser?.name || entry.teacher };
    const index = state.entries.findIndex(item => item.id === restored.id);
    if (index >= 0) state.entries[index] = restored;
    else state.entries.push(restored);
    restoredEntries += 1;
  }

  let restoredUsages = 0;
  for (const usage of backup.usages) {
    const userId = userIdMap.get(usage.userId);
    if (!userId || !usage.month) continue;
    const restored = { ...usage, userId };
    const index = state.usages.findIndex(
      item => item.userId === userId && item.month === restored.month
    );
    if (index >= 0) state.usages[index] = restored;
    else state.usages.push(restored);
    restoredUsages += 1;
  }
  writeState(state);
  return {
    mode: "merge",
    restoredEntries,
    restoredUsages,
    matchedAccounts: userIdMap.size,
    skippedAccounts
  };
}

async function saveOnlineEntry(entry, id) {
  const body = {
    ...(id ? {} : { id: entry.id }),
    user_id: entry.userId,
    teacher_name: entry.teacher,
    work_date: entry.date,
    hours: entry.hours,
    reason: entry.reason,
    note: entry.note,
    month: entry.month,
    updated_at: entry.updatedAt
  };
  const pathName = id ? `/rest/v1/overtime_entries?id=eq.${id}` : "/rest/v1/overtime_entries";
  const rows = await supabaseFetch(pathName, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body)
  });
  return rows[0];
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const email = cleanText(body.email, 200).toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return sendJson(res, 400, { error: "Zadajte e-mail aj heslo." });

  if (ONLINE_MODE) {
    const loginEmail = email === "adminzskysak"
      ? "adminzskysak@skola.local"
      : email;
    const result = await supabaseFetch(
      "/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify({ email: loginEmail, password }) },
      SUPABASE_ANON_KEY
    );
    return sendJson(res, 200, {
      token: result.access_token,
      user: publicUser(result.user),
      online: true
    });
  }

  const local = readState().users.find(user => user.email.toLowerCase() === email);
  if (!local || !verifyPassword(password, local.passwordHash)) {
    return sendJson(res, 401, { error: "Nesprávny e-mail alebo heslo." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  const user = publicUser(local);
  sessions.set(token, { user, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return sendJson(res, 200, { token, user, online: false });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        online: ONLINE_MODE,
        hosted: HOSTED_MODE,
        databaseReady: DATABASE_READY,
        storage: ONLINE_MODE ? "supabase" : (ALLOW_LOCAL_DATA ? "local" : "unavailable"),
        missingVariables: MISSING_DATABASE_VARIABLES
      });
    }
    if (!DATABASE_READY) {
      return sendJson(res, 503, {
        error: "Online databáza nie je nastavená. Doplňte Supabase premenné na hostingu.",
        code: "DATABASE_NOT_CONFIGURED",
        missingVariables: MISSING_DATABASE_VARIABLES
      });
    }
    if (req.method === "GET" && url.pathname === "/api/backup") {
      const providedSecret = req.headers["x-backup-key"];
      if (!BACKUP_SECRET || !secureEqual(providedSecret, BACKUP_SECRET)) {
        return sendJson(res, 401, { error: "Neplatný kľúč zálohy." });
      }
      return sendJson(res, 200, await loadBackup());
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      return handleLogin(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/password-reset-request") {
      const body = await readBody(req);
      const email = cleanText(body.email, 200).toLowerCase();
      if (!email) return sendJson(res, 400, { error: "Zadajte e-mail účtu." });

      if (ONLINE_MODE) {
        const result = await supabaseFetch("/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
        const account = result.users.find(item => String(item.email).toLowerCase() === email);
        if (account) {
          await supabaseFetch(`/auth/v1/admin/users/${account.id}`, {
            method: "PUT",
            body: JSON.stringify({
              app_metadata: {
                ...(account.app_metadata || {}),
                password_reset_requested: true
              }
            })
          });
        }
      } else {
        const local = readState();
        const account = local.users.find(item => item.email.toLowerCase() === email);
        if (account) {
          account.passwordResetRequested = true;
          writeState(local);
        }
      }
      return sendJson(res, 200, {
        ok: true,
        message: "Ak účet existuje, administrátor uvidí žiadosť o reset hesla."
      });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = await loadStateForUser(user);
      return sendJson(res, 200, {
        ...state,
        user,
        permissions: {
          teacherEditOpen: isTeacherEditOpen(state.settings),
          activeMonth: state.settings.activeMonth
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/restore") {
      if (!requireAdmin(user, res)) return;
      const body = await readBody(req);
      return sendJson(res, 200, await restoreBackupMerge(body.backup || body));
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
      sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "PUT" && url.pathname === "/api/password") {
      const body = await readBody(req);
      const password = String(body.password || "");
      if (password.length < 8) {
        return sendJson(res, 400, { error: "Nové heslo musí mať aspoň 8 znakov." });
      }

      if (ONLINE_MODE) {
        const current = await supabaseFetch(`/auth/v1/admin/users/${user.id}`, { method: "GET" });
        await supabaseFetch(`/auth/v1/admin/users/${user.id}`, {
          method: "PUT",
          body: JSON.stringify({
            password,
            app_metadata: {
              ...(current.app_metadata || {}),
              must_change_password: false,
              password_reset_requested: false
            }
          })
        });
      } else {
        const local = readState();
        const account = local.users.find(item => item.id === user.id);
        if (!account) return sendJson(res, 404, { error: "Používateľ sa nenašiel." });
        account.passwordHash = hashPassword(password);
        account.mustChangePassword = false;
        account.passwordResetRequested = false;
        writeState(local);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      if (!requireAdmin(user, res)) return;
      if (ONLINE_MODE) {
        const result = await supabaseFetch("/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
        return sendJson(res, 200, result.users.map(publicUser));
      }
      return sendJson(res, 200, readState().users.map(publicUser));
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      if (!requireAdmin(user, res)) return;
      const body = await readBody(req);
      const email = cleanText(body.email, 200).toLowerCase();
      const name = cleanText(body.name, 100);
      const password = String(body.password || "");
      const allowedRoles = new Set([
        "teacher",
        "thp",
        "educator",
        "special_pedagogue",
        "assistant",
        "admin"
      ]);
      const role = allowedRoles.has(body.role) ? body.role : "teacher";
      if (!email.includes("@") || !name || password.length < 8) {
        return sendJson(res, 400, { error: "Zadajte meno, platný e-mail a heslo s aspoň 8 znakmi." });
      }

      if (ONLINE_MODE) {
        const created = await supabaseFetch("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: name },
            app_metadata: {
              role,
              must_change_password: true,
              password_reset_requested: false
            }
          })
        });
        return sendJson(res, 201, publicUser(created));
      }

      const state = readState();
      if (state.users.some(item => item.email.toLowerCase() === email)) {
        return sendJson(res, 409, { error: "Používateľ s týmto e-mailom už existuje." });
      }
      const created = {
        id: crypto.randomUUID(),
        email,
        name,
        role,
        mustChangePassword: true,
        passwordResetRequested: false,
        passwordHash: hashPassword(password)
      };
      state.users.push(created);
      writeState(state);
      return sendJson(res, 201, publicUser(created));
    }

    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && req.method === "PUT") {
      if (!requireAdmin(user, res)) return;
      const targetId = userMatch[1];
      if (targetId === user.id) {
        return sendJson(res, 400, { error: "Vlastný administrátorský účet tu nemožno upraviť." });
      }
      const body = await readBody(req);
      const email = cleanText(body.email, 200).toLowerCase();
      const name = cleanText(body.name, 100);
      const allowedRoles = new Set([
        "teacher",
        "thp",
        "educator",
        "special_pedagogue",
        "assistant"
      ]);
      const role = allowedRoles.has(body.role) ? body.role : "teacher";
      if (!email.includes("@") || !name) {
        return sendJson(res, 400, { error: "Zadajte meno a platnú e-mailovú adresu." });
      }

      if (ONLINE_MODE) {
        const target = await supabaseFetch(`/auth/v1/admin/users/${targetId}`, { method: "GET" });
        await supabaseFetch(`/auth/v1/admin/users/${targetId}`, {
          method: "PUT",
          body: JSON.stringify({
            email,
            email_confirm: true,
            user_metadata: {
              ...(target.user_metadata || {}),
              full_name: name
            },
            app_metadata: {
              ...(target.app_metadata || {}),
              role
            }
          })
        });
        await supabaseFetch(`/rest/v1/overtime_entries?user_id=eq.${targetId}`, {
          method: "PATCH",
          body: JSON.stringify({ teacher_name: name })
        });
      } else {
        const local = readState();
        const target = local.users.find(item => item.id === targetId);
        if (!target) return sendJson(res, 404, { error: "Používateľ sa nenašiel." });
        if (local.users.some(item => item.id !== targetId && item.email.toLowerCase() === email)) {
          return sendJson(res, 409, { error: "Používateľ s týmto e-mailom už existuje." });
        }
        target.name = name;
        target.email = email;
        target.role = role;
        for (const entry of local.entries) {
          if (entry.userId === targetId) entry.teacher = name;
        }
        writeState(local);
      }
      return sendJson(res, 200, { id: targetId, email, name, role });
    }

    if (userMatch && req.method === "DELETE") {
      if (!requireAdmin(user, res)) return;
      const targetId = userMatch[1];
      if (targetId === user.id) {
        return sendJson(res, 400, { error: "Vlastný administrátorský účet nemožno zmazať." });
      }

      if (ONLINE_MODE) {
        await supabaseFetch(`/auth/v1/admin/users/${targetId}`, {
          method: "DELETE",
          prefer: "return=minimal"
        });
      } else {
        const local = readState();
        const target = local.users.find(item => item.id === targetId);
        if (!target) return sendJson(res, 404, { error: "Používateľ sa nenašiel." });
        local.users = local.users.filter(item => item.id !== targetId);
        local.entries = local.entries.filter(item => item.userId !== targetId);
        local.usages = local.usages.filter(item => item.userId !== targetId);
        writeState(local);
      }
      return sendJson(res, 200, { ok: true });
    }

    const userPasswordMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
    if (req.method === "PUT" && userPasswordMatch) {
      if (!requireAdmin(user, res)) return;
      const body = await readBody(req);
      const password = String(body.password || "");
      if (password.length < 8) {
        return sendJson(res, 400, { error: "Dočasné heslo musí mať aspoň 8 znakov." });
      }
      const targetId = userPasswordMatch[1];

      if (ONLINE_MODE) {
        const target = await supabaseFetch(`/auth/v1/admin/users/${targetId}`, { method: "GET" });
        await supabaseFetch(`/auth/v1/admin/users/${targetId}`, {
          method: "PUT",
          body: JSON.stringify({
            password,
            app_metadata: {
              ...(target.app_metadata || {}),
              must_change_password: true,
              password_reset_requested: false
            }
          })
        });
      } else {
        const local = readState();
        const target = local.users.find(item => item.id === targetId);
        if (!target) return sendJson(res, 404, { error: "Používateľ sa nenašiel." });
        target.passwordHash = hashPassword(password);
        target.mustChangePassword = true;
        target.passwordResetRequested = false;
        writeState(local);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/entries") {
      const state = await loadStateForUser(user);
      if (user.role !== "admin" && !isTeacherEditOpen(state.settings)) {
        return sendJson(res, 403, { error: "Zadávanie pre učiteľov je teraz uzavreté." });
      }
      const entry = normalizeEntry(await readBody(req), state.settings, user);
      entry.id = crypto.randomUUID();
      entry.createdAt = new Date().toISOString();

      if (ONLINE_MODE) {
        await saveOnlineEntry(entry);
      } else {
        const local = readState();
        local.entries.push(entry);
        writeState(local);
      }
      return sendJson(res, 201, entry);
    }

    if (req.method === "PUT" && url.pathname === "/api/usage") {
      if (!requireAdmin(user, res)) return;
      const body = await readBody(req);
      const userId = cleanText(body.userId, 100);
      const month = cleanText(body.month, 7);
      const hours = Number(body.hours);
      const note = cleanText(body.note, 240);
      if (!userId || !/^\d{4}-\d{2}$/.test(month)) {
        return sendJson(res, 400, { error: "Vyberte učiteľa a platný mesiac." });
      }
      if (!Number.isFinite(hours) || hours < 0 || hours > 999) {
        return sendJson(res, 400, { error: "Čerpanie musí byť číslo od 0 do 999 hodín." });
      }
      const state = await loadStateForUser(user);
      const teacher = ONLINE_MODE
        ? null
        : readState().users.find(item => item.id === userId && item.role !== "admin");
      if (!ONLINE_MODE && !teacher) {
        return sendJson(res, 404, { error: "Učiteľ sa nenašiel." });
      }
      const existing = state.usages.find(item => item.userId === userId && item.month === month);
      const usage = {
        id: existing?.id || crypto.randomUUID(),
        userId,
        month,
        hours,
        note,
        updatedAt: new Date().toISOString()
      };

      if (ONLINE_MODE) {
        await supabaseFetch("/rest/v1/overtime_usage?on_conflict=user_id,month", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=representation",
          body: JSON.stringify({
            id: usage.id,
            user_id: usage.userId,
            month: usage.month,
            hours: usage.hours,
            note: usage.note,
            updated_at: usage.updatedAt
          })
        });
      } else {
        const local = readState();
        const index = local.usages.findIndex(item => item.userId === userId && item.month === month);
        if (index >= 0) local.usages[index] = usage;
        else local.usages.push(usage);
        writeState(local);
      }
      return sendJson(res, 200, usage);
    }

    const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
    if (entryMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const state = await loadStateForUser(user);
      const existing = state.entries.find(item => item.id === entryMatch[1]);
      if (!existing) return sendJson(res, 404, { error: "Záznam sa nenašiel." });
      if (user.role !== "admin" && existing.userId !== user.id) {
        return sendJson(res, 403, { error: "Môžete upravovať iba svoje záznamy." });
      }
      if (user.role !== "admin" && !isTeacherEditOpen(state.settings)) {
        return sendJson(res, 403, { error: "Úpravy pre učiteľov sú teraz uzavreté." });
      }

      if (req.method === "DELETE") {
        if (ONLINE_MODE) {
          await supabaseFetch(`/rest/v1/overtime_entries?id=eq.${entryMatch[1]}`, {
            method: "DELETE",
            prefer: "return=minimal"
          });
        } else {
          const local = readState();
          local.entries = local.entries.filter(item => item.id !== entryMatch[1]);
          writeState(local);
        }
        return sendJson(res, 200, existing);
      }

      const owner = { id: existing.userId, name: existing.teacher };
      const updated = normalizeEntry(await readBody(req), state.settings, owner, existing);
      if (ONLINE_MODE) {
        await saveOnlineEntry(updated, entryMatch[1]);
      } else {
        const local = readState();
        const index = local.entries.findIndex(item => item.id === entryMatch[1]);
        local.entries[index] = updated;
        writeState(local);
      }
      return sendJson(res, 200, updated);
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      if (!requireAdmin(user, res)) return;
      const body = await readBody(req);
      const editFromDay = Number(body.editFromDay);
      const editUntilDay = Number(body.editUntilDay);
      if (!Number.isInteger(editFromDay) || editFromDay < 1 || editFromDay > 31 ||
          !Number.isInteger(editUntilDay) || editUntilDay < 1 || editUntilDay > 31 ||
          editFromDay > editUntilDay) {
        return sendJson(res, 400, { error: "Skontrolujte dni odblokovania a uzávierky." });
      }
      const settings = {
        schoolName: cleanText(body.schoolName, 160) ||
          "Spojená škola, Ružínska ulica 210/22, Kysak",
        activeMonth: /^\d{4}-\d{2}$/.test(body.activeMonth) ? body.activeMonth : currentMonth(),
        editFromDay,
        editUntilDay
      };

      if (ONLINE_MODE) {
        await supabaseFetch("/rest/v1/app_settings?id=eq.1", {
          method: "PATCH",
          body: JSON.stringify({
            school_name: settings.schoolName,
            active_month: settings.activeMonth,
            edit_from_day: settings.editFromDay,
            edit_until_day: settings.editUntilDay,
            updated_at: new Date().toISOString()
          })
        });
      } else {
        const local = readState();
        local.settings = settings;
        writeState(local);
      }
      return sendJson(res, 200, settings);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/new-month") {
      if (!requireAdmin(user, res)) return;
      const state = await loadStateForUser(user);
      const [year, month] = state.settings.activeMonth.split("-").map(Number);
      const next = new Date(year, month, 1);
      const activeMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
      if (ONLINE_MODE) {
        await supabaseFetch("/rest/v1/app_settings?id=eq.1", {
          method: "PATCH",
          body: JSON.stringify({ active_month: activeMonth, updated_at: new Date().toISOString() })
        });
      } else {
        const local = readState();
        local.settings.activeMonth = activeMonth;
        writeState(local);
      }
      return sendJson(res, 200, { ...state.settings, activeMonth });
    }

    return sendJson(res, 404, { error: "Neznáma požiadavka." });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Chyba požiadavky." });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveFile(req, res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nadčasová práca učiteľov: http://localhost:${PORT}`);
  console.log(ONLINE_MODE ? "Režim: Supabase online" : "Režim: lokálne skúšanie");
});
