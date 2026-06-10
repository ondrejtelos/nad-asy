const state = {
  data: null,
  token: localStorage.getItem("overtimeToken") || "",
  user: null,
  users: [],
  selectedTeacherId: "",
  search: ""
};

const $ = selector => document.querySelector(selector);
const els = {
  loginView: $("#loginView"),
  appView: $("#appView"),
  loginForm: $("#loginForm"),
  loginEmail: $("#loginEmail"),
  loginPassword: $("#loginPassword"),
  requestPasswordReset: $("#requestPasswordReset"),
  deploymentError: $("#deploymentError"),
  localHint: $("#localHint"),
  logoutButton: $("#logoutButton"),
  currentUserName: $("#currentUserName"),
  currentUserRole: $("#currentUserRole"),
  schoolEyebrow: $("#schoolEyebrow"),
  entryPanel: $("#entryPanel"),
  entryForm: $("#entryForm"),
  entryId: $("#entryId"),
  teacher: $("#teacher"),
  date: $("#date"),
  hours: $("#hours"),
  reason: $("#reason"),
  note: $("#note"),
  saveEntry: $("#saveEntry"),
  cancelEdit: $("#cancelEdit"),
  entriesBody: $("#entriesBody"),
  lockInfo: $("#lockInfo"),
  editContext: $("#editContext"),
  monthBadge: $("#monthBadge"),
  recordsTitle: $("#recordsTitle"),
  summary: $("#summary"),
  overtimeBalance: $("#overtimeBalance"),
  totalOvertime: $("#totalOvertime"),
  usedOvertime: $("#usedOvertime"),
  remainingOvertime: $("#remainingOvertime"),
  usageForm: $("#usageForm"),
  usageHours: $("#usageHours"),
  usageNote: $("#usageNote"),
  teacherFilterLabel: $("#teacherFilterLabel"),
  teacherFilter: $("#teacherFilter"),
  search: $("#search"),
  exportCsv: $("#exportCsv"),
  adminPanel: $("#adminPanel"),
  schoolName: $("#schoolName"),
  activeMonth: $("#activeMonth"),
  editFromDay: $("#editFromDay"),
  editUntilDay: $("#editUntilDay"),
  saveSettings: $("#saveSettings"),
  newMonth: $("#newMonth"),
  userForm: $("#userForm"),
  newUserName: $("#newUserName"),
  newUserEmail: $("#newUserEmail"),
  newUserPassword: $("#newUserPassword"),
  newUserRole: $("#newUserRole"),
  usersList: $("#usersList"),
  csvDialog: $("#csvDialog"),
  csvPreview: $("#csvPreview"),
  closeCsvDialog: $("#closeCsvDialog"),
  copyCsv: $("#copyCsv"),
  downloadCsv: $("#downloadCsv"),
  passwordDialog: $("#passwordDialog"),
  passwordDialogText: $("#passwordDialogText"),
  passwordForm: $("#passwordForm"),
  newPassword: $("#newPassword"),
  confirmPassword: $("#confirmPassword"),
  adminResetDialog: $("#adminResetDialog"),
  adminResetText: $("#adminResetText"),
  adminResetForm: $("#adminResetForm"),
  resetUserId: $("#resetUserId"),
  temporaryPassword: $("#temporaryPassword"),
  closeAdminReset: $("#closeAdminReset"),
  editUserDialog: $("#editUserDialog"),
  editUserForm: $("#editUserForm"),
  editUserId: $("#editUserId"),
  editUserName: $("#editUserName"),
  editUserEmail: $("#editUserEmail"),
  editUserRole: $("#editUserRole"),
  closeEditUser: $("#closeEditUser"),
  toast: $("#toast")
};

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error("Aplikácia sa nevie spojiť so serverom.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") showLogin();
    throw new Error(payload.error || "Požiadavka zlyhala.");
  }
  return payload;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function showLogin() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("overtimeToken");
  els.loginView.hidden = false;
  els.appView.hidden = true;
}

function showApp() {
  els.loginView.hidden = true;
  els.appView.hidden = false;
}

