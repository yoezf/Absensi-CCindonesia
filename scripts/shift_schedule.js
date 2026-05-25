/* =============================================================================
   shift_schedule.js — Jadwal Shift (Manager)

   Load SETELAH data JSON diinject oleh template:
     <script>
       const EMP_DATA         = {{ emp_data         | tojson }};
       const SHIFTS_BY_OFFICE = {{ shifts_by_office | tojson }};
       const ALL_OFFICES      = {{ all_offices_json | tojson }};   ← tambah di route
       const CSRF_TOKEN       = document.querySelector('meta[name="csrf-token"]').content;
     </script>
     <script src="{{ url_for('static', filename='js/shift_schedule.js') }}"></script>
   ============================================================================= */

// ─── State ────────────────────────────────────────────────────────────────────
let _activeOffice = "";
let _activeShift = ""; // filter kartu shift
let _setEmp = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Baca filter office awal dari dataset halaman
  _activeOffice =
    document.getElementById("shift-page-root")?.dataset.filterOffice || "";

  _renderStatCards();
  updateStats(_activeOffice);
  updateVisibleCount();

  // Filter tabs
  document.querySelectorAll(".tab[data-office]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab[data-office]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filterTable(btn.dataset.office);
    });
  });

  // "Atur Periode" buttons (individual)
  document.querySelectorAll(".btn-set-period").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = JSON.parse(btn.dataset.emp);
      openSetModal(emp);
    });
  });

  // "Tukar Shift" button
  document
    .getElementById("btn-open-swap")
    ?.addEventListener("click", openSwapModal);

  // "Bulk Assign" button
  document
    .getElementById("btn-open-bulk")
    ?.addEventListener("click", openBulkModal);

  // Modal close buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  // Swap date range listeners
  document.getElementById("swap-start-date")?.addEventListener("change", () => {
    const startVal = document.getElementById("swap-start-date").value;
    const endEl = document.getElementById("swap-end-date");
    if (endEl) endEl.min = startVal;
    if (endEl && endEl.value && endEl.value < startVal) endEl.value = startVal;
    _updateSwapRevertHint();
  });
  document
    .getElementById("swap-end-date")
    ?.addEventListener("change", _updateSwapRevertHint);

  // Submit buttons
  document
    .getElementById("btn-set-submit")
    ?.addEventListener("click", submitSet);
  document
    .getElementById("btn-swap-submit")
    ?.addEventListener("click", submitSwap);
  document
    .getElementById("btn-bulk-submit")
    ?.addEventListener("click", submitBulk);

  // Overlay click → close
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });
});

// ─── Filter tabel ──────────────────────────────────────────────────────────
function filterTable(officeId, shiftType) {
  // officeId / shiftType — undefined berarti pakai state yang sedang aktif
  if (officeId !== undefined) _activeOffice = officeId;
  if (shiftType !== undefined) _activeShift = shiftType;

  document.querySelectorAll("#shift-tbody tr[data-emp-id]").forEach((row) => {
    const matchOffice =
      !_activeOffice || row.dataset.officeId === _activeOffice;
    const matchShift = !_activeShift || row.dataset.shiftType === _activeShift;
    row.style.display = matchOffice && matchShift ? "" : "none";
  });

  // Pill filter shift
  const pill = document.getElementById("shift-filter-pill");
  const label = document.getElementById("shift-filter-label");
  if (pill && label) {
    if (_activeShift) {
      const shiftMeta = _allUniqueShifts().find(
        (s) => s.shift_type === _activeShift,
      );
      const name =
        _activeShift === "unassigned"
          ? "Belum di-assign"
          : shiftMeta?.type_label || _activeShift;
      label.textContent = name;
      pill.style.display = "inline-flex";
    } else {
      pill.style.display = "none";
    }
  }

  // Sync active state kartu
  document.querySelectorAll(".ss-stat-card").forEach((c) => {
    const isActive = _activeShift && c.dataset.shiftType === _activeShift;
    c.classList.toggle("ss-stat-card--active", !!isActive);
  });

  updateStats(_activeOffice);
  updateVisibleCount();
}

