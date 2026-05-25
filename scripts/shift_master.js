/* =============================================================================
   shift_master.js — Konfigurasi Shift (Manager)

   Catatan: SHIFT_DATA, SCHEDULER_INFO, CSRF_TOKEN dideklarasikan inline
   di shift_master.html sebelum tag <script src="..."> ini.

   BUG FIXES v2:
   1. parseInt(x) || default diganti _int(x, default) agar nilai 0 tidak
      ter-reset ke default.
   2. openEditModal() sekarang membaca checkin_open_before_minutes &
      checkout_grace_minutes dari shiftData (field sudah ada di dict server).
   3. submitEdit() mengambil checkin_window & checkout_window dari response
      server dan memperbarui kartu UI secara langsung.

   NEW v2:
   4. openAddModal / closeAddModal / submitAdd  → tambah shift baru
   5. deleteShift                               → hapus (soft-delete) shift
============================================================================= */

"use strict";

/* ── Safe parseInt helper ─────────────────────────────────────────────────── */
/**
 * Ambil nilai integer dari elemen input. Tidak pakai `|| default` supaya
 * nilai 0 tetap 0 (bukan kembali ke default).
 *
 * @param {string} id       - ID elemen input
 * @param {number} fallback - Nilai jika field kosong / NaN
 */
function _int(id, fallback) {
  const raw = parseInt(document.getElementById(id)?.value ?? "", 10);
  return Number.isNaN(raw) ? fallback : raw;
}

/* ── Color picker sync (bersama untuk edit & add) ─────────────────────────── */
function _bindColorPicker(pickerId, hexId) {
  const picker = document.getElementById(pickerId);
  const hex = document.getElementById(hexId);
  if (!picker || !hex) return;
  picker.addEventListener("input", () => {
    hex.value = picker.value;
  });
  hex.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  _bindColorPicker("edit-color", "edit-color-hex");
  _bindColorPicker("add-color", "add-color-hex");

  // Tutup modal saat klik luar
  ["modal-edit-shift", "modal-add-shift"].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
          if (id === "modal-edit-shift") closeEditModal();
          else closeAddModal();
        }
      });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   EDIT SHIFT
═══════════════════════════════════════════════════════════════════════════ */

let _editShiftId = null;
let _editShiftType = null;

/**
 * Buka modal edit dan isi semua field dari shiftData.
 * shiftData berasal dari `s | tojson` di template — dict ini kini sudah
 * menyertakan checkin_open_before_minutes & checkout_grace_minutes.
 *
 * @param {string} shiftId
 * @param {Object} shiftData
 */
function openEditModal(shiftId, shiftData) {
  _editShiftId = shiftId;
  _editShiftType = shiftData.shift_type;

  document.getElementById("modal-edit-title").textContent =
    "Edit: " + shiftData.name;

  document.getElementById("edit-name").value = shiftData.name || "";
  document.getElementById("edit-work-start").value = shiftData.work_start || "";
  document.getElementById("edit-work-end").value = shiftData.work_end || "";
  document.getElementById("edit-cutoff").value = shiftData.cutoff_time || "";
  document.getElementById("edit-color").value =
    shiftData.color_hex || "#4f6ef7";
  document.getElementById("edit-color-hex").value =
    shiftData.color_hex || "#4f6ef7";
  document.getElementById("edit-crosses-midnight").checked =
    !!shiftData.crosses_midnight;

  // ── BUGFIX: field ini sebelumnya hilang dari dict → selalu jadi 120 ──────
  document.getElementById("edit-tolerance").value =
    shiftData.late_tolerance_minutes ?? 15;
  document.getElementById("edit-checkin-open-before").value =
    shiftData.checkin_open_before_minutes ?? 120;
  document.getElementById("edit-checkout-grace").value =
    shiftData.checkout_grace_minutes ?? 120;
  // ─────────────────────────────────────────────────────────────────────────

  document.getElementById("edit-error").style.display = "none";
  document.getElementById("modal-edit-shift").style.display = "flex";
}

function closeEditModal() {
  document.getElementById("modal-edit-shift").style.display = "none";
  _editShiftId = null;
}