function showPasswordChange() {
  els.loginView.hidden = true;
  els.appView.hidden = true;
  els.passwordDialogText.textContent = state.user?.mustChangePassword
    ? "Pri prvom prihlásení alebo po resete si nastavte vlastné heslo."
    : "Nastavte si nové heslo.";
  if (!els.passwordDialog.open) els.passwordDialog.showModal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

function todayForActiveMonth() {
  const activeMonth = state.data?.settings.activeMonth;
  if (!activeMonth) return "";
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return activeMonth === month ? now.toISOString().slice(0, 10) : `${activeMonth}-01`;
}

function lastDayForActiveMonth() {
  const activeMonth = state.data?.settings.activeMonth;
  if (!activeMonth) return "";
  const [year, month] = activeMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${activeMonth}-${String(lastDay).padStart(2, "0")}`;
}

function filteredEntries() {
  const query = state.search.toLowerCase();
  return state.data.entries
    .filter(entry => entry.month === state.data.settings.activeMonth)
    .filter(entry => state.user.role !== "admin" ||
      (state.selectedTeacherId && entry.userId === state.selectedTeacherId))
    .filter(entry => !query || [entry.teacher, entry.reason, entry.note, entry.date]
      .some(value => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.teacher.localeCompare(b.teacher));
}

function canEdit(entry) {
  return state.user.role === "admin" ||
    (state.data.permissions.teacherEditOpen && entry.userId === state.user.id);
}

function roleLabel(role) {
  if (role === "admin") return "Administrátor";
  if (role === "thp") return "THP zamestnanec";
  if (role === "educator") return "Vychovávateľka";
  if (role === "special_pedagogue") return "Špeciálny pedagóg";
  if (role === "assistant") return "Asistentka";
  return "Učiteľ";
}

function selectedUsage() {
  const userId = state.user?.role === "admin" ? state.selectedTeacherId : state.user?.id;
  if (!userId || !state.data?.usages) return null;
  return state.data.usages.find(usage =>
    usage.userId === userId &&
    usage.month === state.data.settings.activeMonth
  ) || null;
}

function formatHours(value) {
  return `${Number(value || 0).toLocaleString("sk-SK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} h`;
}

function render() {
  if (!state.data) return;
  const { settings, permissions } = state.data;
  const isAdmin = state.user.role === "admin";
  els.currentUserName.textContent = state.user.name;
  els.currentUserRole.textContent = roleLabel(state.user.role);
  els.teacher.value = state.user.name;
  els.schoolEyebrow.textContent = settings.schoolName ||
    "Spojená škola, Ružínska ulica 210/22, Kysak";
  els.adminPanel.hidden = !isAdmin;
  els.teacherFilterLabel.hidden = !isAdmin;
  els.recordsTitle.textContent = isAdmin
    ? (state.selectedTeacherId ? "Záznamy vybraného zamestnanca" : "Vyberte zamestnanca")
    : "Moje záznamy";
  els.monthBadge.textContent = `Mesiac ${formatMonth(settings.activeMonth)}`;
  els.lockInfo.textContent = permissions.teacherEditOpen
    ? `Zadávanie je otvorené od ${settings.editFromDay}. do ${settings.editUntilDay}. dňa v mesiaci.`
    : `Zadávanie pre zamestnancov je zatvorené. Zmeny môže robiť administrátor.`;
  els.schoolName.value = settings.schoolName || "";
  els.activeMonth.value = settings.activeMonth;
  els.editFromDay.value = settings.editFromDay || 5;
  els.editUntilDay.value = settings.editUntilDay || 29;
  els.date.min = `${settings.activeMonth}-01`;
  els.date.max = lastDayForActiveMonth();
  els.saveEntry.disabled = !isAdmin && !permissions.teacherEditOpen;

  const rows = filteredEntries();
  const total = rows.reduce((sum, entry) => sum + Number(entry.hours), 0);
  const usage = selectedUsage();
  const used = Number(usage?.hours || 0);
  const remaining = total - used;
  els.overtimeBalance.hidden = isAdmin ? !state.selectedTeacherId : false;
  els.usageForm.hidden = !isAdmin;
  els.totalOvertime.textContent = formatHours(total);
  els.usedOvertime.textContent = formatHours(used);
  els.remainingOvertime.textContent = formatHours(remaining);
  els.remainingOvertime.classList.toggle("negative", remaining < 0);
  els.usageHours.value = used;
  els.usageNote.value = usage?.note || "";
  els.summary.textContent = isAdmin && !state.selectedTeacherId
    ? "V rozbaľovacom zozname vyberte zamestnanca."
    : `${rows.length} záznamov, spolu ${total.toFixed(2)} hodín.`;
  els.entriesBody.innerHTML = rows.length
    ? rows.map(entry => `
      <tr>
        <td>${escapeHtml(entry.date)}</td>
        <td>${escapeHtml(entry.teacher)}</td>
        <td>${escapeHtml(entry.reason)}</td>
        <td><strong>${Number(entry.hours).toFixed(2)}</strong></td>
        <td>${escapeHtml(entry.note)}</td>
        <td>
          <span class="row-actions">
            <button type="button" data-edit="${entry.id}" ${canEdit(entry) ? "" : "disabled"}>Upraviť</button>
            <button class="danger" type="button" data-delete="${entry.id}" ${canEdit(entry) ? "" : "disabled"}>Zmazať</button>
          </span>
        </td>
      </tr>`).join("")
    : `<tr><td class="empty" colspan="6">${
        isAdmin && !state.selectedTeacherId
          ? "Najprv vyberte zamestnanca."
          : "Zatiaľ tu nie sú žiadne záznamy pre aktívny mesiac."
      }</td></tr>`;
}

async function loadUsers() {
  if (state.user?.role !== "admin") return;
  const users = await api("/api/users");
  state.users = users;
  const teachers = users.filter(user => user.role !== "admin");
  els.teacherFilter.innerHTML = `
    <option value="">Vyberte zamestnanca</option>
    ${teachers.map(user => `
      <option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} — ${roleLabel(user.role)}</option>
    `).join("")}
  `;
  if (teachers.some(user => user.id === state.selectedTeacherId)) {
    els.teacherFilter.value = state.selectedTeacherId;
  } else {
    state.selectedTeacherId = "";
  }
  els.usersList.innerHTML = `
    <h3>Používatelia</h3>
    ${users.map(user => `
      <div class="user-row">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(user.email)}</span>
          ${user.passwordResetRequested ? '<span class="reset-request">Žiada reset hesla</span>' : ""}
        </div>
        <div class="user-row-actions">
          <span class="role-badge">${roleLabel(user.role)}</span>
          ${user.role !== "admin"
            ? `
              <button type="button" data-edit-user="${escapeHtml(user.id)}">Upraviť účet</button>
              <button type="button" data-reset-user="${escapeHtml(user.id)}">Resetovať heslo</button>
              <button class="danger" type="button" data-delete-user="${escapeHtml(user.id)}">Zmazať účet</button>
            `
            : ""}
        </div>
      </div>`).join("")}
  `;
}

async function load() {
  state.data = await api("/api/state");
  state.user = state.data.user;
  if (state.user.mustChangePassword) {
    showPasswordChange();
    return;
  }
  if (!els.date.value) els.date.value = todayForActiveMonth();
  showApp();
  await loadUsers();
  render();
}

function resetForm() {
  els.entryForm.reset();
  els.teacher.value = state.user.name;
  els.date.value = todayForActiveMonth();
  els.entryId.value = "";
  els.saveEntry.textContent = "Uložiť záznam";
  els.cancelEdit.hidden = true;
  els.editContext.hidden = true;
  els.editContext.textContent = "";
  els.entryPanel.classList.remove("editing");
}

function entryFromForm() {
  return {
    date: els.date.value,
    hours: Number(els.hours.value),
    reason: els.reason.value,
    note: els.note.value,
    month: state.data.settings.activeMonth
  };
}

function selectReason(reason) {
  const exactOption = Array.from(els.reason.options)
    .find(option => option.value.toLocaleLowerCase("sk") === String(reason).toLocaleLowerCase("sk"));
  if (exactOption) {
    els.reason.value = exactOption.value;
    return;
  }
  const previousCustom = els.reason.querySelector("option[data-custom]");
  if (previousCustom) previousCustom.remove();
  const customOption = document.createElement("option");
  customOption.value = reason;
  customOption.textContent = reason;
  customOption.dataset.custom = "true";
  els.reason.appendChild(customOption);
  els.reason.value = reason;
}

function buildCsv() {
  const rows = filteredEntries();
  const selectedUser = state.user.role === "admin"
    ? state.users.find(user => user.id === state.selectedTeacherId)
    : state.user;
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    [quote("Škola"), quote(state.data.settings.schoolName)].join(";"),
    [quote("Zamestnanec"), quote(selectedUser?.name || "")].join(";"),
    [quote("Typ účtu"), quote(roleLabel(selectedUser?.role))].join(";"),
    [quote("Mesiac"), quote(formatMonth(state.data.settings.activeMonth))].join(";"),
    "",
    ["Dátum", "Zamestnanec", "Dôvod", "Hodiny", "Poznámka"].join(";"),
    ...rows.map(entry => [entry.date, entry.teacher, entry.reason, entry.hours, entry.note || ""]
      .map(quote).join(";"))
  ].join("\r\n");
}