function updateVisibleCount() {
  const rows = document.querySelectorAll("#shift-tbody tr[data-emp-id]");
  const visible = Array.from(rows).filter(
    (r) => r.style.display !== "none",
  ).length;
  const el = document.getElementById("visible-count");
  if (el) el.textContent = visible + " karyawan";
}

// ─── Stats cards ──────────────────────────────────────────────

/**
 * Kumpulkan semua shift unik dari SHIFTS_BY_OFFICE.
 * Return: [{shift_type, type_label, color_hex, time_range}]
 * Urutan: sesuai urutan kemunculan di data (sudah diurutkan server).
 */
function _allUniqueShifts() {
  const seen = new Map(); // shift_type -> object
  Object.values(SHIFTS_BY_OFFICE).forEach((od) => {
    od.shifts.forEach((s) => {
      if (!seen.has(s.type)) {
        seen.set(s.type, {
          shift_type: s.type,
          type_label: s.type_label,
          color_hex: s.color_hex || "#64748b",
          time_range: s.time_range || "",
        });
      }
    });
  });
  return Array.from(seen.values());
}

/**
 * Render kartu stat ke #stat-row.
 * Dipanggil sekali saat DOMContentLoaded; updateStats() hanya update angkanya.
 */
function _renderStatCards() {
  const grid = document.getElementById("stat-row");
  if (!grid) return;
  grid.innerHTML = "";

  const shifts = _allUniqueShifts();

  // Kartu per shift_type
  shifts.forEach((s) => {
    // Warna teks: versi lebih gelap dari color_hex (90% opacity bg, teks pakai hex langsung)
    const card = document.createElement("div");
    card.className = "ss-stat-card";
    card.dataset.shiftType = s.shift_type;

    // Badge bg = hex + 18 opacity, teks = hex
    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r},${g},${b}`;
    };
    const rgb = hexToRgb(s.color_hex);

    card.innerHTML = `
      <div class="ss-stat-card-strip" style="background:${s.color_hex}"></div>
      <span class="ss-stat-num" id="cnt-${s.shift_type}" style="color:${s.color_hex}">0</span>
      <span class="ss-stat-label">${s.type_label}</span>
      <span class="ss-stat-time">${s.time_range}</span>
    `;
    grid.appendChild(card);
  });

  // Kartu "Belum di-assign" selalu di akhir
  const unCard = document.createElement("div");
  unCard.className = "ss-stat-card ss-stat-card--unassigned";
  unCard.id = "stat-card-unassigned";
  unCard.innerHTML = `
    <div class="ss-stat-card-strip" style="background:#d1d5db"></div>
    <span class="ss-stat-num" id="cnt-unassigned">0</span>
    <span class="ss-stat-label">Belum di-assign</span>
    <span class="ss-stat-time">&nbsp;</span>
  `;
  grid.appendChild(unCard);

  // ── Klik kartu → filter tabel ───────────────────────────────────────────
  grid.querySelectorAll(".ss-stat-card").forEach((card) => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      const st = card.dataset.shiftType || "unassigned";
      // Toggle: klik ulang → reset filter
      filterTable(undefined, _activeShift === st ? "" : st);
    });
  });

  // Clear button di pill
  document
    .getElementById("shift-filter-clear")
    ?.addEventListener("click", () => filterTable(undefined, ""));
}

/**
 * Hitung jumlah karyawan per shift_type lalu update angka di kartu.
 * Dipanggil setiap kali filter kantor berubah.
 */
function updateStats(officeId) {
  const filtered = officeId
    ? EMP_DATA.filter((e) => e.office_id === officeId)
    : EMP_DATA;

  // Mulai dari 0 untuk semua shift yang ada
  const cnt = {};
  _allUniqueShifts().forEach((s) => {
    cnt[s.shift_type] = 0;
  });
  let unassigned = 0;

  filtered.forEach((e) => {
    if (!e.shift) {
      unassigned++;
      return;
    }
    const t = e.shift.type;
    if (t in cnt) cnt[t]++;
    else unassigned++;
  });

  // Update angka di DOM
  Object.entries(cnt).forEach(([type, n]) => {
    const el = document.getElementById(`cnt-${type}`);
    if (el) el.textContent = n;
  });
  const unEl = document.getElementById("cnt-unassigned");
  if (unEl) unEl.textContent = unassigned;
}

// ─── Modal helpers ─────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = "block";
}

function setLoading(btn, spin, loading) {
  btn.disabled = loading;
  spin.style.display = loading ? "inline-block" : "none";
}

// ─── Utilities ─────────────────────────────────────────────────────────────
function isoDate(d) {
  return d.toISOString().split("T")[0];
}

async function apiFetch(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF_TOKEN },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

// =============================================================================
//  Modal: Atur Periode (individual)
// =============================================================================

function openSetModal(emp) {
  _setEmp = emp;

  document.getElementById("set-avatar").textContent = emp.initials;
  document.getElementById("set-emp-name").textContent = emp.full_name;
  document.getElementById("set-emp-dept").textContent = emp.department;
  document.getElementById("set-error").style.display = "none";

  const badgeEl = document.getElementById("set-current-badge");
  if (emp.shift) {
    badgeEl.innerHTML = `<span class="badge"
        style="background:${emp.shift.color_hex}22;color:${emp.shift.color_hex};">
      ${emp.shift.type_label}
    </span>`;
  } else {
    badgeEl.innerHTML = "";
  }

  // Populate shift dropdown (difilter per kantor karyawan)
  const sel = document.getElementById("set-shift-id");
  sel.innerHTML = '<option value="">Pilih shift...</option>';
  const officeData = SHIFTS_BY_OFFICE[emp.office_id];
  if (officeData) {
    officeData.shifts.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.type_label}  ·  ${s.time_range}`;
      if (emp.shift && emp.shift.id === s.id) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // Default: Senin depan → Minggu (1 minggu penuh, Senin–Minggu)
  // dow: 0=Minggu,1=Sen,2=Sel,...,6=Sab
  // Minggu → +1 hari, Senin → +7 hari (minggu depan), selain itu → sisa ke Senin berikutnya
  const today = new Date();
  const dow = today.getDay();
  const toMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + toMonday);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6); // Senin + 6 = Minggu

  document.getElementById("set-eff-from").value = isoDate(nextMonday);
  document.getElementById("set-eff-until").value = isoDate(nextSunday);

  openModal("modal-set");
}

