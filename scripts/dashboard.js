/**
 * dashboard.js — Manager dashboard interactions
 * Depends on: window.APP (injected by dashboard.html)
 *
 * filterTable() mendukung 7 shift: shift_3, shift_1, management,
 * shift_4, shift_2, shift_5, shift_6 — filter status dan shift
 * diterapkan secara bersamaan (AND logic).
 *
 * CHANGELOG:
 *  BUG-5 FIX: updateCheckoutButton() — tombol checkout tidak pernah diblokir
 *             oleh window waktu; backend yang validasi.
 *  BUG-5b FIX: Revisi — checkout_too_early kini dihitung dari work_start shift,
 *              bukan hanya dari can_checkout. Tombol DISABLED saat checkout_too_early=true,
 *              sehingga frontend dan backend sinkron (keduanya blokir sebelum work_start).
 *  BUG-7 FIX: getCsrfToken() + apiFetch() helper — semua non-GET request
 *             kini otomatis menyertakan X-CSRFToken.
 *  BUG-9 FIX: updateCheckinButton() — tampilkan jam buka check-in dari
 *             active_shift.checkin_open_before_minutes.
 */

"use strict";

/* ── CSRF & API helpers (BUG-7 FIX) ──────────────────────────────────────── */

function getCsrfToken() {
  if (window.APP && window.APP.CSRF_TOKEN) return window.APP.CSRF_TOKEN;
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute("content");
  const input = document.querySelector('input[name="csrf_token"]');
  if (input) return input.value;
  return window.CSRF_TOKEN || "";
}

async function apiFetch(url, method, body) {
  const options = {
    method: method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCsrfToken(),
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetch(url, options);
}

/* ── Checkout button logic (BUG-5b FIX) ──────────────────────────────────── */

/**
 * updateCheckoutButton(ctx)
 *
 * BUG-5b FIX: Frontend dan backend harus sinkron.
 * - Jika checkout_too_early = true  → tombol DISABLED (belum waktunya, sebelum work_start)
 * - Jika can_checkout = true        → tombol AKTIF saat GPS fix
 * - Jika keduanya false             → sembunyikan
 *
 * Ini mencegah kasus jam 02:43 bisa klik checkout saat shift belum dimulai.
 *
 * @param {object} ctx
 *   ctx.today_log.check_in_at   {string|null}
 *   ctx.today_log.check_out_at  {string|null}
 *   ctx.can_checkout             {boolean}
 *   ctx.checkout_too_early       {boolean}
 *   ctx.checkout_open            {string}  "HH:MM" — jam checkout dibuka
 */
function updateCheckoutButton(ctx) {
  const btn = document.getElementById("btn-main");
  const note = document.getElementById("checkin-note");
  if (!btn) return;

  const log = ctx.today_log || {};
  const hasCheckin = !!log.check_in_at;
  const hasCheckout = !!log.check_out_at;

  if (!hasCheckin || hasCheckout) {
    // Tidak dalam state checkout → jangan ubah tombol (dihandle oleh Jinja state)
    return;
  }

  if (ctx.checkout_too_early) {
    // Terlalu awal → tombol DISABLED, tampilkan info jam buka
    btn.disabled = true;
    btn.classList.remove("btn-checkin-out");
    btn.classList.add("btn-checkin-out-early");
    if (ctx.checkout_open && note) {
      note.textContent = (
        window.APP.I18N.checkoutOpenAt ||
        "Check-out tersedia mulai pukul {time} WIB."
      ).replace("{time}", ctx.checkout_open);
    }
  } else if (ctx.can_checkout) {
    // Dalam window checkout → aktifkan (gps.js enable saat GPS fix)
    btn.disabled = false; // akan di-enable lagi oleh gps.js saat GPS fix, ini default
    btn.classList.remove("btn-checkin-out-early");
    btn.classList.add("btn-checkin-out");
    btn.title = "";
  } else {
    // Tidak ada log check-in yang valid
    btn.classList.add("d-none");
  }
}

/* ── Check-in button logic (BUG-9 FIX) ───────────────────────────────────── */

function updateCheckinButton(ctx) {
  const btn = document.getElementById("btn-main");
  const status = document.getElementById("checkin-note");
  if (!btn || !status) return;

  if (ctx.too_early) {
    btn.disabled = true;
    btn.classList.add("btn-checkin-done");
    btn.classList.remove("btn-checkin-in");

    if (ctx.active_shift) {
      const workStart = ctx.active_shift.work_start;
      const openMins = ctx.active_shift.checkin_open_before_minutes || 120;
      const [h, m] = workStart.split(":").map(Number);
      const totalMins = h * 60 + m - openMins;
      const openH = ((Math.floor(totalMins / 60) % 24) + 24) % 24;
      const openM = ((totalMins % 60) + 60) % 60;
      const openStr =
        String(openH).padStart(2, "0") + ":" + String(openM).padStart(2, "0");
      status.textContent = (
        window.APP.I18N.checkinOpenAt || "Check-in dibuka pukul {time} WIB"
      ).replace("{time}", openStr);
    }
  } else if (ctx.past_cutoff) {
    btn.disabled = true;
    btn.classList.add("btn-checkin-done");
    btn.classList.remove("btn-checkin-in");
    const cutoff = ctx.active_shift ? ctx.active_shift.cutoff : null;
    status.textContent = cutoff
      ? (
          window.APP.I18N.cutoffReachedAt ||
          "Absensi sudah ditutup (cutoff: {cutoff})"
        ).replace("{cutoff}", cutoff)
      : window.APP.I18N.checkInCutoffPassed ||
        "Batas waktu check-in telah terlewati.";
  } else {
    btn.classList.remove("btn-checkin-done");
    btn.classList.add("btn-checkin-in");
  }
}

/* ── Table filter ─────────────────────────────────────────────────────────── */

const _activeFilter = { status: "all", shift: "all" };

function filterTable(btn, value, dimension) {
  const dim = dimension || "status";
  _activeFilter[dim] = value;

  const groupId = dim === "shift" ? "filter-tabs-shift" : "filter-tabs-status";
  const group = document.getElementById(groupId);
  if (group) {
    const selector =
      dim === "shift"
        ? ".mgr-filter-tab--shift"
        : ".mgr-filter-tab:not(.mgr-filter-tab--shift)";
    group.querySelectorAll(selector).forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  }

  document
    .querySelectorAll("#attendance-table tbody tr[data-status]")
    .forEach((row) => {
      const statusMatch =
        _activeFilter.status === "all" ||
        row.dataset.status === _activeFilter.status;
      const shiftMatch =
        _activeFilter.shift === "all" ||
        row.dataset.shift === _activeFilter.shift;
      row.style.display = statusMatch && shiftMatch ? "" : "none";
    });

  _updateVisibleCount();
}

function _updateVisibleCount() {
  const counter = document.getElementById("table-visible-count");
  if (!counter) return;
  const visible = document.querySelectorAll(
    "#attendance-table tbody tr[data-status]:not([style*='display: none'])",
  ).length;
  counter.textContent = visible;
}

/* ── Leave review ─────────────────────────────────────────────────────────── */
function reviewLeave(id, action) {
  const I18N = window.APP.I18N;
  const msg = action === "approved" ? I18N.confirmApprove : I18N.confirmReject;
  if (!confirm(msg)) return;

  apiFetch("/manager/leaves/" + id + "/review", "POST", { action })
    .then((r) => r.json())
    .then((d) => {
      if (d.status !== "ok") return;
      const el = document.getElementById("leave-" + id);
      if (!el) return;
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 320);
    })
    .catch(() => alert(window.APP.I18N.requestError));
}