async function submitEdit() {
  if (!_editShiftId) return;

  const errEl = document.getElementById("edit-error");
  const spinEl = document.getElementById("edit-spin");
  const btnEl = document.getElementById("btn-edit-submit");

  errEl.style.display = "none";
  spinEl.style.display = "inline";
  btnEl.disabled = true;

  const body = {
    name: (document.getElementById("edit-name").value || "").trim(),
    work_start: document.getElementById("edit-work-start").value,
    work_end: document.getElementById("edit-work-end").value,
    cutoff_time: document.getElementById("edit-cutoff").value,
    color_hex: (
      document.getElementById("edit-color-hex").value || "#4f6ef7"
    ).trim(),
    crosses_midnight: document.getElementById("edit-crosses-midnight").checked,

    // ── BUGFIX: gunakan _int() bukan parseInt() || default ─────────────────
    late_tolerance_minutes: _int("edit-tolerance", 15),
    checkin_open_before_minutes: _int("edit-checkin-open-before", 120),
    checkout_grace_minutes: _int("edit-checkout-grace", 120),
    // ──────────────────────────────────────────────────────────────────────
  };

  try {
    const res = await fetch(`/manager/shifts/${_editShiftId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": CSRF_TOKEN,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || "Terjadi kesalahan.";
      errEl.style.display = "block";
      return;
    }

    // ── Update kartu UI tanpa reload halaman ─────────────────────────────
    const sid = _editShiftId;
    const el = (id) => document.getElementById(`${id}-${sid}`);

    if (el("val-range"))
      el("val-range").textContent =
        body.work_start +
        " – " +
        body.work_end +
        (body.crosses_midnight ? " +1" : "");

    if (el("val-cutoff")) el("val-cutoff").textContent = body.cutoff_time;

    if (el("val-tol"))
      el("val-tol").textContent = body.late_tolerance_minutes + " mnt";

    // ── BUGFIX: update window labels dari response server ─────────────────
    if (el("val-checkin-window") && data.checkin_window)
      el("val-checkin-window").textContent = data.checkin_window;

    if (el("val-checkout-window") && data.checkout_window)
      el("val-checkout-window").textContent = data.checkout_window;
    // ──────────────────────────────────────────────────────────────────────

    // Perbarui aksen warna kartu
    const card = document.getElementById(`card-${sid}`);
    if (card) {
      const accent = card.querySelector(".sm-shift-card-accent");
      if (accent) accent.style.background = body.color_hex;
    }

    // Perbarui chip scheduler di banner
    if (data.rescheduled && _editShiftType) {
      const chip = document.getElementById(
        `chip-auto_absent_${_editShiftType}`,
      );
      if (chip) chip.querySelector("strong").textContent = data.new_cutoff;
    }

    // Perbarui shiftData internal agar modal berikutnya pre-fill benar
    _syncShiftDataCache(sid, body);

    showToast("✓ " + (data.message || "Shift berhasil diperbarui."), "success");
    closeEditModal();
  } catch {
    errEl.textContent = "Koneksi gagal. Coba lagi.";
    errEl.style.display = "block";
  } finally {
    spinEl.style.display = "none";
    btnEl.disabled = false;
  }
}

/**
 * Perbarui entry SHIFT_DATA di memori sehingga openEditModal() berikutnya
 * mendapat nilai terbaru (tanpa reload halaman).
 */
function _syncShiftDataCache(shiftId, body) {
  for (const s of SHIFT_DATA) {
    if (s.id === shiftId) {
      s.name = body.name;
      s.work_start = body.work_start;
      s.work_end = body.work_end;
      s.cutoff_time = body.cutoff_time;
      s.late_tolerance_minutes = body.late_tolerance_minutes;
      s.checkin_open_before_minutes = body.checkin_open_before_minutes;
      s.checkout_grace_minutes = body.checkout_grace_minutes;
      s.color_hex = body.color_hex;
      s.crosses_midnight = body.crosses_midnight;
      break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAMBAH SHIFT (baru)
═══════════════════════════════════════════════════════════════════════════ */

function openAddModal() {
  // Reset form
  ["add-name", "add-work-start", "add-work-end", "add-cutoff"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("add-shift-type").value = "";
  document.getElementById("add-tolerance").value = "15";
  document.getElementById("add-checkin-open-before").value = "120";
  document.getElementById("add-checkout-grace").value = "120";
  document.getElementById("add-color").value = "#4f6ef7";
  document.getElementById("add-color-hex").value = "#4f6ef7";
  document.getElementById("add-crosses-midnight").checked = false;
  document.getElementById("add-error").style.display = "none";

  document.getElementById("modal-add-shift").style.display = "flex";
}

function closeAddModal() {
  document.getElementById("modal-add-shift").style.display = "none";
}

async function submitAdd() {
  const errEl = document.getElementById("add-error");
  const spinEl = document.getElementById("add-spin");
  const btnEl = document.getElementById("btn-add-submit");

  errEl.style.display = "none";
  spinEl.style.display = "inline";
  btnEl.disabled = true;

  const body = {
    shift_type: document.getElementById("add-shift-type").value,
    name: (document.getElementById("add-name").value || "").trim(),
    work_start: document.getElementById("add-work-start").value,
    work_end: document.getElementById("add-work-end").value,
    cutoff_time: document.getElementById("add-cutoff").value,
    color_hex: (
      document.getElementById("add-color-hex").value || "#4f6ef7"
    ).trim(),
    crosses_midnight: document.getElementById("add-crosses-midnight").checked,

    // Gunakan _int() agar nilai 0 tidak di-replace fallback
    late_tolerance_minutes: _int("add-tolerance", 15),
    checkin_open_before_minutes: _int("add-checkin-open-before", 120),
    checkout_grace_minutes: _int("add-checkout-grace", 120),
  };

  // Validasi minimal di client (server juga validasi)
  if (!body.shift_type) {
    errEl.textContent = "Pilih tipe shift terlebih dahulu.";
    errEl.style.display = "block";
    spinEl.style.display = "none";
    btnEl.disabled = false;
    return;
  }

  try {
    const res = await fetch("/manager/shifts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": CSRF_TOKEN,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || "Terjadi kesalahan.";
      errEl.style.display = "block";
      return;
    }

    showToast(
      "✓ " + (data.message || "Shift berhasil ditambahkan."),
      "success",
    );
    closeAddModal();

    // Reload halaman agar kartu baru tampil (lebih aman dari DOM manipulation)
    setTimeout(() => location.reload(), 900);
  } catch {
    errEl.textContent = "Koneksi gagal. Coba lagi.";
    errEl.style.display = "block";
  } finally {
    spinEl.style.display = "none";
    btnEl.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HAPUS SHIFT (baru)
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Soft-delete shift. Semua shift dengan shift_type yang sama di semua kantor
 * akan di-nonaktifkan di server.
 *
 * @param {string} shiftId
 * @param {string} shiftName  - Untuk konfirmasi dialog
 * @param {string} shiftType  - Untuk konfirmasi dialog
 */
async function deleteShift(shiftId, shiftName, shiftType) {
  const confirmed = confirm(
    `Hapus shift "${shiftName}" (${shiftType})?\n\n` +
      `Perubahan ini akan memengaruhi semua kantor. ` +
      `Shift yang sudah dihapus tidak akan tersedia untuk jadwal baru.\n\n` +
      `Lanjutkan?`,
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/manager/shifts/${shiftId}`, {
      method: "DELETE",
      headers: { "X-CSRFToken": CSRF_TOKEN },
    });
    const data = await res.json();

    if (!res.ok) {
      showToast("✗ " + (data.message || "Gagal menghapus shift."), "error");
      return;
    }

    showToast("✓ " + (data.message || "Shift berhasil dihapus."), "success");

    // Hapus kartu dari DOM
    const card = document.getElementById(`card-${shiftId}`);
    if (card) {
      card.style.transition = "opacity 0.3s, transform 0.3s";
      card.style.opacity = "0";
      card.style.transform = "scale(0.95)";
      setTimeout(() => {
        card.remove();
        // Hapus chip scheduler di banner jika ada
        const chip = document.getElementById(`chip-auto_absent_${shiftType}`);
        if (chip) chip.remove();
      }, 320);
    }
  } catch {
    showToast("✗ Koneksi gagal. Coba lagi.", "error");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════════════════ */

function showToast(msg, type = "") {
  const t = document.getElementById("sm-toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "sm-toast " + type;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
}