async function submitSet() {
  const shiftId = document.getElementById("set-shift-id").value;
  const effFrom = document.getElementById("set-eff-from").value;
  const effUntil = document.getElementById("set-eff-until").value;
  const errEl = document.getElementById("set-error");
  const spinEl = document.getElementById("set-spin");
  const btnEl = document.getElementById("btn-set-submit");

  errEl.style.display = "none";
  if (!shiftId) {
    showError(errEl, "Pilih shift terlebih dahulu.");
    return;
  }
  if (!effFrom) {
    showError(errEl, "Tanggal mulai wajib diisi.");
    return;
  }

  setLoading(btnEl, spinEl, true);
  try {
    const res = await apiFetch("/manager/shift-schedule/set", {
      user_id: _setEmp.id,
      shift_id: shiftId,
      effective_from: effFrom,
      effective_until: effUntil || null,
    });
    if (!res.ok) {
      showError(errEl, res.json.message || "Gagal menyimpan.");
      return;
    }
    closeModal("modal-set");
    location.reload();
  } catch {
    showError(errEl, "Terjadi kesalahan jaringan.");
  } finally {
    setLoading(btnEl, spinEl, false);
  }
}

// =============================================================================
//  Modal: Tukar Shift  (v2 — Searchable Employee Picker + Tanggal Akhir)
// =============================================================================

// ─── State swap ────────────────────────────────────────────────────────────
const _swap = { empA: null, empB: null };

// ─── Searchable picker ──────────────────────────────────────────────────────
/**
 * Buat searchable employee picker untuk Karyawan A/B.
 * @param {string} which - "a" atau "b"
 */
