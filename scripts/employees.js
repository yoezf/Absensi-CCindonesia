/**
 * employees.js — Halaman Data Karyawan (Manager)
 * Letakkan di: static/js/employees.js
 *
 * Fix BUG-7: Profile karyawan tidak bisa diubah
 *   - getCsrfToken() membaca dari meta tag ATAU window.EMP_CONFIG
 *   - apiFetch() helper memastikan SEMUA request PUT/POST/DELETE
 *     menyertakan X-CSRFToken dan Content-Type: application/json
 *   - saveAkun() sekarang memeriksa resp.ok sebelum menampilkan
 *     toast sukses — tidak lagi false positive saat server error
 *   - Baris di tabel ikut terupdate nama, email, status tanpa reload
 */

"use strict";

/* ── Config dari Jinja (ditulis di <script> inline di HTML) ─── */
const _cfg = window.EMP_CONFIG || {};
const EMP_I18N = _cfg.i18n || {};

/* ── BUG-7 FIX: helper CSRF — baca meta tag ATAU EMP_CONFIG ─── */
function getCsrfToken() {
  // 1. Coba meta tag (direkomendasikan panduan)
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta && meta.getAttribute("content")) {
    return meta.getAttribute("content");
  }
  // 2. Fallback ke config yang dirender Jinja
  if (_cfg.csrf) return _cfg.csrf;
  // 3. Coba hidden input jika ada
  const inp = document.querySelector('input[name="csrf_token"]');
  if (inp) return inp.value;
  return "";
}

/* ── BUG-7 FIX: helper fetch dengan CSRF + JSON otomatis ─────── */
async function apiFetch(url, method, body) {
  const options = {
    method: method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCsrfToken(),
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(url, options);
}

/* ── State global modal detail ─────────────────────────────── */
let detUserId = null;
let detHasPico = false;

/* ══════════════════════════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════════════════════════ */
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.style.overflow = "";
  const err = document.querySelector("#" + id + " .form-error");
  if (err) {
    err.textContent = "";
    err.hidden = true;
  }
  document
    .querySelectorAll("#" + id + " .det-toast")
    .forEach((t) => t.remove());
}

document.querySelectorAll(".modal-overlay").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.target === el) closeModal(el.id);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document
      .querySelectorAll(".modal-overlay.open")
      .forEach((el) => closeModal(el.id));
});

/* ── Toggle password ────────────────────────────────────────── */
function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  const isText = inp.type === "text";
  inp.type = isText ? "password" : "text";
  btn.querySelector(".icon-eye").style.opacity = isText ? "1" : "0.4";
}

/* ── Loading helpers ────────────────────────────────────────── */
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector(".btn-label").hidden = loading;
  btn.querySelector(".btn-spinner").hidden = !loading;
}
function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
function hideError(elId) {
  const el = document.getElementById(elId);
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

/* ── Tab switching ──────────────────────────────────────────── */
function switchTab(btn, tabId) {
  if (!document.getElementById("det-loading").hidden) return;
  document
    .querySelectorAll(".det-tab")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".det-tab-panel").forEach((p) => (p.hidden = true));
  document.getElementById(tabId).hidden = false;
}