/* ── Notifications ────────────────────────────────────────────────────────── */

function markNotifRead(id) {
  apiFetch("/manager/notifications/read", "POST", { id }).catch(() => {});
  const el = document.getElementById("notif-" + id);
  if (!el) return;
  el.style.transition = "opacity .25s";
  el.style.opacity = "0";
  setTimeout(() => {
    el.remove();
    _syncNotifBadge();
  }, 270);
}

function markAllNotifRead() {
  apiFetch("/manager/notifications/read", "POST", {}).catch(() => {});
  // Support both IDs: "dash-notif-panel" (dashboard.html) and "notif-panel" (legacy)
  ["dash-notif-panel", "notif-panel"].forEach((panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.style.transition = "opacity .3s";
    panel.style.opacity = "0";
    setTimeout(() => panel.remove(), 320);
  });
}

function _syncNotifBadge() {
  const remaining = document.querySelectorAll(".dash-notif-item").length;
  document.querySelectorAll(".dash-notif-badge").forEach((badge) => {
    badge.textContent = remaining;
  });

  if (remaining === 0) {
    ["dash-notif-panel", "notif-panel"].forEach((panelId) => {
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.style.transition = "opacity .25s";
        panel.style.opacity = "0";
        setTimeout(() => panel.remove(), 270);
      }
    });
  }
}

/* ── Init: sinkronisasi state saat halaman load ────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  const state = window.CHECKIN_STATE;

  // Jika state in_early (sudah check-in tapi terlalu awal checkout),
  // updateCheckoutButton untuk memastikan tombol disabled dengan benar
  if (state === "in_early") {
    updateCheckoutButton({
      today_log: { check_in_at: true, check_out_at: null },
      can_checkout: false,
      checkout_too_early: true,
      checkout_open: window.CHECKOUT_OPEN || "",
    });
  }
});

/* eof */