function _initSwapPicker(which) {
  const inputEl = document.getElementById(`swap-search-${which}`);
  const hiddenEl = document.getElementById(`swap-user-${which}`);
  const dropdownEl = document.getElementById(`swap-dropdown-${which}`);
  const infoEl = document.getElementById(`swap-${which}-info`);
  if (!inputEl) return;

  let _open = false;

  function _render(q) {
    const query = (q || "").toLowerCase().trim();
    const otherUid =
      which === "a"
        ? document.getElementById("swap-user-b")?.value
        : document.getElementById("swap-user-a")?.value;

    const results = EMP_DATA.filter((e) => {
      if (e.id === otherUid) return false; // jangan tampilkan yg sudah dipilih
      if (!query) return true;
      return (
        e.full_name.toLowerCase().includes(query) ||
        (e.department || "").toLowerCase().includes(query) ||
        (e.shift?.type_label || "").toLowerCase().includes(query)
      );
    }).slice(0, 12);

    dropdownEl.innerHTML = "";

    if (results.length === 0) {
      dropdownEl.innerHTML = `<div class="swap-dd-empty">Tidak ada karyawan ditemukan.</div>`;
      return;
    }

    results.forEach((e) => {
      const item = document.createElement("div");
      item.className = "swap-dd-item";
      const shiftBadge = e.shift
        ? `<span class="swap-dd-badge" style="background:${e.shift.color_hex}22;color:${e.shift.color_hex};">${e.shift.type_label}</span>`
        : `<span class="swap-dd-badge" style="color:var(--text-faint);">—</span>`;
      item.innerHTML = `
        <div class="swap-dd-avatar">${e.initials}</div>
        <div class="swap-dd-info">
          <div class="swap-dd-name">${e.full_name}</div>
          <div class="swap-dd-dept">${e.department || ""}</div>
        </div>
        ${shiftBadge}`;
      item.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // jangan blur dulu
        _selectEmp(e);
      });
      dropdownEl.appendChild(item);
    });
  }

  function _selectEmp(e) {
    hiddenEl.value = e.id;
    inputEl.value = e.full_name;
    if (which === "a") _swap.empA = e;
    else _swap.empB = e;
    _closeDropdown();
    _updateSwapPreview();
    infoEl.textContent = e.shift
      ? `Shift saat ini: ${e.shift.type_label} · ${e.shift.time_range}`
      : "Belum di-assign";
  }

  function _openDropdown() {
    _render(inputEl.value);
    dropdownEl.style.display = "block";
    _open = true;
  }

  function _closeDropdown() {
    dropdownEl.style.display = "none";
    _open = false;
  }

  inputEl.addEventListener("input", () => {
    // Clear hidden value kalau user ngetik ulang
    hiddenEl.value = "";
    if (which === "a") _swap.empA = null;
    else _swap.empB = null;
    infoEl.textContent = "";
    _render(inputEl.value);
    dropdownEl.style.display = "block";
    _open = true;
    _updateSwapPreview();
  });

  inputEl.addEventListener("focus", () => {
    _render(inputEl.value);
    dropdownEl.style.display = "block";
    _open = true;
  });

  inputEl.addEventListener("blur", () => {
    // Delay agar mousedown pada item sempat jalan
    setTimeout(() => {
      _closeDropdown();
      // Kalau user blur tanpa pilih dari dropdown, reset
      if (!hiddenEl.value) {
        inputEl.value = "";
        if (which === "a") _swap.empA = null;
        else _swap.empB = null;
        infoEl.textContent = "";
        _updateSwapPreview();
      }
    }, 150);
  });
}

// ─── Preview pertukaran ─────────────────────────────────────────────────────
function _updateSwapPreview() {
  const empA = _swap.empA;
  const empB = _swap.empB;
  const preview = document.getElementById("swap-preview");
  if (empA && empB && empA.shift && empB.shift && empA.id !== empB.id) {
    document.getElementById("swap-preview-rows").innerHTML = `
    <div class="sched-preview-row">
      <span class="sched-preview-name">${empA.full_name}</span>
      <span class="badge" style="background:${empA.shift.color_hex}22;color:${empA.shift.color_hex};font-size:0.65rem;">${empA.shift.type_label}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      <span class="badge" style="background:${empB.shift.color_hex}22;color:${empB.shift.color_hex};font-size:0.65rem;">${empB.shift.type_label}</span>
    </div>
    <div class="sched-preview-row">
      <span class="sched-preview-name">${empB.full_name}</span>
      <span class="badge" style="background:${empB.shift.color_hex}22;color:${empB.shift.color_hex};font-size:0.65rem;">${empB.shift.type_label}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      <span class="badge" style="background:${empA.shift.color_hex}22;color:${empA.shift.color_hex};font-size:0.65rem;">${empA.shift.type_label}</span>
    </div>`;
    preview.style.display = "block";
  } else {
    preview.style.display = "none";
  }
}