/* ── Toast di dalam modal ───────────────────────────────────── */
function showToast(msg, isError) {
  document.querySelectorAll(".det-toast").forEach((t) => t.remove());
  const box = document.querySelector("#modal-detail .modal-box");
  const toast = document.createElement("div");
  toast.className = "det-toast" + (isError ? " det-toast-error" : "");
  const icon = isError
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  toast.innerHTML = `${icon} ${msg}`;
  box.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ── Status toggle label ────────────────────────────────────── */
document.getElementById("det-active").addEventListener("change", function () {
  document.getElementById("det-toggle-text").textContent = this.checked
    ? EMP_I18N.activeLabel
    : EMP_I18N.inactiveLabel;
});

/* ══════════════════════════════════════════════════════════════
   OPEN DETAIL
══════════════════════════════════════════════════════════════ */
function openDetail(userId) {
  detUserId = userId;
  detHasPico = false;

  // Reset UI
  document.getElementById("det-loading").hidden = false;
  document.querySelectorAll(".det-tab-panel").forEach((p) => (p.hidden = true));
  document
    .querySelectorAll(".det-tab")
    .forEach((t) => t.classList.remove("active"));
  const firstTab = document.querySelector(".det-tab[data-tab='tab-akun']");
  if (firstTab) firstTab.classList.add("active");

  document.getElementById("det-avatar-text").textContent = "--";
  document.querySelector("#modal-detail-title").textContent = "…";
  document.getElementById("det-email-sub").textContent = "";

  openModal("modal-detail");

  fetch("/manager/employees/" + userId + "/detail")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((data) => {
      document.getElementById("det-loading").hidden = true;
      document.getElementById("tab-akun").hidden = false;

      try {
        const u = data.user;
        const pa = data.pico_account;
        const ba = data.bank_accounts;

        // Header
        const initials = u.full_name
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        document.getElementById("det-avatar-text").textContent = initials;
        document.querySelector("#modal-detail-title").textContent = u.full_name;
        document.getElementById("det-email-sub").textContent = u.email;

        // Read-only
        document.getElementById("det-user-id").textContent = u.id;
        document.getElementById("det-last-login").textContent =
          u.last_login_at || "—";
        document.getElementById("det-created-at").textContent =
          u.created_at || "—";
        document.getElementById("det-office").textContent = u.primary_office
          ? u.primary_office.name
          : "—";

        // Editable
        document.getElementById("det-full-name").value = u.full_name;
        // Email read-only — tampilkan sebagai teks, tidak dikirim saat save
        document.getElementById("det-email").textContent = u.email;
        document.getElementById("det-emp-code").value = u.employee_code || "";
        document.getElementById("det-dept").value = u.department || "";
        document.getElementById("det-phone").value = u.phone || "";

        const cb = document.getElementById("det-active");
        cb.checked = u.is_active;
        document.getElementById("det-toggle-text").textContent = u.is_active
          ? EMP_I18N.activeLabel
          : EMP_I18N.inactiveLabel;

        _fillPicoTab(pa);
        _fillRekeningTab(ba);
      } catch (e) {
        console.error("[openDetail] JS error:", e);
        document.getElementById("det-loading").hidden = true;
        document.getElementById("tab-akun").hidden = false;
        showError("det-akun-error", EMP_I18N.errConn);
      }
    })
    .catch((err) => {
      console.error("[openDetail] Fetch error:", err);
      document.getElementById("det-loading").hidden = true;
      document.getElementById("tab-akun").hidden = false;
      showError("det-akun-error", EMP_I18N.errConn);
    });
}

/* ══════════════════════════════════════════════════════════════
   SAVE AKUN  ← BUG-7 FIXED
   - apiFetch memastikan X-CSRFToken selalu disertakan
   - resp.ok WAJIB true sebelum tampilkan toast sukses
   - Baris tabel ikut diupdate nama/status tanpa page reload
══════════════════════════════════════════════════════════════ */
async function saveAkun() {
  hideError("det-akun-error");

  const name = document.getElementById("det-full-name").value.trim();
  // Email tidak dikirim ke backend (read-only by design — backend mengabaikannya)
  const empCode = document.getElementById("det-emp-code").value.trim() || null;
  const dept = document.getElementById("det-dept").value.trim() || null;
  const phone = document.getElementById("det-phone").value.trim() || null;
  const isActive = document.getElementById("det-active").checked;

  if (!name) {
    showError("det-akun-error", EMP_I18N.errNameEmpty);
    return;
  }

  setLoading("btn-det-akun-save", true);

  try {
    const resp = await apiFetch("/manager/employees/" + detUserId, "PUT", {
      full_name: name,
      employee_code: empCode,
      department: dept,
      phone,
      is_active: isActive,
    });

    const d = await resp.json();
    setLoading("btn-det-akun-save", false);

    if (resp.ok && d.status === "ok") {
      showToast(EMP_I18N.savedOk);

      // Update header modal
      document.querySelector("#modal-detail-title").textContent = name;
      const initials = name
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      document.getElementById("det-avatar-text").textContent = initials;

      // Update baris di tabel langsung (tanpa reload)
      _updateTableRow(detUserId, { full_name: name, is_active: isActive });
    } else {
      // Server menolak — tampilkan pesan error dari backend
      showError("det-akun-error", d.message || EMP_I18N.errSave);
      console.warn("[saveAkun] Server error:", d);
    }
  } catch (err) {
    setLoading("btn-det-akun-save", false);
    showError("det-akun-error", EMP_I18N.errConn);
    console.error("[saveAkun] Network error:", err);
  }
}

/* Helper: update baris tabel setelah simpan berhasil */
function _updateTableRow(userId, data) {
  const row = document.querySelector(`tr[data-user-id="${userId}"]`);
  if (!row) return;

  const nameEl = row.querySelector(".emp-fullname");
  if (nameEl) nameEl.textContent = data.full_name;

  // Update avatar inisial
  const avatarEl = row.querySelector(".emp-avatar");
  if (avatarEl) {
    const initials = data.full_name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    avatarEl.textContent = initials;
  }

  // Update status pill
  const pillEl = row.querySelector(".status-pill");
  if (pillEl) {
    if (data.is_active) {
      pillEl.className = "status-pill pill-present";
      pillEl.textContent = EMP_I18N.activeLabel;
      row.classList.remove("row-inactive");
    } else {
      pillEl.className = "status-pill pill-absent";
      pillEl.textContent = EMP_I18N.inactiveLabel;
      row.classList.add("row-inactive");
    }
  }

  // Update avatar class
  if (avatarEl) {
    if (data.is_active) avatarEl.classList.remove("avatar-inactive");
    else avatarEl.classList.add("avatar-inactive");
  }
}

/* ══════════════════════════════════════════════════════════════
   SAVE PICO
══════════════════════════════════════════════════════════════ */
async function savePico() {
  hideError("det-pico-error");

  const un = document.getElementById("det-pico-username").value.trim();
  if (!un) {
    showError("det-pico-error", "Username Pico wajib diisi.");
    return;
  }

  const payload = {
    pico_username: un,
    call_name:
      document.getElementById("det-pico-callname").value.trim() || null,
    gender: document.getElementById("det-pico-gender").value || null,
    height_cm: document.getElementById("det-pico-height").value || null,
    arm_length_cm: document.getElementById("det-pico-arm").value || null,
    leg_length_cm: document.getElementById("det-pico-leg").value || null,
    status: document.getElementById("det-pico-status").value,
    notes: document.getElementById("det-pico-notes").value.trim() || null,
  };

  setLoading("btn-det-pico-save", true);

  try {
    const resp = await apiFetch(
      "/manager/employees/" + detUserId + "/pico",
      "PUT",
      payload,
    );
    const d = await resp.json();
    setLoading("btn-det-pico-save", false);

    if (resp.ok && d.status === "ok") {
      showToast(detHasPico ? EMP_I18N.savedOk : EMP_I18N.picoCreated);
      if (!detHasPico) {
        detHasPico = true;
        document.getElementById("pico-empty-banner").hidden = true;
        document.getElementById("pico-username-hint").hidden = false;
        document.getElementById("btn-pico-label").textContent =
          EMP_I18N.savePicoLabel;
      }
    } else {
      showError("det-pico-error", d.message || EMP_I18N.errSave);
    }
  } catch (err) {
    setLoading("btn-det-pico-save", false);
    showError("det-pico-error", EMP_I18N.errConn);
    console.error("[savePico] Network error:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   TAMBAH KARYAWAN  (BUG-4: sertakan shift_id)
══════════════════════════════════════════════════════════════ */
async function submitAdd() {
  hideError("add-error");

  const name = document.getElementById("add-name").value.trim();
  const email = document.getElementById("add-email").value.trim();
  const pass = document.getElementById("add-password").value;
  const dept = document.getElementById("add-dept").value.trim();
  const phone = document.getElementById("add-phone").value.trim();
  const office = document.getElementById("add-office").value;
  const shift = document.getElementById("add-shift")?.value || null; // BUG-4

  if (!name || !email || !pass || !office) {
    showError("add-error", EMP_I18N.errRequired);
    return;
  }
  if (pass.length < 6) {
    showError("add-error", EMP_I18N.errMinPass);
    return;
  }

  const picoUsername = document
    .getElementById("add-pico-username")
    .value.trim();
  const body = {
    full_name: name,
    email,
    password: pass,
    department: dept || null,
    phone: phone || null,
    office_id: office,
    shift_id: shift || null, // BUG-4 fix
  };
  if (picoUsername) {
    body.pico_username = picoUsername;
    body.pico_call_name =
      document.getElementById("add-pico-callname").value.trim() || null;
    body.pico_gender = document.getElementById("add-pico-gender").value || null;
    body.pico_height_cm =
      document.getElementById("add-pico-height").value || null;
    body.pico_arm_length_cm =
      document.getElementById("add-pico-arm").value || null;
    body.pico_leg_length_cm =
      document.getElementById("add-pico-leg").value || null;
  }

  setLoading("btn-add-submit", true);

  try {
    const resp = await apiFetch("/manager/employees", "POST", body);
    const d = await resp.json();
    setLoading("btn-add-submit", false);

    if (resp.ok && d.status === "ok") {
      // BUG-4: tampilkan info shift yang di-assign
      if (d.shift_assigned) {
        alert(d.message + " Shift sudah di-assign.");
      }
      location.reload();
    } else {
      showError("add-error", d.message || EMP_I18N.errSave);
    }
  } catch (err) {
    setLoading("btn-add-submit", false);
    showError("add-error", EMP_I18N.errConn);
    console.error("[submitAdd] Network error:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   RESET PASSWORD
══════════════════════════════════════════════════════════════ */
function openReset(id, name) {
  document.getElementById("reset-id").value = id;
  document.getElementById("reset-name").textContent = name;
  document.getElementById("reset-password").value = "";
  hideError("reset-error");
  openModal("modal-reset");
}

async function submitReset() {
  const id = document.getElementById("reset-id").value;
  const pw = document.getElementById("reset-password").value;
  if (pw.length < 6) {
    showError("reset-error", EMP_I18N.errMinPass);
    return;
  }

  setLoading("btn-reset-submit", true);

  try {
    const resp = await apiFetch(
      "/manager/employees/" + id + "/reset-password",
      "POST",
      { new_password: pw },
    );
    const d = await resp.json();
    setLoading("btn-reset-submit", false);

    if (resp.ok && d.status === "ok") {
      closeModal("modal-reset");
      alert(EMP_I18N.resetOk);
    } else {
      showError("reset-error", d.message || EMP_I18N.errSave);
    }
  } catch (err) {
    setLoading("btn-reset-submit", false);
    showError("reset-error", EMP_I18N.errConn);
    console.error("[submitReset] Network error:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   NONAKTIFKAN
══════════════════════════════════════════════════════════════ */
function confirmDelete(id, name) {
  document.getElementById("delete-id").value = id;
  document.getElementById("delete-name").textContent = name;
  openModal("modal-delete");
}

async function submitDelete() {
  const id = document.getElementById("delete-id").value;
  setLoading("btn-delete-submit", true);

  try {
    const resp = await fetch("/manager/employees/" + id, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    setLoading("btn-delete-submit", false);
    if (resp.ok) location.reload();
  } catch (err) {
    setLoading("btn-delete-submit", false);
    console.error("[submitDelete] Network error:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   FILL HELPERS
══════════════════════════════════════════════════════════════ */
function _fillPicoTab(pa) {
  if (pa) {
    detHasPico = true;
    document.getElementById("pico-empty-banner").hidden = true;
    document.getElementById("det-pico-id").textContent = pa.id;
    document.getElementById("det-pico-device").textContent =
      pa.current_pico || "—";
    document.getElementById("det-pico-username").value = pa.pico_username;
    document.getElementById("pico-username-hint").hidden = false;
    document.getElementById("btn-pico-label").textContent =
      EMP_I18N.savePicoLabel;
    document.getElementById("det-pico-callname").value = pa.call_name || "";
    document.getElementById("det-pico-gender").value = pa.gender || "";
    document.getElementById("det-pico-height").value = pa.height_cm || "";
    document.getElementById("det-pico-arm").value = pa.arm_length_cm || "";
    document.getElementById("det-pico-leg").value = pa.leg_length_cm || "";
    document.getElementById("det-pico-status").value = pa.status;
    document.getElementById("det-pico-notes").value = pa.notes || "";
  } else {
    detHasPico = false;
    document.getElementById("pico-empty-banner").hidden = false;
    document.getElementById("det-pico-id").textContent = "—";
    document.getElementById("det-pico-device").textContent = "—";
    document.getElementById("det-pico-username").value = "";
    document.getElementById("pico-username-hint").hidden = true;
    document.getElementById("btn-pico-label").textContent =
      EMP_I18N.createPicoLabel;
    [
      "det-pico-callname",
      "det-pico-height",
      "det-pico-arm",
      "det-pico-leg",
      "det-pico-notes",
    ].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("det-pico-gender").value = "";
    document.getElementById("det-pico-status").value = "active";
  }
}

function _fillRekeningTab(accounts) {
  const wrap = document.getElementById("bank-list-wrap");
  const empty = document.getElementById("bank-empty-banner");
  wrap.innerHTML = "";

  if (!accounts || accounts.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const typeIcons = {
    bank: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    default: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
  };

  accounts.forEach((ba) => {
    const icon = typeIcons[ba.account_type] || typeIcons.default;
    const badges = [];
    if (ba.is_primary)
      badges.push(
        `<span class="bank-badge bank-badge-primary">${EMP_I18N.primaryLabel}</span>`,
      );
    if (ba.is_verified)
      badges.push(
        `<span class="bank-badge bank-badge-verified">${EMP_I18N.verifiedLabel}</span>`,
      );

    wrap.innerHTML += `
    <div class="bank-item">
      <div class="bank-item-icon" style="color:var(--brand)">${icon}</div>
      <div class="bank-item-body">
        <div class="bank-item-name">${ba.account_name}
          ${ba.bank_name ? `<span style="font-weight:400;color:var(--text-muted)"> · ${ba.bank_name}</span>` : ""}
        </div>
        <div class="bank-item-sub">${ba.type_label} · ${ba.masked_number}</div>
        ${badges.length ? `<div class="bank-item-badges">${badges.join("")}</div>` : ""}
      </div>
    </div>`;
  });
}
