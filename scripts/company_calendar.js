/**
 * kalender.js — Kalender Perusahaan
 * Menampilkan kalender bulanan dengan libur nasional, cuti bersama,
 * libur mingguan, dan libur perusahaan.
 *
 * Aturan edit/hapus: hanya boleh dilakukan paling lambat hari H
 * (tanggal libur itu sendiri). Hari berikutnya sudah terkunci.
 */
(function () {
  "use strict";

  /* ── Konstanta & state ───────────────────────────────────────── */
  var I18N = window.KAL_I18N || {};
  var DAYOFFS = window.KAL_DAYOFFS || []; // array dari server
  var TODAY = window.KAL_TODAY || ""; // "YYYY-MM-DD"

  var todayParts = TODAY.split("-");
  var todayYear = parseInt(todayParts[0], 10);
  var todayMonth = parseInt(todayParts[1], 10) - 1; // 0-based
  var todayDay = parseInt(todayParts[2], 10);

  var curYear = todayYear;
  var curMonth = todayMonth; // 0-based

  /* ── Helpers ─────────────────────────────────────────────────── */
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function toISO(y, m, d) {
    return y + "-" + pad2(m + 1) + "-" + pad2(d);
  }

  function formatDateLabel(isoStr) {
    // "YYYY-MM-DD" → "D Bulan YYYY"
    var p = isoStr.split("-");
    return (
      parseInt(p[2], 10) +
      " " +
      (I18N.months || [])[parseInt(p[1], 10) - 1] +
      " " +
      p[0]
    );
  }

  /**
   * Apakah tanggal ISO sudah lewat dari hari ini (past H)?
   * Hari H sendiri (today) masih boleh edit/hapus.
   */
  function isPastDeadline(isoStr) {
    return isoStr < TODAY; // string comparison: YYYY-MM-DD lexicographic
  }

  /* Tipe → kelas CSS & label */
  function typeClass(t) {
    return (
      {
        nasional: "kal-event--nasional",
        bersama: "kal-event--bersama",
        mingguan: "kal-event--mingguan",
        perusahaan: "kal-event--perusahaan",
      }[t] || "kal-event--perusahaan"
    );
  }
  function typeDotClass(t) {
    return (
      {
        nasional: "dot-nasional",
        bersama: "dot-bersama",
        mingguan: "dot-mingguan",
        perusahaan: "dot-perusahaan",
      }[t] || "dot-perusahaan"
    );
  }
  function typeLabel(t) {
    return (I18N.typeLabels || {})[t] || t;
  }

  /* ── Scroll lock ─────────────────────────────────────────────── */
  var _locks = 0;
  function lockScroll() {
    _locks++;
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    _locks = Math.max(0, _locks - 1);
    if (!_locks) document.body.style.overflow = "";
  }
  window.addEventListener("pageshow", function () {
    _locks = 0;
    document.body.style.overflow = "";
  });

  /* ── Modal helpers ───────────────────────────────────────────── */
  function openModal(overlay, focusEl) {
    overlay.classList.add("is-open");
    overlay.removeAttribute("aria-hidden");
    lockScroll();
    setTimeout(function () {
      var el =
        focusEl ||
        overlay.querySelector("button:not([disabled]),input,select,textarea");
      if (el) el.focus();
    }, 50);
  }
  function closeModal(overlay) {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    unlockScroll();
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  function showToast(msg, type) {
    var wrap = document.querySelector(".flash-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "flash-wrap";
      document.body.appendChild(wrap);
    }
    var el = document.createElement("div");
    el.className = "flash flash-" + (type || "info");
    el.setAttribute("role", "alert");
    var span = document.createElement("span");
    span.textContent = msg;
    var btn = document.createElement("button");
    btn.className = "flash-close";
    btn.setAttribute("aria-label", I18N.closeLabel || "Tutup");
    btn.textContent = "×";
    btn.onclick = function () {
      el.remove();
    };
    el.appendChild(span);
    el.appendChild(btn);
    wrap.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 5000);
  }

  /* ── CSRF ─────────────────────────────────────────────────────── */
  function csrf() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute("content") : "";
  }

  /* ── Fetch JSON ──────────────────────────────────────────────── */
  function fetchJSON(url, opts) {
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    if (ctrl) {
      opts = Object.assign({}, opts, { signal: ctrl.signal });
      timer = setTimeout(function () {
        ctrl.abort();
      }, 15000);
    }
    return fetch(url, opts).then(
      function (r) {
        if (timer) clearTimeout(timer);
        return r;
      },
      function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      },
    );
  }

  /* ══════════════════════════════════════════════════════════════
     KALENDER RENDER
     ══════════════════════════════════════════════════════════════ */

  var grid = document.getElementById("kalGrid");
  var navTitle = document.getElementById("kalNavTitle");
  var yearSelect = document.getElementById("kalYearSelect");

  /** Kembalikan array dayoff pada iso tertentu */
  function dayoffsOnDate(isoStr) {
    return DAYOFFS.filter(function (d) {
      return d.date === isoStr;
    });
  }

  function renderCalendar() {
    if (!grid) return;

    // Update title
    if (navTitle) {
      navTitle.textContent = (I18N.months || [])[curMonth] + " " + curYear;
    }
    if (yearSelect) yearSelect.value = curYear;
    if (monthSelect) monthSelect.value = curMonth;

    // First day of month (0=Sun)
    var firstDay = new Date(curYear, curMonth, 1).getDay();
    var daysInMon = new Date(curYear, curMonth + 1, 0).getDate();
    var daysInPrev = new Date(curYear, curMonth, 0).getDate();

    grid.innerHTML = "";

    var totalCells = Math.ceil((firstDay + daysInMon) / 7) * 7;

    for (var i = 0; i < totalCells; i++) {
      var cell = document.createElement("div");
      cell.className = "kal-day";

      var colDay = i % 7; // 0=Sun, 6=Sat
      var dayNum, isoStr, outside;

      if (i < firstDay) {
        // Previous month
        dayNum = daysInPrev - firstDay + i + 1;
        var pm = curMonth === 0 ? 11 : curMonth - 1;
        var py = curMonth === 0 ? curYear - 1 : curYear;
        isoStr = toISO(py, pm, dayNum);
        outside = true;
      } else if (i >= firstDay + daysInMon) {
        // Next month
        dayNum = i - firstDay - daysInMon + 1;
        var nm = curMonth === 11 ? 0 : curMonth + 1;
        var ny = curMonth === 11 ? curYear + 1 : curYear;
        isoStr = toISO(ny, nm, dayNum);
        outside = true;
      } else {
        dayNum = i - firstDay + 1;
        isoStr = toISO(curYear, curMonth, dayNum);
        outside = false;
      }

      if (outside) cell.classList.add("kal-day--outside");
      if (isoStr === TODAY) cell.classList.add("kal-day--today");

      // Events for this cell
      var events = dayoffsOnDate(isoStr);

      // ── Day number ────────────────────────────────────────── //
      var numEl = document.createElement("div");
      numEl.className = "kal-day-num";
      numEl.textContent = dayNum;

      // ── Events wrap ───────────────────────────────────────── //
      var evWrap = document.createElement("div");
      evWrap.className = "kal-day-events";

      var maxShow = 3; /* dengan height fixed 110px bisa muat ~3 chip */
      var shown = 0;
      events.forEach(function (ev, idx) {
        if (idx < maxShow) {
          var expired = isPastDeadline(ev.date);
          var chip = document.createElement("div");
          chip.className = "kal-event " + typeClass(ev.dayoff_type);
          if (expired) chip.classList.add("kal-event--expired");

          /* Chip hanya tampilkan label jenis libur (singkat & fixed)
             Detail nama/keterangan muncul di popover saat diklik */
          chip.textContent = typeLabel(ev.dayoff_type);
          chip.dataset.id = ev.id;

          evWrap.appendChild(chip);
          shown++;
        }
      });
      if (events.length > maxShow) {
        var more = document.createElement("div");
        more.className = "kal-event kal-event--more";
        more.textContent = "+" + (events.length - maxShow) + " lainnya";
        evWrap.appendChild(more);
      }

      cell.appendChild(evWrap);
      cell.appendChild(numEl);

      // Store data for popover
      cell.dataset.iso = isoStr;
      cell.dataset.dayNum = dayNum;
      cell.dataset.col = colDay;

      // Clickable: buka tambah modal prefill date (only non-outside)
      if (!outside) {
        cell.classList.add("kal-day--clickable");
      }

      grid.appendChild(cell);
    }

    renderUpcoming();
  }

  /* ── Upcoming panel ──────────────────────────────────────────── */
  function renderUpcoming() {
    var listEl = document.getElementById("upcomingList");
    if (!listEl) return;

    /* Prefix bulan aktif: "YYYY-MM" */
    var monthPrefix =
      curYear + "-" + (curMonth + 1 < 10 ? "0" : "") + (curMonth + 1);

    /* Filter hanya tanggal dalam bulan yang sedang ditampilkan */
    var monthDayoffs = DAYOFFS.filter(function (d) {
      return d.date.substring(0, 7) === monthPrefix;
    }).sort(function (a, b) {
      return a.date > b.date ? 1 : -1;
    });

    if (!monthDayoffs.length) {
      listEl.innerHTML =
        '<p class="kal-upcoming-empty">' +
        (I18N.noUpcomingMonth ||
          I18N.noUpcoming ||
          "Tidak ada libur pada bulan ini.") +
        "</p>";
      return;
    }

    listEl.innerHTML = "";
    monthDayoffs.forEach(function (ev) {
      var p = ev.date.split("-");
      var mon = parseInt(p[1], 10) - 1;
      var day = parseInt(p[2], 10);

      var item = document.createElement("div");
      item.className = "kal-upcoming-item";

      var box = document.createElement("div");
      box.className = "kal-upcoming-datebox datebox--" + ev.dayoff_type;
      var monSpan = document.createElement("span");
      monSpan.textContent = ((I18N.months || [])[mon] || "")
        .substring(0, 3)
        .toUpperCase();
      var daySpan = document.createElement("span");
      daySpan.className = "kal-upcoming-datebox-day";
      daySpan.textContent = day;
      box.appendChild(monSpan);
      box.appendChild(daySpan);

      var info = document.createElement("div");
      info.className = "kal-upcoming-info";
      var name = document.createElement("div");
      name.className = "kal-upcoming-name";
      name.textContent = ev.name;
      var sub = document.createElement("div");
      sub.className = "kal-upcoming-sub";
      sub.textContent =
        typeLabel(ev.dayoff_type) +
        (ev.scope_label ? " · " + ev.scope_label : "");
      info.appendChild(name);
      info.appendChild(sub);

      /* Tombol aksi hanya untuk yang belum expired */
      if (!isPastDeadline(ev.date)) {
        var itemActions = document.createElement("div");
        itemActions.className = "kal-upcoming-item-actions";

        var upEditBtn = document.createElement("button");
        upEditBtn.className = "kal-upcoming-item-btn";
        upEditBtn.title = I18N.editLabel || "Edit";
        upEditBtn.setAttribute(
          "aria-label",
          (I18N.editLabel || "Edit") + " " + ev.name,
        );
        upEditBtn.innerHTML =
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        upEditBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openEditModal(ev.id, ev.name, ev.note || "", ev.date);
        });

        var upDelBtn = document.createElement("button");
        upDelBtn.className = "kal-upcoming-item-btn is-danger";
        upDelBtn.title = I18N.deleteLabel || "Hapus";
        upDelBtn.setAttribute(
          "aria-label",
          (I18N.deleteLabel || "Hapus") + " " + ev.name,
        );
        upDelBtn.innerHTML =
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
        upDelBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openDeleteModal(ev.id, ev.name, formatDateLabel(ev.date), ev.date);
        });

        itemActions.appendChild(upEditBtn);
        itemActions.appendChild(upDelBtn);
        item.appendChild(itemActions);
      }

      item.appendChild(box);
      item.appendChild(info);
      listEl.appendChild(item);
    });
  }

  /* ── Navigation ──────────────────────────────────────────────── */
  var btnPrev = document.getElementById("btnPrevMonth");
  var btnNext = document.getElementById("btnNextMonth");

  if (btnPrev) {
    btnPrev.addEventListener("click", function () {
      curMonth--;
      if (curMonth < 0) {
        curMonth = 11;
        curYear--;
      }
      renderCalendar();
    });
  }
  if (btnNext) {
    btnNext.addEventListener("click", function () {
      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
      renderCalendar();
    });
  }
  if (yearSelect) {
    yearSelect.addEventListener("change", function () {
      curYear = parseInt(this.value, 10);
      renderCalendar();
    });
  }

  var monthSelect = document.getElementById("kalMonthSelect");
  if (monthSelect) {
    monthSelect.addEventListener("change", function () {
      curMonth = parseInt(this.value, 10);
      renderCalendar();
    });
  }

  /* ══════════════════════════════════════════════════════════════
     POPOVER (hover pada cell atau event chip)
     ══════════════════════════════════════════════════════════════ */
  var popover = document.getElementById("kalPopover");
  var popTimer = null;
  var popVisible = false;
  var activeEditId = null;
  var activeDeleteId = null;
  var activeCell = null;

  function showPopover(cellEl, isoStr) {
    if (!popover) return;
    var events = dayoffsOnDate(isoStr);
    if (!events.length) {
      hidePopover();
      return;
    }

    var p = isoStr.split("-");
    var dateLabel =
      parseInt(p[2], 10) +
      " " +
      ((I18N.months || [])[parseInt(p[1], 10) - 1] || "") +
      " " +
      p[0];

    var html = '<div class="kal-popover-date">' + dateLabel + "</div>";

    events.forEach(function (ev) {
      var expired = isPastDeadline(ev.date);
      html += '<div class="kal-popover-event">';
      html +=
        '<span class="kal-popover-dot ' +
        typeDotClass(ev.dayoff_type) +
        '"></span>';
      html += '<div class="kal-popover-info">';
      html += '<div class="kal-popover-name">' + escHtml(ev.name) + "</div>";
      html += '<div class="kal-popover-sub">' + typeLabel(ev.dayoff_type);
      if (ev.scope_label) html += " · " + escHtml(ev.scope_label);
      if (ev.note) html += " · " + escHtml(ev.note);
      html += "</div>";
      if (!expired) {
        html += '<div class="kal-popover-actions">';
        html +=
          '<button class="btn-edit-pop" data-id="' +
          ev.id +
          '" data-name="' +
          escAttr(ev.name) +
          '" data-note="' +
          escAttr(ev.note || "") +
          '" data-date="' +
          ev.date +
          '">✎ Edit</button>';
        html +=
          '<button class="btn-del-pop" data-id="' +
          ev.id +
          '" data-name="' +
          escAttr(ev.name) +
          '" data-date="' +
          ev.date +
          '" data-label="' +
          escAttr(dateLabel) +
          '">✕ Hapus</button>';
        html += "</div>";
      } else {
        html +=
          '<div class="kal-popover-sub" style="color:#ef4444;margin-top:3px;font-size:.65rem">🔒 ' +
          (I18N.expiredMsg || "Tidak dapat diubah") +
          "</div>";
      }
      html += "</div></div>";
    });

    popover.innerHTML = html;

    /* Posisi popover — pakai getBoundingClientRect untuk position:fixed.
       Render dulu (visible tapi opacity 0) lalu baca ukuran aktual.       */
    popover.style.visibility = "hidden";
    popover.style.display = "block";
    var pw = popover.offsetWidth || 268;
    var ph = popover.offsetHeight || 180;
    popover.style.visibility = "";
    popover.style.display = "";

    var rect = cellEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    /* Horizontal: coba sejajar kiri cell, tapi jangan keluar layar */
    var left = rect.left;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;

    /* Vertikal: prefer di bawah cell, fallback di atas */
    var topBelow = rect.bottom + 4;
    var topAbove = rect.top - ph - 4;
    var top = topBelow + ph > vh - 8 && topAbove > 8 ? topAbove : topBelow;
    if (top < 8) top = topBelow;

    popover.style.left = left + "px";
    popover.style.top = top + "px";
    popover.classList.add("is-visible");
    popover.setAttribute("aria-hidden", "false");
    popVisible = true;
  }

  function hidePopover() {
    if (!popover) return;
    popover.classList.remove("is-visible");
    popover.setAttribute("aria-hidden", "true");
    popVisible = false;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escAttr(s) {
    return escHtml(s);
  }

  /* Delegation: CLICK on grid cells to show popover (bukan hover) */
  if (grid) {
    grid.addEventListener("click", function (e) {
      /* Ignore klik pada chip yang sudah ada aksi di popover */
      var chip = e.target.closest(".kal-event");
      var cell = e.target.closest(".kal-day");
      if (!cell || !cell.dataset.iso) return;

      /* Jika popover sudah tampil untuk cell yang sama, sembunyikan */
      if (popVisible && activeCell === cell) {
        hidePopover();
        return;
      }

      var events = dayoffsOnDate(cell.dataset.iso);
      if (!events.length) {
        /* Tidak ada libur — buka modal tambah (hanya untuk non-outside) */
        if (cell.classList.contains("kal-day--clickable")) {
          hidePopover();
          openTambahModal(cell.dataset.iso);
        }
        return;
      }

      /* Ada libur → tampilkan popover */
      activeCell = cell;
      showPopover(cell, cell.dataset.iso);
    });

    /* Tutup popover saat klik di luar grid */
    document.addEventListener("click", function (e) {
      if (!popVisible) return;
      if (grid.contains(e.target)) return;
      if (popover && popover.contains(e.target)) return;
      hidePopover();
    });
  }

  /* Delegation: edit / delete buttons in popover */
  if (popover) {
    popover.addEventListener("click", function (e) {
      var editBtn = e.target.closest(".btn-edit-pop");
      if (editBtn) {
        hidePopover();
        openEditModal(
          editBtn.dataset.id,
          editBtn.dataset.name,
          editBtn.dataset.note,
          editBtn.dataset.date,
        );
        return;
      }
      var delBtn = e.target.closest(".btn-del-pop");
      if (delBtn) {
        hidePopover();
        openDeleteModal(
          delBtn.dataset.id,
          delBtn.dataset.name,
          delBtn.dataset.label,
          delBtn.dataset.date,
        );
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: TAMBAH
     ══════════════════════════════════════════════════════════════ */
  var modalTambah = document.getElementById("modalTambah");
  var btnTambah = document.getElementById("btnTambahLibur");
  var btnCloseTambah = document.getElementById("btnCloseTambah");
  var btnCancelTambah = document.getElementById("btnCancelTambah");
  var addNameInput = document.getElementById("addName");
  var addNameErr = document.getElementById("addNameErr");
  var addDateInput = document.getElementById("addDateInput");
  var btnAddDate = document.getElementById("btnAddDate");
  var addDateTags = document.getElementById("addDateTags");
  var addDateErr = document.getElementById("addDateErr");
  var addScopeRadios = document.querySelectorAll('input[name="add_scope"]');
  var addOfficeWrap = document.getElementById("addOfficeWrap");
  var addOffice = document.getElementById("addOffice");
  var addOfficeErr = document.getElementById("addOfficeErr");
  var addNote = document.getElementById("addNote");
  var btnSubmitTambah = document.getElementById("btnSubmitTambah");
  var tambahText = document.getElementById("tambahText");
  var tambahSpinner = document.getElementById("tambahSpinner");
  var selectedDates = [];

  function getAddScope() {
    var ch = document.querySelector('input[name="add_scope"]:checked');
    return ch ? ch.value : "all";
  }
  function getAddType() {
    var ch = document.querySelector('input[name="dayoff_type"]:checked');
    return ch ? ch.value : "perusahaan";
  }

  addScopeRadios.forEach(function (r) {
    r.addEventListener("change", function () {
      if (addOfficeWrap) addOfficeWrap.hidden = this.value !== "office";
      if (addOfficeErr) addOfficeErr.hidden = true;
    });
  });

  function renderAddTags() {
    if (!addDateTags) return;
    addDateTags.innerHTML = "";
    selectedDates.forEach(function (ds) {
      var tag = document.createElement("span");
      tag.className = "dayoff-tag";
      var p = ds.split("-");
      tag.textContent =
        parseInt(p[2], 10) + "/" + parseInt(p[1], 10) + "/" + p[0];
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "dayoff-tag-remove";
      rm.setAttribute("aria-label", "Hapus " + ds);
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        selectedDates = selectedDates.filter(function (d) {
          return d !== ds;
        });
        renderAddTags();
      });
      tag.appendChild(rm);
      addDateTags.appendChild(tag);
    });
  }

  if (btnAddDate) {
    btnAddDate.addEventListener("click", function () {
      var v = addDateInput ? addDateInput.value : "";
      if (!v) return;
      if (selectedDates.indexOf(v) !== -1) {
        showToast(I18N.toastDateDup || "Tanggal sudah ditambahkan.", "warning");
        return;
      }
      selectedDates.push(v);
      selectedDates.sort();
      if (addDateErr) addDateErr.hidden = true;
      renderAddTags();
      if (addDateInput) addDateInput.value = "";
    });
  }
  if (addDateInput) {
    addDateInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (btnAddDate) btnAddDate.click();
      }
    });
  }

  function resetTambah() {
    selectedDates = [];
    renderAddTags();
    if (addNameInput) addNameInput.value = "";
    if (addNote) addNote.value = "";
    if (addDateInput) addDateInput.value = "";
    if (addOffice) addOffice.value = "";
    if (addOfficeWrap) addOfficeWrap.hidden = true;
    // Reset radios
    document.querySelectorAll('input[name="add_scope"]').forEach(function (r) {
      r.checked = r.value === "all";
    });
    document
      .querySelectorAll('input[name="dayoff_type"]')
      .forEach(function (r) {
        r.checked = r.value === "perusahaan";
      });
    [addNameErr, addDateErr, addOfficeErr].forEach(function (el) {
      if (el) el.hidden = true;
    });
    setTambahLoading(false);
  }

  function setTambahLoading(on) {
    if (!btnSubmitTambah) return;
    btnSubmitTambah.disabled = on;
    if (tambahText) tambahText.hidden = on;
    if (tambahSpinner) tambahSpinner.hidden = !on;
  }

  function validateTambah() {
    var ok = true;
    if (!addNameInput || !addNameInput.value.trim()) {
      if (addNameErr) addNameErr.hidden = false;
      ok = false;
    } else {
      if (addNameErr) addNameErr.hidden = true;
    }
    if (!selectedDates.length) {
      if (addDateErr) addDateErr.hidden = false;
      ok = false;
    } else {
      if (addDateErr) addDateErr.hidden = true;
    }
    if (getAddScope() === "office" && addOffice && !addOffice.value) {
      if (addOfficeErr) addOfficeErr.hidden = false;
      ok = false;
    } else {
      if (addOfficeErr) addOfficeErr.hidden = true;
    }
    return ok;
  }

  function openTambahModal(prefillDate) {
    resetTambah();
    if (prefillDate && addDateInput) {
      addDateInput.value = prefillDate;
    }
    openModal(modalTambah, addNameInput);
  }

  if (btnTambah) {
    btnTambah.addEventListener("click", function () {
      openTambahModal();
    });
  }
  if (btnCloseTambah)
    btnCloseTambah.addEventListener("click", function () {
      closeModal(modalTambah);
    });
  if (btnCancelTambah)
    btnCancelTambah.addEventListener("click", function () {
      closeModal(modalTambah);
    });
  if (modalTambah) {
    modalTambah.addEventListener("click", function (e) {
      if (e.target === modalTambah) closeModal(modalTambah);
    });
  }

  if (btnSubmitTambah) {
    btnSubmitTambah.addEventListener("click", function () {
      if (!validateTambah()) return;
      setTambahLoading(true);
      fetchJSON("/manager/company-dayoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        body: JSON.stringify({
          name: addNameInput ? addNameInput.value.trim() : "",
          dates: selectedDates,
          applies_to: getAddScope(),
          office_id:
            getAddScope() === "office" && addOffice ? addOffice.value : null,
          note: addNote ? addNote.value.trim() : "",
          dayoff_type: getAddType(),
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            closeModal(modalTambah);
            showToast(
              r.d.message || I18N.toastAdded || "Libur ditambahkan.",
              "success",
            );
            // Merge new dayoffs into local state
            if (r.d.dayoffs) {
              r.d.dayoffs.forEach(function (nd) {
                DAYOFFS.push(nd);
              });
            }
            renderCalendar();
          } else {
            showToast(
              r.d.message || I18N.toastError || "Terjadi kesalahan.",
              "danger",
            );
            setTambahLoading(false);
          }
        })
        .catch(function () {
          showToast(I18N.toastConnFail || "Gagal terhubung.", "danger");
          setTambahLoading(false);
        });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: EDIT
     ══════════════════════════════════════════════════════════════ */
  var modalEdit = document.getElementById("modalEdit");
  var btnCloseEdit = document.getElementById("btnCloseEdit");
  var btnCancelEdit = document.getElementById("btnCancelEdit");
  var editNameInput = document.getElementById("editName");
  var editNameErr = document.getElementById("editNameErr");
  var editNoteArea = document.getElementById("editNote");
  var btnSubmitEdit = document.getElementById("btnSubmitEdit");
  var editText = document.getElementById("editText");
  var editSpinner = document.getElementById("editSpinner");
  var editTargetId = null;

  function setEditLoading(on) {
    if (!btnSubmitEdit) return;
    btnSubmitEdit.disabled = on;
    if (editText) editText.hidden = on;
    if (editSpinner) editSpinner.hidden = !on;
  }

  function openEditModal(id, name, note, isoDate) {
    // Guard: sudah lewat deadline
    if (isPastDeadline(isoDate)) {
      showToast(
        I18N.expiredMsg || "Tidak dapat diedit — tanggal sudah lewat.",
        "warning",
      );
      return;
    }
    editTargetId = id;
    if (editNameInput) editNameInput.value = name || "";
    if (editNoteArea) editNoteArea.value = note || "";
    if (editNameErr) editNameErr.hidden = true;
    setEditLoading(false);
    openModal(modalEdit, editNameInput);
  }

  function closeEditModal() {
    editTargetId = null;
    setEditLoading(false);
    closeModal(modalEdit);
  }

  if (btnCloseEdit) btnCloseEdit.addEventListener("click", closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener("click", closeEditModal);
  if (modalEdit) {
    modalEdit.addEventListener("click", function (e) {
      if (e.target === modalEdit) closeEditModal();
    });
  }

  if (btnSubmitEdit) {
    btnSubmitEdit.addEventListener("click", function () {
      if (!editTargetId) return;
      var name = editNameInput ? editNameInput.value.trim() : "";
      if (!name) {
        if (editNameErr) editNameErr.hidden = false;
        return;
      }
      if (editNameErr) editNameErr.hidden = true;
      setEditLoading(true);
      fetchJSON("/manager/company-dayoffs/" + editTargetId, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        body: JSON.stringify({
          name: name,
          note: editNoteArea ? editNoteArea.value.trim() : "",
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            // Update local state
            var upd = r.d.dayoff;
            if (upd) {
              DAYOFFS = DAYOFFS.map(function (d) {
                return d.id === upd.id ? Object.assign({}, d, upd) : d;
              });
            }
            closeEditModal();
            showToast(
              r.d.message || I18N.toastUpdated || "Libur diperbarui.",
              "success",
            );
            renderCalendar();
          } else {
            showToast(
              r.d.message || I18N.toastUpdateFail || "Gagal memperbarui.",
              "danger",
            );
            setEditLoading(false);
          }
        })
        .catch(function () {
          showToast(I18N.toastConnFail || "Gagal terhubung.", "danger");
          setEditLoading(false);
        });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: HAPUS
     ══════════════════════════════════════════════════════════════ */
  var modalHapus = document.getElementById("modalHapus");
  var btnCloseHapus = document.getElementById("btnCloseHapus");
  var btnCancelHapus = document.getElementById("btnCancelHapus");
  var btnSubmitHapus = document.getElementById("btnSubmitHapus");
  var hapusName = document.getElementById("hapusName");
  var hapusDate = document.getElementById("hapusDate");
  var hapusText = document.getElementById("hapusText");
  var hapusSpinner = document.getElementById("hapusSpinner");
  var deleteTargetId = null;

  function setHapusLoading(on) {
    if (!btnSubmitHapus) return;
    btnSubmitHapus.disabled = on;
    if (hapusText) hapusText.hidden = on;
    if (hapusSpinner) hapusSpinner.hidden = !on;
  }

  function openDeleteModal(id, name, dateLabel, isoDate) {
    if (isPastDeadline(isoDate)) {
      showToast(
        I18N.expiredMsg || "Tidak dapat dihapus — tanggal sudah lewat.",
        "warning",
      );
      return;
    }
    deleteTargetId = id;
    if (hapusName) hapusName.textContent = name || "";
    if (hapusDate) hapusDate.textContent = dateLabel || "";
    setHapusLoading(false);
    openModal(modalHapus, btnSubmitHapus);
  }

  function closeHapusModal() {
    deleteTargetId = null;
    setHapusLoading(false);
    closeModal(modalHapus);
  }

  if (btnCloseHapus) btnCloseHapus.addEventListener("click", closeHapusModal);
  if (btnCancelHapus) btnCancelHapus.addEventListener("click", closeHapusModal);
  if (modalHapus) {
    modalHapus.addEventListener("click", function (e) {
      if (e.target === modalHapus) closeHapusModal();
    });
  }

  if (btnSubmitHapus) {
    btnSubmitHapus.addEventListener("click", function () {
      if (!deleteTargetId) return;
      setHapusLoading(true);
      fetchJSON("/manager/company-dayoffs/" + deleteTargetId, {
        method: "DELETE",
        headers: { "X-CSRFToken": csrf() },
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            var delId = deleteTargetId;
            DAYOFFS = DAYOFFS.filter(function (d) {
              return d.id !== delId;
            });
            closeHapusModal();
            showToast(
              r.d.message || I18N.toastDeleted || "Libur dihapus.",
              "success",
            );
            renderCalendar();
          } else {
            showToast(
              r.d.message || I18N.toastDeleteFail || "Gagal menghapus.",
              "danger",
            );
            setHapusLoading(false);
          }
        })
        .catch(function () {
          showToast(I18N.toastConnFail || "Gagal terhubung.", "danger");
          setHapusLoading(false);
        });
    });
  }

  /* ── Escape key ──────────────────────────────────────────────── */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (modalHapus && modalHapus.classList.contains("is-open"))
      closeHapusModal();
    else if (modalEdit && modalEdit.classList.contains("is-open"))
      closeEditModal();
    else if (modalTambah && modalTambah.classList.contains("is-open"))
      closeModal(modalTambah);
    else hidePopover();
  });

  /* ── Init ────────────────────────────────────────────────────── */
  renderCalendar();
})();