// ─── Hint tanggal akhir ─────────────────────────────────────────────────────
function _updateSwapRevertHint() {
  const startVal = document.getElementById("swap-start-date")?.value;
  const endVal = document.getElementById("swap-end-date")?.value;
  const el = document.getElementById("swap-revert-hint-text");
  if (!el) return;
  if (startVal && endVal) {
    const start = new Date(startVal);
    const end = new Date(endVal);
    const diff = Math.round((end - start) / 86400000) + 1;
    if (diff > 0) {
      el.textContent = `Karyawan kembali ke jadwal normal setelah ${diff} hari (setelah ${endVal}).`;
    } else {
      el.textContent = "Tanggal akhir harus setelah tanggal mulai.";
    }
  } else if (startVal) {
    el.textContent = "Pilih tanggal akhir.";
  } else {
    el.textContent = "Pilih tanggal mulai dan akhir.";
  }
}

function openSwapModal() {
  // Reset state
  _swap.empA = null;
  _swap.empB = null;

  // Reset inputs
  ["a", "b"].forEach((w) => {
    const si = document.getElementById(`swap-search-${w}`);
    const hi = document.getElementById(`swap-user-${w}`);
    const ii = document.getElementById(`swap-${w}-info`);
    const dd = document.getElementById(`swap-dropdown-${w}`);
    if (si) si.value = "";
    if (hi) hi.value = "";
    if (ii) ii.textContent = "";
    if (dd) dd.style.display = "none";
  });

  // Default dates: hari ini s/d 6 hari ke depan
  const today = new Date();
  const todayIso = isoDate(today);
  const endDefault = new Date(today);
  endDefault.setDate(today.getDate() + 6);
  const endIso = isoDate(endDefault);

  const startEl = document.getElementById("swap-start-date");
  const endEl = document.getElementById("swap-end-date");
  if (startEl) {
    startEl.value = todayIso;
    startEl.min = todayIso;
  }
  if (endEl) {
    endEl.value = endIso;
    endEl.min = todayIso;
  }

  _updateSwapRevertHint();
  document.getElementById("swap-error").style.display = "none";
  document.getElementById("swap-preview").style.display = "none";

  // Init pickers (aman dipanggil berulang)
  _initSwapPicker("a");
  _initSwapPicker("b");

  openModal("modal-swap");
}

// ─── Submit ─────────────────────────────────────────────────────────────────
async function submitSwap() {
  const uidA = document.getElementById("swap-user-a")?.value || "";
  const uidB = document.getElementById("swap-user-b")?.value || "";
  const startDate = document.getElementById("swap-start-date")?.value || "";
  const endDate = document.getElementById("swap-end-date")?.value || "";
  const errEl = document.getElementById("swap-error");
  const spinEl = document.getElementById("swap-spin");
  const btnEl = document.getElementById("btn-swap-submit");

  errEl.style.display = "none";

  if (!startDate) {
    showError(errEl, "Pilih tanggal mulai.");
    return;
  }
  if (!endDate) {
    showError(errEl, "Pilih tanggal akhir.");
    return;
  }
  if (endDate < startDate) {
    showError(errEl, "Tanggal akhir harus setelah tanggal mulai.");
    return;
  }
  if (!uidA || !uidB) {
    showError(errEl, "Pilih kedua karyawan.");
    return;
  }
  if (uidA === uidB) {
    showError(errEl, "Tidak bisa tukar dengan diri sendiri.");
    return;
  }

  // Hitung duration_days dari selisih tanggal
  const msPerDay = 86400000;
  const diffDays =
    Math.round((new Date(endDate) - new Date(startDate)) / msPerDay) + 1;
  const durationDays = Math.max(1, Math.min(diffDays, 365));

  setLoading(btnEl, spinEl, true);
  try {
    const res = await apiFetch("/manager/shift-schedule/swap", {
      user_id_a: uidA,
      user_id_b: uidB,
      swap_date: startDate,
      duration_days: durationDays,
    });
    if (!res.ok) {
      showError(errEl, res.json?.message || "Gagal menukar shift.");
      return;
    }
    closeModal("modal-swap");
    location.reload();
  } catch {
    showError(errEl, "Terjadi kesalahan jaringan.");
  } finally {
    setLoading(btnEl, spinEl, false);
  }
}

