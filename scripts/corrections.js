/**
 * corrections.js — Bug fixes + Restore Feature + UX Improvements
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIXES:
 *
 * [FIX-1] Tab Duplikat — panel.style.display diset ke "block" (bukan "")
 *         Panel CSS default = display:none, clear inline style = kembali ke none
 *
 * [FIX-2] Detail modal — _serialize_log backend mengembalikan "effective_date"
 *         bukan "eff_date". renderDupLogCard sekarang pakai lg.effective_date
 *         untuk group-key agar tombol "Pertahankan" bisa menemukan grupnya.
 *         Juga data-group-key di card duplikat kini menggunakan effective_date.
 *
 * [FIX-3] Koreksi Baru modal — pastikan openModal benar-benar set display flex
 *         menggunakan style langsung bukan hanya class. Juga hapus konflik
 *         inline style double di corrDupWarning (ada display:none 2x di HTML).
 *
 * [FIX-4] openLogDetail() global function dipastikan selalu bisa dipanggil
 *         meskipun IIFE belum expose window.CorrDup. Fallback ke direct fetch.
 *
 * FITUR BARU:
 *
 * [FEAT-1] Tombol Restore Log di detail modal — tampil jika source=deleted,
 *          memanggil /corrections/log/<id>/restore (POST)
 *
 * [FEAT-2] Date range filter di panel Riwayat — filter langsung ke server
 *          melalui /corrections/history API dengan pagination server-side
 *
 * [FEAT-3] Konfirmasi sebelum close modal jika ada perubahan belum disimpan
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ── Konstanta URL ──────────────────────────────────────────────────────────
  const URL_DUPLICATES = "/manager/corrections/duplicates";
  const URL_MERGE = "/manager/corrections/duplicates/merge";
  const URL_BULK_DELETE = "/manager/corrections/bulk-delete";
  const URL_LOG_DELETE = (id) => `/manager/corrections/log/${id}`;
  const URL_LOG_DETAIL = (id) => `/manager/corrections/log/${id}`;
  const URL_LOG_RESTORE = (id) => `/manager/corrections/log/${id}/restore`;
  const URL_ATT_LOOKUP = "/manager/attendance-log";
  const URL_CORR_SAVE = "/manager/corrections";
  const URL_LOG_CREATE = "/manager/corrections/create-log";
  const URL_HISTORY = "/manager/corrections/history";
  const URL_MISSING_DATES = "/manager/corrections/missing-dates"; // [BUG-6 FIX]

  // ── CSRF Token — baca dari meta tag yang di-render Flask-WTF ──────────────
  function getCsrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content || "";
  }

  // Helper fetch dengan CSRF otomatis untuk semua request mutating
  function fetchJson(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (method !== "GET" && method !== "HEAD") {
      headers["X-CSRFToken"] = getCsrf();
    }
    return fetch(url, { ...options, headers });
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let dupGroups = [];
  let bulkSelectedIds = new Set();
  let pendingDeleteCb = null;
  let currentMergeGroup = null;

  // State untuk modal koreksi
  let corrState = {
    empId: "",
    empName: "",
    logId: "",
    shiftInfo: null,
    logData: null,
  };

  // ── Helper ─────────────────────────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function showEl(el) {
    if (el) el.style.display = "";
  }
  function hideEl(el) {
    if (el) el.style.display = "none";
  }

  function toast(msg, type = "success") {
    if (window.showToast) {
      window.showToast(msg, type);
      return;
    }
    const div = document.createElement("div");
    div.textContent = msg;
    Object.assign(div.style, {
      position: "fixed",
      bottom: "1.5rem",
      right: "1.5rem",
      zIndex: 9999,
      padding: ".75rem 1.25rem",
      borderRadius: "8px",
      fontSize: ".875rem",
      background:
        type === "success"
          ? "#16a34a"
          : type === "error"
            ? "#dc2626"
            : "#d97706",
      color: "#fff",
      boxShadow: "0 4px 12px rgba(0,0,0,.2)",
      maxWidth: "360px",
      transition: "opacity .3s",
    });
    document.body.appendChild(div);
    setTimeout(() => {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 350);
    }, 3000);
  }

  function formatDate(d) {
    if (!d) return "—";
    const [y, m, day] = d.split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agt",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];
    return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
  }

  function calcAutoStatus(checkIn, workStart, lateTolerance) {
    if (!checkIn || !workStart) return null;
    const [ih, im] = checkIn.split(":").map(Number);
    const [wh, wm] = workStart.split(":").map(Number);
    const inMin = ih * 60 + im;
    const limMin = wh * 60 + wm + (lateTolerance || 0);
    return inMin <= limMin ? "present" : "late";
  }

  const STATUS_LABEL = {
    present: "Hadir",
    late: "Terlambat",
    absent: "Tidak Hadir",
    sick: "Sakit",
    day_off: "Libur",
    extra_off: "Izin",
    remote: "Remote",
    deleted: "[Dihapus]",
  };
  const SOURCE_LABEL = {
    gps: "GPS",
    correction: "Koreksi",
    system: "Sistem",
    deleted: "Dihapus",
    unknown: "?",
  };
  const SOURCE_CLASS = {
    gps: "src-gps",
    correction: "src-correction",
    system: "src-system",
    deleted: "src-deleted",
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TAB SWITCHING — [FIX-1] set display "block" bukan ""
  // ═══════════════════════════════════════════════════════════════════════════
  function initTabs() {
    const tabs = $$(".corr-tab");
    const panels = {
      history: $("#panelHistory"),
      duplicates: $("#panelDuplicates"),
      missing: $("#panelMissing"), // [BUG-6 FIX]
    };
    let dupFetched = false;

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        const target = btn.dataset.tab;
        Object.entries(panels).forEach(([k, p]) => {
          if (!p) return;
          // [FIX-1] Harus set "block" secara eksplisit, bukan "" (clear)
          // karena CSS default panel adalah display:none dan "" akan kembali ke CSS rule
          p.style.display = k === target ? "block" : "none";
        });
        if (target === "duplicates" && !dupFetched) {
          dupFetched = true;
          fetchDuplicates();
        }
      });
    });
  }

  function switchToTab(name) {
    const tab = $(`.corr-tab[data-tab="${name}"]`);
    if (tab) tab.click();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. EMPLOYEE AUTOCOMPLETE
  // ═══════════════════════════════════════════════════════════════════════════
  function initEmployeeAutocomplete() {
    const input = $("#corrEmpSearch");
    const dropdown = $("#corrEmpDropdown");
    const clearBtn = $("#corrEmpClear");
    const hiddenId = $("#corrEmployee");

    if (!input) return;

    const sourceSelect = $("#corrEmployeeSource");
    const employees = sourceSelect
      ? [...sourceSelect.options]
          .filter((o) => o.value)
          .map((o) => ({ id: o.value, name: o.text }))
      : [];

    function renderDropdown(list) {
      if (!list.length) {
        hideEl(dropdown);
        return;
      }
      dropdown.innerHTML = list
        .map(
          (e) =>
            `<div class="emp-option" data-id="${e.id}" data-name="${e.name}">${e.name}</div>`,
        )
        .join("");
      showEl(dropdown);
    }

    input.addEventListener("input", () => {
      const q = input.value.toLowerCase().trim();
      if (!q) {
        hideEl(dropdown);
        hiddenId.value = "";
        return;
      }
      renderDropdown(
        employees.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8),
      );
    });

    document.addEventListener("click", (e) => {
      const opt = e.target.closest(".emp-option");
      if (opt) {
        hiddenId.value = opt.dataset.id;
        input.value = opt.dataset.name;
        corrState.empId = opt.dataset.id;
        corrState.empName = opt.dataset.name;
        hideEl(dropdown);
        showEl(clearBtn);
        const dateVal = $("#corrDate")?.value;
        if (dateVal) doLookup();
        return;
      }
      if (!input.contains(e.target) && !dropdown?.contains(e.target))
        hideEl(dropdown);
    });

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      hiddenId.value = "";
      corrState.empId = "";
      corrState.empName = "";
      corrState.logId = "";
      corrState.logData = null;
      hideEl(clearBtn);
      hideEl(dropdown);
      resetCorrForm();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MODAL KOREKSI BARU — [FIX-3] openModal yang lebih robust
  // ═══════════════════════════════════════════════════════════════════════════
  function initCorrModal() {
    const btnNew = $("#btnCorrNew");
    const btnClose = $("#btnCloseCorr");
    const btnCancel = $("#btnCancelCorr");
    const btnSearch = $("#btnCorrSearch");
    const btnSubmit = $("#btnCorrSubmit");

    btnNew?.addEventListener("click", openCorrModal);
    btnClose?.addEventListener("click", () => closeModal("modalCorr"));
    btnCancel?.addEventListener("click", () => closeModal("modalCorr"));

    $("#corrDate")?.addEventListener("change", () => {
      if (corrState.empId) doLookup();
    });

    btnSearch?.addEventListener("click", doLookup);
    btnSubmit?.addEventListener("click", doSubmit);

    $("#corrNewIn")?.addEventListener("input", updateAutoStatus);

    $("#btnDeleteThisLog")?.addEventListener("click", () => {
      if (!corrState.logId) return;
      openConfirmDelete(
        "Apakah Anda yakin ingin menghapus log absensi ini?",
        async (reason) => {
          const res = await fetchJson(URL_LOG_DELETE(corrState.logId), {
            method: "DELETE",
            body: JSON.stringify({ reason }),
          });
          const data = await res.json();
          if (res.ok) {
            toast(data.message || "Log berhasil dihapus.");
            closeModal("modalCorr");
            setTimeout(() => location.reload(), 1200);
          } else throw new Error(data.message || "Gagal menghapus log.");
        },
      );
    });

    $("#btnGoToDupPanel")?.addEventListener("click", () => {
      closeModal("modalCorr");
      switchToTab("duplicates");
    });
  }

  // [FIX-3] openModal sekarang set display flex secara langsung
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add("active");
    // Set display langsung, tidak clear — pastikan flex agar centering berjalan
    m.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove("active");
    m.style.display = "none";
    // Restore scroll jika tidak ada modal lain yang terbuka
    const anyOpen = document.querySelector(".modal-overlay.active");
    if (!anyOpen) document.body.style.overflow = "";
  }

  // Tutup modal saat klik overlay
  document.addEventListener("click", (e) => {
    ["modalMerge", "modalConfirmDelete", "modalLogDetail", "modalCorr"].forEach(
      (id) => {
        const m = document.getElementById(id);
        if (m && e.target === m) closeModal(id);
      },
    );
  });

  // ESC untuk tutup modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      [
        "modalCorr",
        "modalLogDetail",
        "modalMerge",
        "modalConfirmDelete",
      ].forEach(closeModal);
    }
  });

  function openCorrModal() {
    corrState = {
      empId: "",
      empName: "",
      logId: "",
      shiftInfo: null,
      logData: null,
    };

    const empInput = $("#corrEmpSearch");
    if (empInput) empInput.value = "";
    const hiddenId = $("#corrEmployee");
    if (hiddenId) hiddenId.value = "";
    hideEl($("#corrEmpClear"));
    hideEl($("#corrEmpDropdown"));

    const dateEl = $("#corrDate");
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

    resetCorrForm();
    openModal("modalCorr");

    // Focus ke input karyawan setelah animasi
    setTimeout(() => $("#corrEmpSearch")?.focus(), 100);
  }

  function resetCorrForm() {
    hideEl($("#corrDataPreview"));
    hideEl($("#corrFormFields"));
    hideEl($("#btnCorrSubmit"));
    showEl($("#btnCorrSearch"));
    hideEl($("#corrDupWarning"));
    hideEl($("#corrDeleteRow"));
    hideEl($("#corrStep1Error"));
    hideEl($("#corrError"));
    hideEl($("#created-at-hint")); // [BUG-2 FIX]

    ["corrNewIn", "corrNewOut", "corrReason"].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.value = "";
    });
    const stEl = $("#corrNewStatus");
    if (stEl) stEl.value = "";
  }

  async function doLookup() {
    const empId = corrState.empId || $("#corrEmployee")?.value || "";
    const dateVal = $("#corrDate")?.value || "";
    const errEl = $("#corrStep1Error");

    if (!empId) {
      showEl(errEl);
      errEl.textContent = "Pilih karyawan terlebih dahulu.";
      return;
    }
    if (!dateVal) {
      showEl(errEl);
      errEl.textContent = "Pilih tanggal terlebih dahulu.";
      return;
    }
    hideEl(errEl);

    const btnSearch = $("#btnCorrSearch");
    if (btnSearch) {
      btnSearch.disabled = true;
      btnSearch.textContent = "Mencari…";
    }

    try {
      const res = await fetch(
        `${URL_ATT_LOOKUP}?user_id=${encodeURIComponent(empId)}&date=${encodeURIComponent(dateVal)}`,
      );
      const data = await res.json();

      corrState.shiftInfo = {
        work_start: data.work_start || null,
        late_tolerance: data.late_tolerance || 0,
        shift_label: data.shift_label || null,
        office_name: data.office_name || null,
        cutoff: data.cutoff || null,
      };

      // [BUG-2 FIX] Tampilkan info akun dibuat sebagai petunjuk saja (tidak blokir)
      const hintEl = $("#created-at-hint");
      if (hintEl) {
        if (data.user_created_at) {
          hintEl.textContent = `ℹ️ Akun dibuat: ${formatDate(data.user_created_at)}`;
          showEl(hintEl);
        } else {
          hideEl(hintEl);
        }
      }

      if (res.ok) {
        corrState.logId = data.id;
        corrState.logData = data;
        renderDataPreview(data);
        fillFormFromLog(data);
        showFormFields(true, data.source === "deleted");
      } else if (res.status === 404 && data.no_log) {
        corrState.logId = "";
        corrState.logData = null;
        renderDataPreview(null, data);
        fillFormNew();
        showFormFields(false, false);
      } else {
        showEl(errEl);
        errEl.textContent = data.message || "Gagal mencari data absensi.";
        return;
      }

      if (data.siblings && data.siblings.length > 0) {
        const warnEl = $("#corrDupWarning");
        const warnTxt = $("#corrDupWarnText");
        if (warnEl && warnTxt) {
          warnTxt.textContent = `Ada ${data.siblings.length} log lain pada tanggal ini — kemungkinan duplikat.`;
          // [FIX-3] Set display flex langsung, jangan "" atau "block"
          warnEl.style.display = "flex";
        }
      } else {
        hideEl($("#corrDupWarning"));
      }

      hideEl(btnSearch);
      showEl($("#btnCorrSubmit"));
    } catch (e) {
      showEl(errEl);
      errEl.textContent = "Gagal menghubungi server.";
      console.error(e);
    } finally {
      if (btnSearch) {
        btnSearch.disabled = false;
        btnSearch.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Cari Data Absensi`;
      }
    }
  }

  function renderDataPreview(logData, noLogData) {
    const previewEl = $("#corrDataPreview");
    if (!previewEl) return;

    const si = corrState.shiftInfo;

    if (logData) {
      const checkIn = logData.check_in || "—";
      const checkOut = logData.check_out || "—";
      const status = STATUS_LABEL[logData.status] || logData.status || "—";
      const shift = logData.shift_label || si?.shift_label || "—";
      const isDeleted = logData.source === "deleted";

      previewEl.innerHTML = `
        <div class="corr-preview-card${isDeleted ? " corr-preview-deleted" : ""}">
          ${isDeleted ? '<div class="corr-preview-deleted-banner">⚠️ Log ini sudah dihapus (soft-delete) — Anda dapat memulihkannya</div>' : ""}
          <div class="corr-preview-cols">
            <div class="corr-preview-col">
              <span class="corr-preview-label">CHECK-IN</span>
              <span class="corr-preview-val">${checkIn}</span>
            </div>
            <div class="corr-preview-col">
              <span class="corr-preview-label">CHECK-OUT</span>
              <span class="corr-preview-val">${checkOut}</span>
            </div>
            <div class="corr-preview-col">
              <span class="corr-preview-label">STATUS</span>
              <span class="corr-preview-val corr-preview-status">${status}</span>
            </div>
          </div>
          ${
            si?.work_start
              ? `
            <div class="corr-shift-info">
              ℹ️ ${si.office_name ? si.office_name + ": " : ""}${si.work_start}
              ${si.late_tolerance ? `— toleransi ${si.late_tolerance} mnt` : ""}
              ${shift !== "—" ? ` · Shift: ${shift}` : ""}
              ${si.cutoff ? ` · Cutoff: ${si.cutoff}` : ""}
            </div>
          `
              : ""
          }
        </div>
      `;
    } else {
      const ws = si?.work_start || "";
      previewEl.innerHTML = `
        <div class="corr-preview-card corr-preview-new">
          <span class="corr-preview-new-label">📋 Belum ada log absensi — akan membuat log baru</span>
          ${ws ? `<span class="corr-preview-new-ws">Jam kerja mulai: <strong>${ws}</strong></span>` : ""}
        </div>
      `;
    }
    showEl(previewEl);
  }

  function fillFormFromLog(data) {
    const inEl = $("#corrNewIn");
    const outEl = $("#corrNewOut");
    const stEl = $("#corrNewStatus");
    if (inEl) inEl.value = data.check_in || "";
    if (outEl) outEl.value = data.check_out || "";
    if (stEl) stEl.value = data.status || "";
    updateAutoStatus();
  }

  function fillFormNew() {
    const inEl = $("#corrNewIn");
    const outEl = $("#corrNewOut");
    const stEl = $("#corrNewStatus");
    if (inEl) inEl.value = "";
    if (outEl) outEl.value = "";
    if (stEl) stEl.value = "present";
  }

  // isDeleted: log sudah dihapus, sembunyikan form edit, tampilkan restore
  function showFormFields(hasLog, isDeleted) {
    if (isDeleted) {
      // Log terhapus: tampilkan hanya opsi restore, sembunyikan form edit
      hideEl($("#corrFormFields"));
      hideEl($("#btnCorrSubmit"));
      showEl($("#corrDeleteRow"));
      // Ganti teks tombol "Hapus Log Ini" menjadi tidak relevan, tapi
      // tambahkan tombol restore langsung di preview — lihat renderDataPreview
      const delBtn = $("#btnDeleteThisLog");
      if (delBtn) hideEl(delBtn);
      return;
    }
    showEl($("#corrFormFields"));
    if (hasLog) showEl($("#corrDeleteRow"));
    else hideEl($("#corrDeleteRow"));
    const delBtn = $("#btnDeleteThisLog");
    if (delBtn) showEl(delBtn);
  }

  function updateAutoStatus() {
    const si = corrState.shiftInfo;
    const inVal = $("#corrNewIn")?.value || "";
    const autoEl = $("#corrAutoStatus");
    const stEl = $("#corrNewStatus");
    if (!si?.work_start || !inVal) {
      if (autoEl) hideEl(autoEl);
      return;
    }
    const autoSt = calcAutoStatus(inVal, si.work_start, si.late_tolerance);
    if (!autoSt) return;
    if (stEl) stEl.value = autoSt;
    if (autoEl) {
      autoEl.textContent = STATUS_LABEL[autoSt] || autoSt;
      autoEl.className = `corr-auto-badge status-pill pill-${autoSt}`;
      showEl(autoEl);
    }
  }

  async function doSubmit() {
    const reason = ($("#corrReason")?.value || "").trim();
    const newIn = ($("#corrNewIn")?.value || "").trim();
    const newOut = ($("#corrNewOut")?.value || "").trim();
    const newStatus = ($("#corrNewStatus")?.value || "").trim();
    const errEl = $("#corrError");
    const spinner = $("#corrSubmitSpinner");
    const btnSubmit = $("#btnCorrSubmit");

    if (!reason) {
      showEl(errEl);
      errEl.textContent = "Alasan koreksi wajib diisi.";
      return;
    }
    hideEl(errEl);
    showEl(spinner);
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      let res, data;

      if (corrState.logId) {
        const body = { attendance_id: corrState.logId, reason };
        if (newIn) body.new_check_in = newIn;
        if (newOut) body.new_check_out = newOut;
        if (newStatus) body.new_status = newStatus;

        res = await fetchJson(URL_CORR_SAVE, {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        const empId = corrState.empId || $("#corrEmployee")?.value || "";
        const dateVal = $("#corrDate")?.value || "";
        if (!newIn) {
          hideEl(spinner);
          if (btnSubmit) btnSubmit.disabled = false;
          showEl(errEl);
          errEl.textContent = "Jam masuk wajib diisi untuk log baru.";
          return;
        }
        const body = {
          user_id: empId,
          work_date: dateVal,
          check_in: newIn,
          reason,
          status: newStatus || "present",
        };
        if (newOut) body.check_out = newOut;

        res = await fetchJson(URL_LOG_CREATE, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      data = await res.json();
      if (res.ok) {
        toast(data.message || "Berhasil disimpan.");
        closeModal("modalCorr");
        setTimeout(() => location.reload(), 1000);
      } else {
        showEl(errEl);
        errEl.textContent = data.message || "Gagal menyimpan koreksi.";
      }
    } catch (e) {
      showEl(errEl);
      errEl.textContent = "Gagal menghubungi server.";
      console.error(e);
    } finally {
      hideEl(spinner);
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DUPLICATE SCANNER
  // ═══════════════════════════════════════════════════════════════════════════
  function initDuplicateScanner() {
    const btnScan = $("#btnScanDup");
    const btnRefresh = $("#btnRefreshDup");
    if (btnScan)
      btnScan.addEventListener("click", () => {
        switchToTab("duplicates");
        fetchDuplicates();
      });
    if (btnRefresh) btnRefresh.addEventListener("click", fetchDuplicates);

    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const fromEl = $("#dupDateFrom"),
      toEl = $("#dupDateTo");
    if (fromEl) fromEl.value = first.toISOString().slice(0, 10);
    if (toEl) toEl.value = today.toISOString().slice(0, 10);
  }

  async function fetchDuplicates() {
    const fromEl = $("#dupDateFrom"),
      toEl = $("#dupDateTo");
    const params = new URLSearchParams();
    if (fromEl?.value) params.set("date_from", fromEl.value);
    if (toEl?.value) params.set("date_to", toEl.value);

    const loadingEl = $("#dupLoading"),
      emptyEl = $("#dupEmpty");
    const listEl = $("#dupGroupList");
    const badgeEl = $("#dupBadge"),
      tabCount = $("#tabDupCount");
    const summary = $("#dupSummary");

    showEl(loadingEl);
    hideEl(emptyEl);
    if (listEl) listEl.innerHTML = "";

    try {
      const res = await fetch(`${URL_DUPLICATES}?${params}`);
      const data = await res.json();
      dupGroups = data.groups || [];
      hideEl(loadingEl);

      if (dupGroups.length === 0) {
        showEl(emptyEl);
        if (badgeEl) hideEl(badgeEl);
        if (tabCount) hideEl(tabCount);
        if (summary) summary.textContent = "";
      } else {
        const totalLogs = dupGroups.reduce((s, g) => s + g.logs.length, 0);
        if (badgeEl) {
          badgeEl.textContent = dupGroups.length;
          showEl(badgeEl);
        }
        if (tabCount) {
          tabCount.textContent = dupGroups.length;
          showEl(tabCount);
        }
        if (summary)
          summary.textContent = `${dupGroups.length} grup duplikat · ${totalLogs} log total`;
        renderDuplicateGroups(dupGroups);
      }
    } catch (e) {
      hideEl(loadingEl);
      if (listEl)
        listEl.innerHTML = `<div class="form-error" style="display:block">Gagal memuat data duplikat.</div>`;
      console.error(e);
    }
  }

  function renderDuplicateGroups(groups) {
    const listEl = $("#dupGroupList");
    if (!listEl) return;
    listEl.innerHTML = groups
      .map(
        (grp, gi) => `
      <div class="dup-group" data-group-idx="${gi}">
        <div class="dup-group-header">
          <div class="dup-group-identity">
            <div class="mgr-avatar mgr-avatar-sm">${grp.user_name.slice(0, 2).toUpperCase()}</div>
            <div>
              <span class="dup-group-name">${grp.user_name}</span>
              ${grp.user_dept ? `<span class="dup-group-dept">${grp.user_dept}</span>` : ""}
            </div>
          </div>
          <div class="dup-group-meta">
            <span class="dup-date-badge">${formatDate(grp.eff_date)}</span>
            <span class="dup-count-badge">${grp.logs.length} log</span>
          </div>
        </div>
        <div class="dup-log-list">${grp.logs.map((lg) => renderDupLogCard(lg, grp.recommended_keep_id, grp.eff_date)).join("")}</div>
        <div class="dup-group-actions">
          <button class="btn-merge-group" data-group-idx="${gi}">🔀 Merge — Pilih yang Dipertahankan</button>
          <button class="btn-select-all-group" data-group-idx="${gi}">☑ Pilih Semua untuk Bulk Delete</button>
        </div>
      </div>
    `,
      )
      .join("");

    $$(".btn-merge-group").forEach((btn) =>
      btn.addEventListener("click", () =>
        openMergeModal(parseInt(btn.dataset.groupIdx)),
      ),
    );
    $$(".btn-select-all-group").forEach((btn) =>
      btn.addEventListener("click", () =>
        selectAllInGroup(parseInt(btn.dataset.groupIdx)),
      ),
    );
    $$(".dup-log-checkbox").forEach((cb) =>
      cb.addEventListener("change", updateBulkBar),
    );
  }

  // [FIX-2] Tambahkan parameter effDate, pakai effective_date (dari _serialize_log)
  // bukan eff_date yang tidak ada di log object
  function renderDupLogCard(lg, recommendedId, grpEffDate) {
    const isRec = lg.id === recommendedId;
    const srcClass = SOURCE_CLASS[lg.source] || "src-unknown";
    // [FIX-2] _serialize_log mengembalikan "effective_date", bukan "eff_date"
    // Gunakan lg.effective_date untuk group-key agar "Pertahankan" bisa matching
    const effDate = lg.effective_date || grpEffDate || "";
    const groupKey = `${lg.user_id}_${effDate}`;
    return `
      <div class="dup-log-card ${isRec ? "dup-log-recommended" : ""}">
        <label class="dup-log-select-wrap">
          <input type="checkbox" class="dup-log-checkbox" value="${lg.id}" />
        </label>
        <div class="dup-log-content">
          <div class="dup-log-row">
            <span class="dup-log-time">${lg.check_in || "—"} → ${lg.check_out || "—"}</span>
            <span class="status-pill pill-${(lg.status || "").replace("_", "-")}">${STATUS_LABEL[lg.status] || lg.status}</span>
            <span class="dup-log-src ${srcClass}">${SOURCE_LABEL[lg.source] || lg.source}</span>
          </div>
          <div class="dup-log-meta">
            <span>ID: <code>${lg.id.slice(0, 8)}…</code></span>
            <span>Dibuat: ${lg.created_at}</span>
            ${lg.office_name && lg.office_name !== "—" ? `<span>📍 ${lg.office_name}</span>` : ""}
            ${lg.shift_label ? `<span>⏱ ${lg.shift_label}</span>` : ""}
          </div>
          ${isRec ? '<div class="dup-log-rec-badge">⭐ Direkomendasikan dipertahankan</div>' : ""}
          ${lg.is_flagged ? `<div class="dup-log-flag">⚑ ${lg.source === "deleted" ? "Sudah dihapus (soft-delete)" : "Terindikasi masalah"}</div>` : ""}
        </div>
        <div class="dup-log-actions">
          <button class="btn-dup-detail" data-log-id="${lg.id}" title="Lihat detail log ini">👁 Detail</button>
          <button class="btn-dup-keep btn-dup-single-merge"
            data-log-id="${lg.id}"
            data-group-key="${groupKey}"
            title="Pertahankan log ini, hapus lainnya">
            ✓ Pertahankan
          </button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. LOG DETAIL MODAL — [FIX-4] + [FEAT-1] Tombol Restore
  // ═══════════════════════════════════════════════════════════════════════════
  function initLogDetailModal() {
    $("#btnCloseLogDetail")?.addEventListener("click", () =>
      closeModal("modalLogDetail"),
    );
    $("#btnCloseLogDetailFooter")?.addEventListener("click", () =>
      closeModal("modalLogDetail"),
    );

    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-dup-detail");
      if (btn) openDetailModal(btn.dataset.logId);
    });
  }

  // [FIX-4] Fungsi ini juga di-expose ke global agar inline onclick di HTML bisa pakai
  async function openDetailModal(logId) {
    if (!logId) return;
    const bodyEl = $("#logDetailBody");
    const footerEl = $("#logDetailFooter");
    if (!bodyEl) {
      window.open(URL_LOG_DETAIL(logId), "_blank");
      return;
    }
    bodyEl.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Memuat…</div>`;
    // Bersihkan tombol footer dinamis
    if (footerEl) {
      const dynBtns = footerEl.querySelectorAll(".btn-detail-dynamic");
      dynBtns.forEach((b) => b.remove());
    }
    openModal("modalLogDetail");

    try {
      const res = await fetch(URL_LOG_DETAIL(logId));
      const data = await res.json();
      if (!res.ok) {
        bodyEl.innerHTML = `<div class="form-error" style="display:block">${data.message || "Gagal memuat."}</div>`;
        return;
      }

      const corrRows =
        (data.corrections || [])
          .map(
            (c) => `
        <div class="detail-corr-item">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">
            <strong style="font-size:.8rem">${_actionLabel(c.action_type)}</strong>
            <span style="font-size:.75rem;color:var(--text-faint)">${c.created_at}</span>
          </div>
          <span style="font-size:.775rem;color:var(--text-secondary)">oleh ${c.corrector}</span>
          ${
            c.old_status !== "—"
              ? `
            <div style="margin-top:.35rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
              <span style="font-size:.75rem;color:var(--text-muted)">Sebelum:</span>
              <span class="status-pill pill-${c.old_status || "absent"}" style="font-size:.65rem">${STATUS_LABEL[c.old_status] || c.old_status}</span>
              <span style="font-size:.75rem;color:var(--text-muted)">${c.old_in} – ${c.old_out}</span>
            </div>
          `
              : ""
          }
          ${
            c.new_status !== "—"
              ? `
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
              <span style="font-size:.75rem;color:var(--text-muted)">Sesudah:</span>
              <span class="status-pill pill-${c.new_status || "absent"}" style="font-size:.65rem">${STATUS_LABEL[c.new_status] || c.new_status}</span>
              <span style="font-size:.75rem;color:var(--text-muted)">${c.new_in} – ${c.new_out}</span>
            </div>
          `
              : ""
          }
          <div style="margin-top:.3rem;font-size:.75rem;color:var(--text-muted);font-style:italic">${c.reason}</div>
        </div>
      `,
          )
          .join("") ||
        "<p style='color:var(--text-muted);font-size:.8rem'>Belum ada riwayat koreksi.</p>";

      const isDeleted = data.source === "deleted";
      const sourceClass = SOURCE_CLASS[data.source] || "src-unknown";

      bodyEl.innerHTML = `
        ${isDeleted ? `<div class="detail-deleted-notice">⚠️ Log ini sudah dihapus (soft-delete). Data tidak terhitung dalam laporan.</div>` : ""}
        <table>
          <tr><td>Karyawan</td><td><strong>${data.user_name}</strong>${data.user_dept ? ` · <span style="color:var(--text-muted)">${data.user_dept}</span>` : ""}</td></tr>
          <tr><td>Tanggal Efektif</td><td>${formatDate(data.effective_date)}</td></tr>
          <tr><td>Shift</td><td>${data.shift_label || "—"}</td></tr>
          <tr><td>Check-in</td><td><strong>${data.check_in || "—"}</strong></td></tr>
          <tr><td>Check-out</td><td><strong>${data.check_out || "—"}</strong></td></tr>
          <tr><td>Status</td><td><span class="status-pill pill-${data.status}">${STATUS_LABEL[data.status] || data.status}</span></td></tr>
          <tr><td>Sumber</td><td><span class="dup-log-src ${sourceClass}">${SOURCE_LABEL[data.source] || data.source}</span></td></tr>
          <tr><td>Kantor</td><td>${data.office_name || "—"}</td></tr>
          <tr><td>Menit kerja</td><td>${data.working_minutes != null ? data.working_minutes + " mnt" : "—"}</td></tr>
          ${data.is_flagged ? `<tr><td>Flag</td><td style="color:var(--danger);font-size:.8rem">⚑ Terindikasi masalah</td></tr>` : ""}
        </table>
        ${
          data.siblings && data.siblings.length > 0
            ? `
          <div style="margin-top:.75rem;padding:.6rem;background:var(--bg-warning,#fef3c7);border-radius:var(--radius-xs);font-size:.8rem">
            ⚠️ Terdapat ${data.siblings.length} log lain di tanggal ini.
            <button class="btn-secondary" style="margin-left:.5rem;font-size:.75rem;padding:.2rem .5rem"
              onclick="closeModal && closeModal('modalLogDetail');document.querySelector('.corr-tab[data-tab=duplicates]')?.click()">
              Lihat Duplikat
            </button>
          </div>
        `
            : ""
        }
        <div class="detail-corr-history">
          <strong style="font-size:.8rem;color:var(--text-muted)">Riwayat Koreksi (${data.corrections?.length || 0})</strong>
          <div style="margin-top:.5rem">${corrRows}</div>
        </div>
      `;

      // [FEAT-1] Tambahkan tombol Restore ke footer jika log dalam keadaan deleted
      if (isDeleted && footerEl) {
        const restoreBtn = document.createElement("button");
        restoreBtn.className = "btn-corr-add btn-detail-dynamic";
        restoreBtn.style.marginRight = "auto";
        restoreBtn.innerHTML = "↩ Pulihkan Log";
        restoreBtn.addEventListener("click", () => {
          closeModal("modalLogDetail");
          openRestoreModal(logId, data.user_name, data.effective_date);
        });
        footerEl.insertBefore(restoreBtn, footerEl.firstChild);
      }

      // Tambahkan tombol Koreksi / Edit ke footer jika tidak deleted
      if (!isDeleted && footerEl) {
        const editBtn = document.createElement("button");
        editBtn.className = "btn-corr-add btn-detail-dynamic";
        editBtn.style.marginRight = "auto";
        editBtn.innerHTML = "✏️ Koreksi Log Ini";
        editBtn.addEventListener("click", () => {
          closeModal("modalLogDetail");
          // Buka modal koreksi dengan pre-fill karyawan & tanggal
          const user_id = data.user_id;
          const work_date = data.effective_date;
          _openCorrModalForLog(user_id, data.user_name, work_date);
        });
        footerEl.insertBefore(editBtn, footerEl.firstChild);
      }
    } catch (e) {
      bodyEl.innerHTML = `<div class="form-error" style="display:block">Gagal memuat detail log.</div>`;
      console.error(e);
    }
  }

  function _actionLabel(type) {
    const map = {
      correction: "✏️ Koreksi",
      delete: "🗑️ Hapus",
      bulk_delete: "🗑️ Bulk Hapus",
      merge: "🔀 Merge",
      manual: "📝 Manual",
    };
    return map[type] || "Koreksi";
  }

  // Pre-fill modal koreksi dari detail log
  function _openCorrModalForLog(userId, userName, workDate) {
    corrState = {
      empId: userId,
      empName: userName,
      logId: "",
      shiftInfo: null,
      logData: null,
    };
    const empInput = $("#corrEmpSearch");
    const hiddenId = $("#corrEmployee");
    if (empInput) empInput.value = userName;
    if (hiddenId) hiddenId.value = userId;
    const clearBtn = $("#corrEmpClear");
    if (clearBtn) showEl(clearBtn);
    const dateEl = $("#corrDate");
    if (dateEl)
      dateEl.value = workDate || new Date().toISOString().slice(0, 10);
    resetCorrForm();
    openModal("modalCorr");
    // Auto-lookup
    setTimeout(doLookup, 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [FEAT-1] RESTORE MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  function openRestoreModal(logId, userName, workDate) {
    // Re-use confirm delete modal untuk restore — buat dinamis
    const msgEl = $("#confirmDeleteMsg");
    const reasonEl = $("#confirmDeleteReason");
    const errEl = $("#confirmDeleteError");
    const titleEl = $(".modal-title", $("#modalConfirmDelete"));

    if (titleEl) titleEl.textContent = "↩ Konfirmasi Pulihkan Log";
    if (msgEl)
      msgEl.textContent = `Pulihkan log absensi ${userName} pada ${formatDate(workDate)}?`;
    if (reasonEl) reasonEl.value = "";
    if (errEl) {
      hideEl(errEl);
      errEl.textContent = "";
    }

    const doBtn = $("#btnDoDelete");
    if (doBtn) doBtn.innerHTML = "↩ Pulihkan";

    pendingDeleteCb = async (reason) => {
      const res = await fetchJson(URL_LOG_RESTORE(logId), {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || "Log berhasil dipulihkan.");
        setTimeout(() => location.reload(), 1000);
      } else {
        throw new Error(data.message || "Gagal memulihkan log.");
      }
    };

    openModal("modalConfirmDelete");
    if (reasonEl) reasonEl.focus();

    // Reset tombol setelah modal ditutup
    const restoreOnClose = () => {
      if (doBtn)
        doBtn.innerHTML = `<span id="deleteSpinner" style="display:none">⏳</span> 🗑️ Hapus`;
      if (titleEl) titleEl.textContent = "🗑️ Konfirmasi Hapus";
    };
    $("#btnCancelConfirmDelete")?.addEventListener("click", restoreOnClose, {
      once: true,
    });
    $("#btnCloseConfirmDelete")?.addEventListener("click", restoreOnClose, {
      once: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. MODAL MERGE
  // ═══════════════════════════════════════════════════════════════════════════
  function initMergeModal() {
    $("#btnCloseMerge")?.addEventListener("click", closeMergeModal);
    $("#btnCancelMerge")?.addEventListener("click", closeMergeModal);

    $("#btnConfirmMerge")?.addEventListener("click", async () => {
      const reason = ($("#mergeReason")?.value || "").trim();
      const errEl = $("#mergeError");
      if (!reason) {
        showEl(errEl);
        errEl.textContent = "Alasan merge wajib diisi.";
        return;
      }
      hideEl(errEl);
      const keepId = $('input[name="mergeKeep"]:checked')?.value;
      if (!keepId) {
        showEl(errEl);
        errEl.textContent = "Pilih log yang dipertahankan.";
        return;
      }

      const deleteIds = currentMergeGroup.logs
        .map((l) => l.id)
        .filter((id) => id !== keepId);
      const spinner = $("#mergeSpinner"),
        btn = $("#btnConfirmMerge");
      showEl(spinner);
      btn.disabled = true;

      try {
        const res = await fetchJson(URL_MERGE, {
          method: "POST",
          body: JSON.stringify({
            keep_id: keepId,
            delete_ids: deleteIds,
            reason,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast(data.message || "Merge berhasil.");
          closeMergeModal();
          fetchDuplicates();
        } else {
          showEl(errEl);
          errEl.textContent = data.message || "Gagal melakukan merge.";
        }
      } catch (e) {
        showEl(errEl);
        errEl.textContent = "Gagal menghubungi server.";
      } finally {
        hideEl(spinner);
        btn.disabled = false;
      }
    });

    document.addEventListener("change", (e) => {
      if (e.target.name === "mergeKeep") {
        const btn = $("#btnConfirmMerge");
        if (btn) btn.disabled = false;
      }
    });
  }

  function closeMergeModal() {
    closeModal("modalMerge");
    currentMergeGroup = null;
  }

  function openMergeModal(groupIdx) {
    currentMergeGroup = dupGroups[groupIdx];
    if (!currentMergeGroup) return;
    const cardsEl = $("#mergeLogCards");
    if (!cardsEl) return;

    cardsEl.innerHTML = currentMergeGroup.logs
      .map((lg) => {
        const isRec = lg.id === currentMergeGroup.recommended_keep_id;
        const srcClass = SOURCE_CLASS[lg.source] || "";
        return `
        <label class="merge-card ${isRec ? "merge-card-rec" : ""}">
          <input type="radio" name="mergeKeep" value="${lg.id}" ${isRec ? "checked" : ""} />
          <div class="merge-card-content">
            <div class="merge-card-row">
              <span class="merge-card-time">${lg.check_in || "—"} → ${lg.check_out || "—"}</span>
              <span class="status-pill pill-${(lg.status || "").replace("_", "-")}">${STATUS_LABEL[lg.status] || lg.status}</span>
              <span class="dup-log-src ${srcClass}">${SOURCE_LABEL[lg.source] || lg.source}</span>
            </div>
            <div class="merge-card-meta">Dibuat: ${lg.created_at}${isRec ? " · <strong>Direkomendasikan</strong>" : ""}</div>
          </div>
          ${isRec ? '<span class="merge-rec-star">⭐</span>' : ""}
        </label>
      `;
      })
      .join("");

    const errEl = $("#mergeError");
    if (errEl) {
      hideEl(errEl);
      errEl.textContent = "";
    }
    const reasonEl = $("#mergeReason");
    if (reasonEl) reasonEl.value = "";
    const btnConfirm = $("#btnConfirmMerge");
    if (btnConfirm)
      btnConfirm.disabled = !currentMergeGroup.recommended_keep_id;
    openModal("modalMerge");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. BULK DELETE
  // ═══════════════════════════════════════════════════════════════════════════
  function selectAllInGroup(groupIdx) {
    const grp = dupGroups[groupIdx];
    if (!grp) return;
    $$(".dup-log-checkbox").forEach((cb) => {
      if (
        grp.logs.some((l) => l.id === cb.value) &&
        cb.value !== grp.recommended_keep_id
      ) {
        cb.checked = true;
        bulkSelectedIds.add(cb.value);
      }
    });
    updateBulkBar();
  }

  function updateBulkBar() {
    bulkSelectedIds.clear();
    $$(".dup-log-checkbox:checked").forEach((cb) =>
      bulkSelectedIds.add(cb.value),
    );
    const bar = $("#bulkBar"),
      count = $("#bulkSelectedCount");
    if (bulkSelectedIds.size > 0) {
      showEl(bar);
      if (count) count.textContent = `${bulkSelectedIds.size} log dipilih`;
    } else hideEl(bar);
  }

  function initBulkDelete() {
    $("#btnBulkDelete")?.addEventListener("click", () => {
      if (!bulkSelectedIds.size) return;
      openConfirmDelete(
        `Hapus ${bulkSelectedIds.size} log yang dipilih secara permanen?`,
        async (reason) => {
          const res = await fetchJson(URL_BULK_DELETE, {
            method: "POST",
            body: JSON.stringify({ ids: [...bulkSelectedIds], reason }),
          });
          const data = await res.json();
          if (res.ok) {
            toast(data.message || `${data.deleted_count} log dihapus.`);
            bulkSelectedIds.clear();
            updateBulkBar();
            fetchDuplicates();
          } else throw new Error(data.message || "Gagal menghapus.");
        },
      );
    });

    $("#btnBulkCancel")?.addEventListener("click", () => {
      $$(".dup-log-checkbox").forEach((cb) => (cb.checked = false));
      bulkSelectedIds.clear();
      updateBulkBar();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SINGLE LOG QUICK-KEEP
  // ═══════════════════════════════════════════════════════════════════════════
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-dup-single-merge");
    if (!btn) return;
    const keepId = btn.dataset.logId;
    const groupKey = btn.dataset.groupKey;
    // [FIX-2] Cari grup berdasarkan key yang sudah menggunakan effective_date
    const grp = dupGroups.find((g) => {
      // Cek kecocokan dengan user_id dan eff_date (dari API response group)
      const gKey = `${g.user_id}_${g.eff_date}`;
      // Atau match dengan effective_date dari log
      return (
        gKey === groupKey ||
        g.logs.some((l) => `${l.user_id}_${l.effective_date}` === groupKey)
      );
    });
    if (!grp) {
      toast("Grup tidak ditemukan.", "error");
      return;
    }
    const deleteIds = grp.logs.map((l) => l.id).filter((id) => id !== keepId);
    if (!deleteIds.length) {
      toast("Tidak ada log lain untuk dihapus.", "info");
      return;
    }
    openConfirmDelete(
      `Pertahankan log ini dan hapus ${deleteIds.length} log duplikat lainnya?`,
      async (reason) => {
        const res = await fetchJson(URL_MERGE, {
          method: "POST",
          body: JSON.stringify({
            keep_id: keepId,
            delete_ids: deleteIds,
            reason,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast(data.message || "Merge berhasil.");
          fetchDuplicates();
        } else throw new Error(data.message || "Gagal merge.");
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. MODAL KONFIRMASI HAPUS (shared)
  // ═══════════════════════════════════════════════════════════════════════════
  function openConfirmDelete(message, onConfirm, prefillReason = "") {
    const msgEl = $("#confirmDeleteMsg"),
      reasonEl = $("#confirmDeleteReason");
    const errEl = $("#confirmDeleteError");
    const titleEl = $(".modal-title", $("#modalConfirmDelete"));
    // Reset judul ke default
    if (titleEl) titleEl.textContent = "🗑️ Konfirmasi Hapus";
    const doBtn = $("#btnDoDelete");
    if (doBtn)
      doBtn.innerHTML = `<span id="deleteSpinner" style="display:none">⏳</span> 🗑️ Hapus`;

    if (msgEl) msgEl.textContent = message;
    if (reasonEl) reasonEl.value = prefillReason;
    if (errEl) {
      hideEl(errEl);
      errEl.textContent = "";
    }
    pendingDeleteCb = onConfirm;
    openModal("modalConfirmDelete");
    if (reasonEl) reasonEl.focus();
  }

  function initConfirmDeleteModal() {
    const btnDo = $("#btnDoDelete");
    const errEl = $("#confirmDeleteError");
    [$("#btnCloseConfirmDelete"), $("#btnCancelConfirmDelete")].forEach((btn) =>
      btn?.addEventListener("click", () => {
        closeModal("modalConfirmDelete");
        pendingDeleteCb = null;
      }),
    );
    btnDo?.addEventListener("click", async () => {
      const reason = ($("#confirmDeleteReason")?.value || "").trim();
      if (!reason) {
        showEl(errEl);
        errEl.textContent = "Alasan wajib diisi.";
        return;
      }
      if (!pendingDeleteCb) return;
      const spinner = $("#deleteSpinner");
      showEl(spinner);
      btnDo.disabled = true;
      try {
        await pendingDeleteCb(reason);
        closeModal("modalConfirmDelete");
        pendingDeleteCb = null;
      } catch (e) {
        showEl(errEl);
        errEl.textContent = e.message || "Terjadi kesalahan.";
      } finally {
        hideEl(spinner);
        btnDo.disabled = false;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. FILTER TABEL HISTORY — [FEAT-2] Tambah date filter + server-side search
  // ═══════════════════════════════════════════════════════════════════════════
  function initActionFilter() {
    const actionFilter = $("#corrActionFilter");
    const statusFilter = $("#corrStatusFilter");
    const searchInput = $("#corrSearch");
    if (!actionFilter) return;

    // Client-side filter (untuk data yang sudah dimuat dari server)
    [actionFilter, statusFilter].forEach((el) =>
      el?.addEventListener("change", applyAllFilters),
    );
    searchInput?.addEventListener("input", applyAllFilters);

    // Server-side filter via tombol Apply Filter (jika ada date filter)
    const btnApplyFilter = $("#btnApplyHistFilter");
    if (btnApplyFilter) {
      btnApplyFilter.addEventListener("click", () => {
        const dateFrom = $("#histDateFrom")?.value || "";
        const dateTo = $("#histDateTo")?.value || "";
        const uid = $("#histEmpFilter")?.value || "";
        const action = actionFilter?.value || "";
        const url = new URL(window.location.href);
        if (dateFrom) url.searchParams.set("date_from", dateFrom);
        else url.searchParams.delete("date_from");
        if (dateTo) url.searchParams.set("date_to", dateTo);
        else url.searchParams.delete("date_to");
        if (uid) url.searchParams.set("user_id", uid);
        else url.searchParams.delete("user_id");
        if (action) url.searchParams.set("action", action);
        else url.searchParams.delete("action");
        url.searchParams.delete("page"); // reset ke hal. 1
        window.location.href = url.toString();
      });
    }

    function applyAllFilters() {
      const searchVal = (searchInput?.value || "").toLowerCase().trim();
      const statusVal = statusFilter?.value || "";
      const actionVal = actionFilter.value || "";
      const rows = $$("#corrBody tr[data-name]");
      let visible = 0;
      rows.forEach((row) => {
        const show =
          (!searchVal || row.dataset.name?.includes(searchVal)) &&
          (!statusVal || row.dataset.status === statusVal) &&
          (!actionVal || row.dataset.action === actionVal);
        row.style.display = show ? "" : "none";
        if (show) visible++;
      });
      const noResults = $("#corrNoResults");
      if (noResults)
        noResults.style.display =
          visible === 0 && rows.length > 0 ? "block" : "none";
      const countEl = $("#corrCount");
      if (countEl) countEl.textContent = `${visible} entri`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. ABSENSI HILANG — [BUG-6 FIX]
  // Deteksi hari kerja tanpa log absensi dalam rentang tanggal tertentu.
  // ═══════════════════════════════════════════════════════════════════════════
  let missingData = [];

  function initMissingDates() {
    // Set default range: 7 hari terakhir
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    const fromEl = $("#missingDateFrom");
    const toEl = $("#missingDateTo");
    if (fromEl) fromEl.value = weekAgo.toISOString().slice(0, 10);
    if (toEl) toEl.value = today.toISOString().slice(0, 10);

    $("#btnCheckMissing")?.addEventListener("click", checkMissingDates);

    // Tombol "Buat Semua (Absent)" — buat log absent untuk semua yang hilang
    $("#btnFillAllMissing")?.addEventListener("click", () => {
      if (!missingData.length) return;
      if (
        !confirm(
          `Buat ${missingData.length} log absent secara bulk? Aksi ini tidak bisa dibatalkan.`,
        )
      )
        return;
      bulkCreateAbsent(missingData);
    });
  }

  async function checkMissingDates() {
    const dateFrom = $("#missingDateFrom")?.value || "";
    const dateTo = $("#missingDateTo")?.value || "";
    const userId = $("#missingUserFilter")?.value || "";

    const loadingEl = $("#missingLoading");
    const emptyEl = $("#missingEmpty");
    const resultsEl = $("#missingResults");
    const promptEl = $("#missingPrompt");
    const summaryEl = $("#missingSummary");

    if (!dateFrom || !dateTo) {
      toast("Pilih rentang tanggal terlebih dahulu.", "warning");
      return;
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if ((to - from) / 86400000 > 31) {
      toast("Range maksimal 31 hari.", "warning");
      return;
    }

    showEl(loadingEl);
    hideEl(emptyEl);
    hideEl(resultsEl);
    hideEl(promptEl);
    if (summaryEl) summaryEl.textContent = "";

    let url = `${URL_MISSING_DATES}?date_from=${dateFrom}&date_to=${dateTo}`;
    if (userId) url += `&user_id=${encodeURIComponent(userId)}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      hideEl(loadingEl);

      if (!res.ok) {
        toast(data.message || "Gagal memuat data.", "error");
        showEl(promptEl);
        return;
      }

      missingData = data.missing || [];
      const total = data.total || 0;

      if (summaryEl) {
        summaryEl.textContent =
          total > 0
            ? `${total} absensi hilang ditemukan`
            : "Tidak ada absensi hilang";
      }

      // Update badge pada tab
      const badge = $("#tabMissingCount");
      if (badge) {
        if (total > 0) {
          badge.textContent = total;
          showEl(badge);
        } else {
          hideEl(badge);
        }
      }

      if (total === 0) {
        showEl(emptyEl);
        return;
      }

      // Render tabel hasil
      const titleEl = $("#missingResultTitle");
      if (titleEl)
        titleEl.textContent = `⚠️ ${total} absensi hilang pada ${dateFrom} – ${dateTo}`;

      const tbody = $("#missingTableBody");
      if (tbody) {
        tbody.innerHTML = missingData
          .map(
            (item) => `
          <tr>
            <td>
              <div class="mgr-employee-cell">
                <div class="mgr-avatar">${item.full_name.slice(0, 2).toUpperCase()}</div>
                <span class="mgr-emp-name">${item.full_name}</span>
              </div>
            </td>
            <td class="mgr-td-mono">${formatDate(item.date)}</td>
            <td class="mgr-td-muted">${item.day_name}</td>
            <td>
              <button
                class="btn-detail-corr"
                onclick="window.openCreateManualModal('${item.user_id}', '${item.date}')"
              >
                📝 Buat Manual
              </button>
            </td>
          </tr>
        `,
          )
          .join("");
      }

      showEl(resultsEl);
    } catch (e) {
      hideEl(loadingEl);
      showEl(promptEl);
      toast("Gagal menghubungi server.", "error");
      console.error(e);
    }
  }

  // Buat log absent secara bulk untuk semua entri hilang
  async function bulkCreateAbsent(items) {
    let success = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const res = await fetchJson(URL_LOG_CREATE, {
          method: "POST",
          body: JSON.stringify({
            user_id: item.user_id,
            work_date: item.date,
            check_in: null,
            status: "absent",
            reason: "[BULK] Auto-fill absensi hilang",
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      toast(`✅ ${success} log absent berhasil dibuat.`);
    } else {
      toast(`${success} berhasil, ${failed} gagal.`, "warning");
    }
    // Refresh deteksi
    checkMissingDates();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════
  function init() {
    initTabs();
    initDuplicateScanner();
    initMergeModal();
    initBulkDelete();
    initConfirmDeleteModal();
    initActionFilter();
    initLogDetailModal();
    initEmployeeAutocomplete();
    initCorrModal();
    initMissingDates(); // [BUG-6 FIX]

    if (location.hash === "#duplikat") switchToTab("duplicates");
    if (location.hash === "#hilang") switchToTab("missing"); // [BUG-6 FIX]
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ── Expose API publik
  window.CorrDup = {
    openDetail: openDetailModal,
    fetchDuplicates: fetchDuplicates,
    switchToTab: switchToTab,
    openRestoreModal: openRestoreModal,
  };

  // [FIX-4] openLogDetail global — dipanggil dari inline onclick HTML
  window.openLogDetail = function (logId) {
    openDetailModal(logId);
  };

  // [BUG-6 FIX] openCreateManualModal — dipanggil dari tabel Absensi Hilang
  // Pre-fill modal koreksi dengan user_id dan date, lalu trigger lookup otomatis.
  window.openCreateManualModal = function (userId, dateStr) {
    // Buka modal dengan state bersih
    openCorrModal();

    // Pre-fill employee dari hidden source select
    const sourceSelect = document.getElementById("corrEmployeeSource");
    if (sourceSelect) {
      const opt = [...sourceSelect.options].find((o) => o.value === userId);
      if (opt) {
        const empSearch = document.getElementById("corrEmpSearch");
        const empHidden = document.getElementById("corrEmployee");
        if (empSearch) empSearch.value = opt.text;
        if (empHidden) empHidden.value = userId;
        corrState.empId = userId;
        corrState.empName = opt.text;
        const clearBtn = document.getElementById("corrEmpClear");
        if (clearBtn) clearBtn.style.display = "";
      }
    }

    // Pre-fill tanggal
    if (dateStr) {
      const dateEl = document.getElementById("corrDate");
      if (dateEl) dateEl.value = dateStr;
    }

    // Auto-trigger lookup setelah animasi modal selesai
    if (userId && dateStr) {
      setTimeout(() => doLookup(), 150);
    }
  };
})();