function downloadCsvFile(csv) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const selectedUser = state.user.role === "admin"
    ? state.users.find(user => user.id === state.selectedTeacherId)
    : state.user;
  const safeName = String(selectedUser?.name || "zamestnanec")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  link.download = `nadcasy-${safeName}-${state.data.settings.activeMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: els.loginEmail.value,
        password: els.loginPassword.value
      })
    });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("overtimeToken", state.token);
    els.loginForm.reset();
    if (state.user.mustChangePassword) showPasswordChange();
    else await load();
  } catch (error) {
    toast(error.message);
  }
});

els.requestPasswordReset.addEventListener("click", async () => {
  const email = els.loginEmail.value.trim();
  if (!email) {
    toast("Najprv zadajte svoj e-mail.");
    els.loginEmail.focus();
    return;
  }
  try {
    const result = await api("/api/password-reset-request", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
});

els.passwordForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (els.newPassword.value !== els.confirmPassword.value) {
    toast("Heslá sa nezhodujú.");
    return;
  }
  try {
    await api("/api/password", {
      method: "PUT",
      body: JSON.stringify({ password: els.newPassword.value })
    });
    els.passwordForm.reset();
    els.passwordDialog.close();
    toast("Heslo bolo zmenené. Prihláste sa novým heslom.");
    showLogin();
  } catch (error) {
    toast(error.message);
  }
});

els.logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {}
  showLogin();
});

els.entryForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const id = els.entryId.value;
    await api(id ? `/api/entries/${id}` : "/api/entries", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(entryFromForm())
    });
    toast(id ? "Záznam bol upravený." : "Záznam bol uložený.");
    resetForm();
    await load();
  } catch (error) {
    toast(error.message);
  }
});

els.cancelEdit.addEventListener("click", resetForm);

els.entriesBody.addEventListener("click", async event => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) {
    const entry = state.data.entries.find(item => item.id === editId);
    if (!entry) return;
    if (els.csvDialog.open) els.csvDialog.close();
    els.entryId.value = entry.id;
    els.teacher.value = entry.teacher;
    els.date.value = entry.date;
    els.hours.value = entry.hours;
    selectReason(entry.reason);
    els.note.value = entry.note || "";
    els.saveEntry.textContent = "Uložiť úpravu";
    els.cancelEdit.hidden = false;
    els.editContext.textContent = `Upravujete záznam zamestnanca: ${entry.teacher}`;
    els.editContext.hidden = false;
    els.entryPanel.classList.add("editing");
    els.entryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => els.date.focus(), 350);
    toast("Záznam je otvorený na úpravu vo formulári hore.");
  }
  if (deleteId && confirm("Zmazať tento záznam?")) {
    try {
      await api(`/api/entries/${deleteId}`, { method: "DELETE" });
      toast("Záznam bol zmazaný.");
      await load();
    } catch (error) {
      toast(error.message);
    }
  }
});

els.saveSettings.addEventListener("click", async () => {
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        schoolName: els.schoolName.value,
        activeMonth: els.activeMonth.value,
        editFromDay: Number(els.editFromDay.value),
        editUntilDay: Number(els.editUntilDay.value)
      })
    });
    toast("Nastavenia boli uložené.");
    await load();
  } catch (error) {
    toast(error.message);
  }
});

els.newMonth.addEventListener("click", async () => {
  if (!confirm("Spustiť nový mesiac? Aktuálny mesiac zostane v histórii.")) return;
  try {
    await api("/api/admin/new-month", { method: "POST" });
    resetForm();
    toast("Nový mesiac je spustený.");
    await load();
  } catch (error) {
    toast(error.message);
  }
});

els.userForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: els.newUserName.value,
        email: els.newUserEmail.value,
        password: els.newUserPassword.value,
        role: els.newUserRole.value
      })
    });
    els.userForm.reset();
    toast("Používateľský účet bol vytvorený.");
    await loadUsers();
  } catch (error) {
    toast(error.message);
  }
});

els.usersList.addEventListener("click", event => {
  const editId = event.target.dataset.editUser;
  const resetId = event.target.dataset.resetUser;
  const deleteId = event.target.dataset.deleteUser;
  const userId = editId || resetId || deleteId;
  if (!userId) return;
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  if (editId) {
    els.editUserId.value = user.id;
    els.editUserName.value = user.name;
    els.editUserEmail.value = user.email;
    els.editUserRole.value = user.role;
    els.editUserDialog.showModal();
    return;
  }
  if (deleteId) {
    if (!confirm(`Naozaj zmazať účet ${user.name}? Zmažú sa aj všetky jeho záznamy a čerpanie.`)) {
      return;
    }
    api(`/api/users/${user.id}`, { method: "DELETE" })
      .then(async () => {
        if (state.selectedTeacherId === user.id) state.selectedTeacherId = "";
        toast("Účet bol zmazaný.");
        await load();
      })
      .catch(error => toast(error.message));
    return;
  }
  els.resetUserId.value = user.id;
  els.adminResetText.textContent = `Nastavujete dočasné heslo pre: ${user.name}`;
  els.temporaryPassword.value = "";
  els.adminResetDialog.showModal();
});

els.closeEditUser.addEventListener("click", () => els.editUserDialog.close());

els.editUserForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api(`/api/users/${els.editUserId.value}`, {
      method: "PUT",
      body: JSON.stringify({
        name: els.editUserName.value,
        email: els.editUserEmail.value,
        role: els.editUserRole.value
      })
    });
    els.editUserDialog.close();
    toast("Účet bol upravený.");
    await load();
  } catch (error) {
    toast(error.message);
  }
});

els.closeAdminReset.addEventListener("click", () => els.adminResetDialog.close());

els.adminResetForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api(`/api/users/${els.resetUserId.value}/password`, {
      method: "PUT",
      body: JSON.stringify({ password: els.temporaryPassword.value })
    });
    els.adminResetDialog.close();
    els.adminResetForm.reset();
    toast("Heslo bolo resetované. Používateľ si ho pri prihlásení zmení.");
    await loadUsers();
  } catch (error) {
    toast(error.message);
  }
});

els.search.addEventListener("input", () => {
  state.search = els.search.value;
  render();
});

els.teacherFilter.addEventListener("change", () => {
  state.selectedTeacherId = els.teacherFilter.value;
  render();
});

els.usageForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.selectedTeacherId) {
    toast("Najprv vyberte zamestnanca.");
    return;
  }
  try {
    await api("/api/usage", {
      method: "PUT",
      body: JSON.stringify({
        userId: state.selectedTeacherId,
        month: state.data.settings.activeMonth,
        hours: Number(els.usageHours.value),
        note: els.usageNote.value
      })
    });
    toast("Čerpanie bolo uložené.");
    await load();
  } catch (error) {
    toast(error.message);
  }
});

els.exportCsv.addEventListener("click", () => {
  if (state.user.role === "admin" && !state.selectedTeacherId) {
    toast("Najprv vyberte zamestnanca.");
    return;
  }
  const csv = buildCsv();
  els.csvPreview.value = csv;
  els.csvDialog.showModal();
  toast("CSV bolo pripravené.");
});

els.closeCsvDialog.addEventListener("click", () => els.csvDialog.close());

els.downloadCsv.addEventListener("click", () => {
  downloadCsvFile(els.csvPreview.value);
  toast("Sťahovanie CSV bolo spustené.");
});

els.copyCsv.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.csvPreview.value);
    toast("CSV bolo skopírované.");
  } catch {
    els.csvPreview.focus();
    els.csvPreview.select();
    document.execCommand("copy");
    toast("CSV bolo skopírované.");
  }
});

async function start() {
  try {
    const config = await api("/api/config");
    els.localHint.hidden = config.online;
    if (!config.databaseReady) {
      const missing = (config.missingVariables || []).join(", ");
      els.deploymentError.textContent =
        `Online databáza nie je nastavená. Na hostingu doplňte: ${missing}.`;
      els.deploymentError.hidden = false;
      els.loginForm.querySelector('button[type="submit"]').disabled = true;
      els.requestPasswordReset.disabled = true;
      showLogin();
      return;
    }
    els.deploymentError.hidden = true;
    if (state.token) {
      await load();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
    toast(error.message);
  }
}

start();