// =============================================================================
//  Modal: Bulk Assign Shift
//
//  ARSITEKTUR — Decoupled Selection State
//  ─────────────────────────────────────
//  _bulk.selectedSet  = Set<employee_id>   ← SOURCE OF TRUTH, tidak pernah
//                                            dihapus saat filter/search berubah
//
//  Flow:
//    1. openBulkModal() → reset selectedSet, render tabel + chips
//    2. User search/filter → _renderBulkTable() → re-render DOM,
//       setiap checkbox di-sync dari selectedSet (checked = selectedSet.has(id))
//    3. User klik checkbox → selectedSet.add/delete(id) → update chips + counter
//    4. submitBulk() → kirim Array.from(selectedSet) ke backend
// =============================================================================

/** State bulk modal */
const _bulk = {
  filteredOffice: "", // office_id aktif di filter dropdown
  searchText: "", // teks search saat ini
  selectedSet: new Set(), // ← SOURCE OF TRUTH: id karyawan yang dipilih
};

// ─── Open / Close ─────────────────────────────────────────────────────────────

function openBulkModal() {
  // Reset state sepenuhnya
  _bulk.filteredOffice = _activeOffice || "";
  _bulk.searchText = "";
  _bulk.selectedSet = new Set();

  // Reset UI
  document.getElementById("bulk-search").value = "";
  document.getElementById("bulk-error").style.display = "none";

  // Populate office dropdown filter
  const offSel = document.getElementById("bulk-filter-office");
  offSel.innerHTML = '<option value="">Semua Kantor</option>';
  (typeof ALL_OFFICES !== "undefined" ? ALL_OFFICES : _uniqueOffices()).forEach(
    (o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name;
      if (o.id === _bulk.filteredOffice) opt.selected = true;
      offSel.appendChild(opt);
    },
  );

  // Populate shift dropdown & tabel
  _renderBulkShiftDropdown();
  _renderBulkTable();
  _renderBulkChips();

  // Default dates: Senin depan → Minggu (1 minggu penuh, Senin–Minggu)
  const today = new Date();
  const dow = today.getDay();
  const toMonday = dow === 0 ? 1 : (8 - dow) % 7 || 7;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + toMonday);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6); // Senin + 6 = Minggu

  document.getElementById("bulk-eff-from").value = isoDate(nextMonday);
  document.getElementById("bulk-eff-until").value = isoDate(nextSunday);

  openModal("modal-bulk");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Kumpulkan semua office unik dari EMP_DATA jika ALL_OFFICES tidak tersedia */
function _uniqueOffices() {
  const seen = new Map();
  EMP_DATA.forEach((e) => {
    if (e.office_id && !seen.has(e.office_id))
      seen.set(e.office_id, { id: e.office_id, name: e.office_name });
  });
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** List karyawan setelah filter office + search */
function _filteredEmpList() {
  const q = _bulk.searchText.toLowerCase();
  const oi = _bulk.filteredOffice;
  return EMP_DATA.filter((e) => {
    const matchOffice = !oi || e.office_id === oi;
    const matchSearch =
      !q ||
      e.full_name.toLowerCase().includes(q) ||
      (e.department || "").toLowerCase().includes(q);
    return matchOffice && matchSearch;
  });
}

// ─── Render: Shift Dropdown ───────────────────────────────────────────────────

function _renderBulkShiftDropdown() {
  const sel = document.getElementById("bulk-shift-id");
  const prev = sel.value;
  sel.innerHTML = '<option value="">Pilih shift...</option>';

  const officeId = _bulk.filteredOffice;
  if (officeId && SHIFTS_BY_OFFICE[officeId]) {
    SHIFTS_BY_OFFICE[officeId].shifts.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.type_label}  ·  ${s.time_range}`;
      if (s.id === prev) opt.selected = true;
      sel.appendChild(opt);
    });
  } else {
    Object.values(SHIFTS_BY_OFFICE).forEach((od) => {
      od.shifts.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${od.office_name}  ·  ${s.type_label}  ·  ${s.time_range}`;
        if (s.id === prev) opt.selected = true;
        sel.appendChild(opt);
      });
    });
  }
}

// ─── Render: Tabel Karyawan ───────────────────────────────────────────────────
//  Setiap kali dipanggil, checkbox di-sync dari _bulk.selectedSet
//  sehingga seleksi TIDAK pernah hilang walau filter/search berubah.

function _renderBulkTable() {
  const tbody = document.getElementById("bulk-emp-tbody");
  const empList = _filteredEmpList();

  tbody.innerHTML = "";

  if (empList.length === 0) {
    tbody.innerHTML = `<tr class="bulk-empty-row">
      <td colspan="4">Tidak ada karyawan yang sesuai filter.</td>
    </tr>`;
    _syncSelectAllCheckbox();
    return;
  }

  empList.forEach((e) => {
    const isSelected = _bulk.selectedSet.has(e.id);
    const shiftBadge = e.shift
      ? `<span class="badge" style="background:${e.shift.color_hex}22;color:${e.shift.color_hex};font-size:0.68rem;">${e.shift.type_label}</span>`
      : `<span style="color:var(--text-faint)">—</span>`;

    const tr = document.createElement("tr");
    if (isSelected) tr.classList.add("bulk-row-selected");
    tr.dataset.empId = e.id;
    tr.dataset.officeId = e.office_id || "";

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="bulk-check" data-emp-id="${e.id}"
               ${isSelected ? "checked" : ""} />
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <div class="mgr-avatar mgr-avatar-sm">${e.initials}</div>
          <div>
            <div style="font-weight:500;font-size:0.82rem;">${e.full_name}</div>
            <div style="font-size:0.7rem;color:var(--text-faint);">${e.department}</div>
          </div>
        </div>
      </td>
      <td style="font-size:0.78rem;color:var(--text-muted);">${e.office_name}</td>
      <td>${shiftBadge}</td>`;

    // ── Listener checkbox — tulis ke selectedSet, bukan hanya DOM ──
    tr.querySelector(".bulk-check").addEventListener("change", (ev) => {
      const id = ev.target.dataset.empId;
      if (ev.target.checked) {
        _bulk.selectedSet.add(id);
        tr.classList.add("bulk-row-selected");
      } else {
        _bulk.selectedSet.delete(id);
        tr.classList.remove("bulk-row-selected");
      }
      _updateBulkCounter();
      _renderBulkChips();
      _syncSelectAllCheckbox();
    });

    tbody.appendChild(tr);
  });

  _syncSelectAllCheckbox();
}

// ─── Render: Chips karyawan terpilih ─────────────────────────────────────────
//  Menampilkan badge "Nama ×" untuk setiap id di selectedSet,
//  sehingga manager selalu bisa melihat siapa saja yang sudah dipilih
//  tanpa harus scroll/search ulang.

function _renderBulkChips() {
  const container = document.getElementById("bulk-chips-container");
  if (!container) return;

  if (_bulk.selectedSet.size === 0) {
    container.innerHTML = `<span class="bulk-chips-empty">Belum ada karyawan dipilih.</span>`;
    return;
  }

  const empMap = new Map(EMP_DATA.map((e) => [e.id, e]));
  container.innerHTML = "";

  _bulk.selectedSet.forEach((id) => {
    const emp = empMap.get(id);
    if (!emp) return;

    const chip = document.createElement("span");
    chip.className = "bulk-chip";
    chip.dataset.empId = id;
    chip.innerHTML = `
      <span class="bulk-chip-name">${emp.full_name}</span>
      <button class="bulk-chip-remove" title="Hapus" data-emp-id="${id}">×</button>`;

    chip.querySelector(".bulk-chip-remove").addEventListener("click", () => {
      _bulk.selectedSet.delete(id);
      // Sync checkbox di tabel jika baris masih terrender
      const cb = document.querySelector(`.bulk-check[data-emp-id="${id}"]`);
      if (cb) {
        cb.checked = false;
        cb.closest("tr")?.classList.remove("bulk-row-selected");
      }
      _updateBulkCounter();
      _renderBulkChips();
      _syncSelectAllCheckbox();
    });

    container.appendChild(chip);
  });
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

/** Update angka counter "Terpilih: N karyawan" */
function _updateBulkCounter() {
  const el = document.getElementById("bulk-selected-count");
  if (el) el.textContent = _bulk.selectedSet.size;
}

/** Sync state checkbox "Select All" di header tabel */
function _syncSelectAllCheckbox() {
  const allCb = document.getElementById("bulk-check-all");
  if (!allCb) return;
  const visible = document.querySelectorAll(".bulk-check");
  if (visible.length === 0) {
    allCb.checked = false;
    allCb.indeterminate = false;
    return;
  }
  const checkedCount = Array.from(visible).filter((c) => c.checked).length;
  if (checkedCount === 0) {
    allCb.checked = false;
    allCb.indeterminate = false;
  } else if (checkedCount === visible.length) {
    allCb.checked = true;
    allCb.indeterminate = false;
  } else {
    allCb.checked = false;
    allCb.indeterminate = true; // sebagian terpilih → tanda minus
  }
}

// ─── Event Handlers (dipanggil dari HTML) ────────────────────────────────────

/** Select / deselect semua baris yang SAAT INI terlihat di tabel */
function bulkToggleAll(cb) {
  const empList = _filteredEmpList();
  empList.forEach((e) => {
    if (cb.checked) _bulk.selectedSet.add(e.id);
    else _bulk.selectedSet.delete(e.id);
  });
  _renderBulkTable(); // re-render agar semua checkbox ter-sync
  _updateBulkCounter();
  _renderBulkChips();
}

function onBulkOfficeChange() {
  _bulk.filteredOffice = document.getElementById("bulk-filter-office").value;
  _renderBulkShiftDropdown();
  _renderBulkTable();
  // selectedSet TIDAK di-reset — seleksi sebelumnya tetap tersimpan
}

function onBulkSearch() {
  _bulk.searchText = document.getElementById("bulk-search").value;
  _renderBulkTable();
  // selectedSet TIDAK di-reset — seleksi sebelumnya tetap tersimpan
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function submitBulk() {
  const shiftId = document.getElementById("bulk-shift-id").value;
  const effFrom = document.getElementById("bulk-eff-from").value;
  const effUntil = document.getElementById("bulk-eff-until").value;
  const errEl = document.getElementById("bulk-error");
  const spinEl = document.getElementById("bulk-spin");
  const btnEl = document.getElementById("btn-bulk-submit");

  errEl.style.display = "none";

  const userIds = Array.from(_bulk.selectedSet); // ← ambil dari Set, bukan DOM

  if (userIds.length === 0) {
    showError(errEl, "Pilih minimal 1 karyawan terlebih dahulu.");
    return;
  }
  if (!shiftId) {
    showError(errEl, "Pilih shift yang akan di-assign.");
    return;
  }
  if (!effFrom) {
    showError(errEl, "Tanggal mulai wajib diisi.");
    return;
  }

  setLoading(btnEl, spinEl, true);
  try {
    const res = await apiFetch("/manager/shift-schedule/bulk-set", {
      user_ids: userIds,
      shift_id: shiftId,
      effective_from: effFrom,
      effective_until: effUntil || null,
    });
    if (!res.ok) {
      showError(errEl, res.json.message || "Gagal menyimpan.");
      return;
    }
    closeModal("modal-bulk");
    location.reload();
  } catch {
    showError(errEl, "Terjadi kesalahan jaringan.");
  } finally {
    setLoading(btnEl, spinEl, false);
  }
}
