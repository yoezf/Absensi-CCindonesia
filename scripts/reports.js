/**
 * reports.js — Laporan Kehadiran
 *
 * I18N keys yang dibutuhkan (definisikan di template sebelum script ini):
 *   rptDays          : array 7 elemen ["Senin","Selasa",…,"Minggu"]
 *   rptStatusPresent, rptStatusLate, rptStatusAbsent, rptStatusDayOff,
 *   rptStatusExtraOff, rptStatusSick, rptStatusRemote
 *   rptSrcGps, rptSrcCorrection, rptSrcManual
 *   rptColDate, rptColDay, rptColCheckIn, rptColStatus, rptColCheckOut,
 *   rptColDuration, rptColSource
 *   rptNoLog, rptNoData, rptNoMatch
 *   rptCount         (template: "{emp} karyawan · {total} log")
 *   rptPagination    (template: "{start}–{end} dari {total} karyawan")
 *   rptLogSubtitle, rptDailySubtitle
 *   rptCsvHeaderNames  (array CSV header untuk format Log, 11 kolom)
 *   rptCsvSummaryLabel ("RINGKASAN")
 *   rptCsvFileLog, rptCsvFileDaily  (prefix nama file, tanpa tanggal/.csv)
 */

(function () {
  "use strict";

  const I18N = window.I18N || {};

  // ─── Konstanta ──────────────────────────────────────────────────────────────
  var PAGE_SIZE = 10;
  var DAY_FULL = I18N.rptDays || [
    "Senin",
    "Selasa",
    "Rabu",
    "Kamis",
    "Jumat",
    "Sabtu",
    "Minggu",
  ];

  var STATUS_LABEL = {
    present: I18N.rptStatusPresent || "Hadir",
    late: I18N.rptStatusLate || "Terlambat",
    absent: I18N.rptStatusAbsent || "Tidak Hadir",
    day_off: I18N.rptStatusDayOff || "Libur",
    extra_off: I18N.rptStatusExtraOff || "Izin",
    sick: I18N.rptStatusSick || "Sakit",
    remote: I18N.rptStatusRemote || "Remote",
  };
  var STATUS_CLS = {
    present: "s-present",
    late: "s-late",
    absent: "s-absent",
    day_off: "s-dayoff",
    extra_off: "s-extoff",
    sick: "s-sick",
    remote: "s-remote",
  };
  var SOURCE_LABEL = {
    gps: I18N.rptSrcGps || "GPS",
    correction: I18N.rptSrcCorrection || "Koreksi",
    manual: I18N.rptSrcManual || "Manual",
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  var allData = [],
    filtered = [],
    currentPage = 0,
    openCards = {};
  var searchQ = "",
    filterSt = "",
    filterShift = "",
    viewMode = "log";

  // ─── DOM refs ───────────────────────────────────────────────────────────────
  var elRoot = document.getElementById("log-list-root");
  var elLoading = document.getElementById("log-loading");
  var elCount = document.getElementById("log-count");
  var elPagination = document.getElementById("log-pagination");
  var elPageInfo = document.getElementById("log-page-info");
  var elPrev = document.getElementById("log-prev");
  var elNext = document.getElementById("log-next");
  var elSearch = document.getElementById("log-search");
  var elFilterSt = document.getElementById("log-filter-status");
  var elFilterShift = document.getElementById("log-filter-shift");
  var elSubtitle = document.getElementById("section-log-subtitle");
  var dateFrom = document.getElementById("dateFrom");
  var dateTo = document.getElementById("dateTo");
  var btnViewLog = document.getElementById("btn-view-log");
  var btnViewDaily = document.getElementById("btn-view-daily");
  var btnExportTrigger = document.getElementById("btn-export-trigger");
  var elExportMenu = document.getElementById("export-menu");
  var btnExportLog = document.getElementById("btn-export-log");
  var btnExportDaily = document.getElementById("btn-export-daily");

  // ─── Load data ──────────────────────────────────────────────────────────────
  function loadData() {
    var tag = document.getElementById("rpt-log-data");
    if (!tag) {
      hideLoading();
      return;
    }
    try {
      allData = JSON.parse(tag.textContent);
    } catch (e) {
      allData = [];
      console.error("reports.js: gagal parse data log", e);
    }
    hideLoading();
    applyFilters();
  }
  function hideLoading() {
    if (elLoading) elLoading.hidden = true;
  }

  // ─── Filter & search ────────────────────────────────────────────────────────
  function applyFilters() {
    var q = searchQ.toLowerCase().trim();
    filtered = allData.filter(function (emp) {
      if (
        q &&
        !emp.name.toLowerCase().includes(q) &&
        !emp.dept.toLowerCase().includes(q)
      )
        return false;
      if (filterSt) {
        var hasStatus = emp.logs.some(function (lg) {
          return lg.status === filterSt;
        });
        if (!hasStatus) return false;
      }
      if (filterShift) {
        // Tampilkan karyawan yang memiliki setidaknya satu log dengan shift ini
        var hasShift = emp.logs.some(function (lg) {
          return lg.shift_type === filterShift;
        });
        if (!hasShift) return false;
      }
      return true;
    });
    currentPage = 0;
    renderPage();
    updateCount();
  }

  function updateCount() {
    if (!elCount) return;
    var total = filtered.reduce(function (acc, emp) {
      var logs = emp.logs;
      if (filterSt)
        logs = logs.filter(function (lg) {
          return lg.status === filterSt;
        });
      if (filterShift)
        logs = logs.filter(function (lg) {
          return lg.shift_type === filterShift;
        });
      return acc + logs.length;
    }, 0);
    elCount.textContent = (I18N.rptCount || "{emp} karyawan · {total} log")
      .replace("{emp}", filtered.length)
      .replace("{total}", total);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  function renderPage() {
    if (!elRoot) return;
    var oldCards = elRoot.querySelectorAll(".log-emp-card, .daily-view-wrap");
    oldCards.forEach(function (c) {
      c.parentNode.removeChild(c);
    });
    if (viewMode === "daily") renderDailyView();
    else renderLogView();
  }

  // ─── VIEW: Log ──────────────────────────────────────────────────────────────
  function renderLogView() {
    var start = currentPage * PAGE_SIZE;
    var slice = filtered.slice(start, start + PAGE_SIZE);
    if (filtered.length === 0) {
      showEmpty(true);
      updatePagination();
      return;
    }
    showEmpty(false);
    var frag = document.createDocumentFragment();
    slice.forEach(function (emp) {
      frag.appendChild(buildCard(emp));
    });
    elRoot.appendChild(frag);
    updatePagination();
  }

  function buildCard(emp) {
    var isOpen = !!openCards[emp.id];
    var card = el("div", {
      className: "log-emp-card" + (isOpen ? " is-open" : ""),
    });
    var header = el("button", {
      type: "button",
      className: "log-emp-header",
      "aria-expanded": isOpen ? "true" : "false",
    });
    var avatar = el("div", { className: "log-avatar" });
    avatar.textContent = emp.initials;
    var info = el("div", { className: "log-emp-info" });
    var name = el("div", { className: "log-emp-name" });
    name.textContent = emp.name;
    var dept = el("div", { className: "log-emp-dept" });
    dept.textContent = emp.dept;
    info.appendChild(name);
    info.appendChild(dept);

    var badges = el("div", { className: "log-stat-badges" });
    [
      { key: "present", label: "H", cls: "sb-present" },
      { key: "late", label: "TL", cls: "sb-late" },
      { key: "absent", label: "AB", cls: "sb-absent" },
      { key: "sick", label: "SK", cls: "sb-sick" },
      { key: "day_off", label: "LB", cls: "sb-dayoff" },
      { key: "extra_off", label: "IZ", cls: "sb-extoff" },
      { key: "remote", label: "RM", cls: "sb-remote" },
    ].forEach(function (def) {
      var v = emp.stats[def.key] || 0;
      if (!v) return;
      var b = el("span", { className: "log-stat-badge " + def.cls });
      b.textContent = def.label + " " + v;
      badges.appendChild(b);
    });

    var logLen = filterSt
      ? emp.logs.filter(function (l) {
          return l.status === filterSt;
        }).length
      : emp.logs.length;
    var logCount = el("span", { className: "log-entry-count" });
    logCount.textContent = logLen + " log";
    var chevron = el("span", {
      className: "log-chevron",
      "aria-hidden": "true",
    });
    chevron.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>';

    header.appendChild(avatar);
    header.appendChild(info);
    header.appendChild(badges);
    header.appendChild(logCount);
    header.appendChild(chevron);

    var body = el("div", { className: "log-emp-body" });
    body.hidden = !isOpen;
    body.appendChild(buildLogTable(emp));

    header.addEventListener("click", function () {
      var nowOpen = !openCards[emp.id];
      openCards[emp.id] = nowOpen;
      card.classList.toggle("is-open", nowOpen);
      body.hidden = !nowOpen;
      header.setAttribute("aria-expanded", nowOpen ? "true" : "false");
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  function buildLogTable(emp) {
    var logs = filterSt
      ? emp.logs.filter(function (l) {
          return l.status === filterSt;
        })
      : emp.logs;
    var wrap = el("div", { className: "log-table-wrap" });
    var table = el("table", { className: "log-table" });
    var thead = el("thead");
    var htr = el("tr");
    [
      I18N.rptColDate || "Tanggal",
      I18N.rptColDay || "Hari",
      I18N.rptColCheckIn || "Jam Masuk",
      I18N.rptColStatus || "Status",
      I18N.rptColCheckOut || "Jam Keluar",
      I18N.rptColDuration || "Durasi",
      I18N.rptColSource || "Sumber",
    ].forEach(function (h) {
      var th = el("th", { scope: "col" });
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el("tbody");
    if (!logs.length) {
      var noRow = el("tr");
      var noTd = el("td", { colSpan: "7", className: "log-table-empty" });
      noTd.textContent = I18N.rptNoLog || "Tidak ada log pada periode ini.";
      noRow.appendChild(noTd);
      tbody.appendChild(noRow);
    } else {
      logs.forEach(function (lg) {
        var tr = el("tr");
        var d = new Date(lg.date + "T00:00:00");
        var dd = td(
          zeroPad(d.getDate()) +
            "/" +
            zeroPad(d.getMonth() + 1) +
            "/" +
            d.getFullYear(),
          "log-td-date",
        );
        var dayTd = td(DAY_FULL[lg.dow] || "", "log-td-day");

        var ciTd = el("td", { className: "log-td-mono" });
        if (lg.check_in) {
          ciTd.textContent = lg.check_in;
          // badge +Xm menit terlambat tidak ditampilkan
        } else {
          ciTd.textContent = "—";
          ciTd.className += " log-td-dash";
        }

        var stTd = el("td");
        var badge = el("span", {
          className: "log-status-badge " + (STATUS_CLS[lg.status] || ""),
        });
        badge.textContent = STATUS_LABEL[lg.status] || lg.status;
        stTd.appendChild(badge);

        var coTd = el("td", {
          className: lg.check_out ? "log-td-mono" : "log-td-dash",
        });
        coTd.textContent = lg.check_out || "—";

        var durTd = el("td", { className: "log-td-mono" });
        if (lg.duration > 0) {
          var h = Math.floor(lg.duration / 60),
            m = lg.duration % 60;
          durTd.textContent = h + "j " + zeroPad(m) + "m";
        } else {
          durTd.textContent = "—";
          durTd.className += " log-td-dash";
        }

        var srcTd = el("td", { className: "log-td-source" });
        if (lg.corrector) {
          var srcWrap = el("span", { className: "log-src-correction" });
          srcWrap.textContent = SOURCE_LABEL.correction;
          var srcBy = el("span", { className: "log-src-by" });
          srcBy.textContent = lg.corrector;
          srcTd.appendChild(srcWrap);
          srcTd.appendChild(srcBy);
        } else {
          var srcSpan = el("span", {
            className: "log-src-" + (lg.source || "gps"),
          });
          srcSpan.textContent =
            SOURCE_LABEL[lg.source] || lg.source || SOURCE_LABEL.gps;
          srcTd.appendChild(srcSpan);
        }

        tr.appendChild(dd);
        tr.appendChild(dayTd);
        tr.appendChild(ciTd);
        tr.appendChild(stTd);
        tr.appendChild(coTd);
        tr.appendChild(durTd);
        tr.appendChild(srcTd);
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // ─── VIEW: Harian (pivot: baris=nama, kolom=tanggal) ───────────────────────
  function renderDailyView() {
    if (filtered.length === 0) {
      showEmpty(true);
      updatePagination();
      return;
    }
    showEmpty(false);

    // Kumpulkan SEMUA tanggal dalam range (dari dateFrom..dateTo), termasuk weekend
    var dateFrom_val = dateFrom ? dateFrom.value : "";
    var dateTo_val = dateTo ? dateTo.value : "";
    var allDates = [];

    if (dateFrom_val && dateTo_val) {
      // Generate semua tanggal dalam range
      var cur = new Date(dateFrom_val + "T00:00:00");
      var end = new Date(dateTo_val + "T00:00:00");
      while (cur <= end) {
        allDates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      // Fallback: ambil dari data log
      var dateSet = {};
      filtered.forEach(function (emp) {
        emp.logs.forEach(function (lg) {
          dateSet[lg.date] = lg.dow;
        });
      });
      allDates = Object.keys(dateSet).sort();
    }

    // Index log per (emp_id, date)
    var logIndex = {};
    filtered.forEach(function (emp) {
      emp.logs.forEach(function (lg) {
        logIndex[emp.id + "|" + lg.date] = lg;
      });
    });

    var showTime = true;

    var wrap = el("div", { className: "daily-view-wrap" });

    // Toggle jam masuk vs status
    var dHeader = el("div", { className: "daily-view-header" });
    var toggleWrap = el("div", { className: "daily-mode-toggle" });
    var btnTime = el("button", {
      type: "button",
      className: "dmt-btn dmt-active",
      "aria-pressed": "true",
    });
    btnTime.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ' +
      (I18N.rptColCheckIn || "Jam Masuk");
    var btnStatus = el("button", {
      type: "button",
      className: "dmt-btn",
      "aria-pressed": "false",
    });
    btnStatus.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ' +
      (I18N.rptColStatus || "Status");
    toggleWrap.appendChild(btnTime);
    toggleWrap.appendChild(btnStatus);
    dHeader.appendChild(toggleWrap);
    wrap.appendChild(dHeader);

    var tableWrap = el("div", { className: "daily-table-wrap" });
    var table = el("table", {
      className: "daily-table daily-table-transposed",
    });

    // Header row: kolom pertama = "Nama", lalu setiap tanggal
    var thead = el("thead");
    var htr = el("tr");
    var thName = el("th", { className: "dt-th-fixed", scope: "col" });
    thName.textContent = I18N.rptColDate ? "Nama" : "Nama";
    htr.appendChild(thName);

    allDates.forEach(function (dateStr) {
      var d = new Date(dateStr + "T00:00:00");
      var dow = (d.getDay() + 6) % 7; // Senin=0..Minggu=6
      var isWkend = dow >= 5;
      var th = el("th", {
        className: "dt-th-emp" + (isWkend ? " dt-th-weekend" : ""),
        scope: "col",
      });
      var dateNum = el("div", { className: "dt-date-num" });
      dateNum.textContent =
        zeroPad(d.getDate()) + "/" + zeroPad(d.getMonth() + 1);
      var dayName = el("div", {
        className: "dt-date-day" + (isWkend ? " dt-wkend-lbl" : ""),
      });
      dayName.textContent = DAY_FULL[dow] ? DAY_FULL[dow].slice(0, 3) : "";
      th.appendChild(dateNum);
      th.appendChild(dayName);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    // Body: setiap baris = satu karyawan
    var tbody = el("tbody");
    filtered.forEach(function (emp) {
      var tr = el("tr");
      // Kolom nama
      var nameTd = el("td", { className: "dt-td-date" });
      var nameDiv = el("div", { className: "dt-emp-name" });
      nameDiv.textContent = emp.name;
      var deptDiv = el("div", { className: "dt-emp-dept" });
      deptDiv.textContent = emp.dept;
      nameTd.appendChild(nameDiv);
      nameTd.appendChild(deptDiv);
      tr.appendChild(nameTd);

      // Kolom per tanggal
      allDates.forEach(function (dateStr) {
        var d = new Date(dateStr + "T00:00:00");
        var dow = (d.getDay() + 6) % 7;
        var isWkend = dow >= 5;
        var tdCell = el("td", {
          className: "dt-td-emp" + (isWkend ? " dt-td-weekend" : ""),
        });
        var lg = logIndex[emp.id + "|" + dateStr] || null;
        if (lg) {
          if (showTime) renderDailyCellTime(tdCell, lg);
          else renderDailyCellStatus(tdCell, lg);
        } else if (isWkend) {
          var dot = el("span", { className: "dt-cell-wkend" });
          dot.textContent = "·";
          tdCell.appendChild(dot);
        } else {
          var dash = el("span", { className: "dt-cell-none" });
          dash.textContent = "—";
          tdCell.appendChild(dash);
        }
        tr.appendChild(tdCell);
      });
      tbody.appendChild(tr);
    });

    if (!allDates.length) {
      var noRow = el("tr");
      var noTd = el("td", {
        colSpan: String(allDates.length + 1),
        className: "log-table-empty",
      });
      noTd.textContent = I18N.rptNoData || "Tidak ada data pada periode ini.";
      noRow.appendChild(noTd);
      tbody.appendChild(noRow);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
    elRoot.appendChild(wrap);
    if (elPagination) elPagination.hidden = true;

    function switchMode(toTime) {
      showTime = toTime;
      btnTime.classList.toggle("dmt-active", toTime);
      btnStatus.classList.toggle("dmt-active", !toTime);
      btnTime.setAttribute("aria-pressed", toTime ? "true" : "false");
      btnStatus.setAttribute("aria-pressed", toTime ? "false" : "true");
      var cells = table.querySelectorAll("td.dt-td-emp");
      var empIdx = 0,
        dateIdx = 0;
      cells.forEach(function (tdCell) {
        tdCell.innerHTML = "";
        var emp2 = filtered[empIdx];
        var dateStr2 = allDates[dateIdx];
        var lg2 =
          emp2 && dateStr2 ? logIndex[emp2.id + "|" + dateStr2] || null : null;
        var d2 = dateStr2 ? new Date(dateStr2 + "T00:00:00") : null;
        var dow2 = d2 ? (d2.getDay() + 6) % 7 : 0;
        if (lg2) {
          if (toTime) renderDailyCellTime(tdCell, lg2);
          else renderDailyCellStatus(tdCell, lg2);
        } else if (dow2 >= 5) {
          var dot2 = el("span", { className: "dt-cell-wkend" });
          dot2.textContent = "·";
          tdCell.appendChild(dot2);
        } else {
          var d3 = el("span", { className: "dt-cell-none" });
          d3.textContent = "—";
          tdCell.appendChild(d3);
        }
        dateIdx++;
        if (dateIdx >= allDates.length) {
          dateIdx = 0;
          empIdx++;
        }
      });
    }
    btnTime.addEventListener("click", function () {
      if (!showTime) switchMode(true);
    });
    btnStatus.addEventListener("click", function () {
      if (showTime) switchMode(false);
    });
  }

  function renderDailyCellTime(tdCell, lg) {
    if (lg.check_in) {
      var timeSpan = el("span", { className: "dt-cell-time" });
      timeSpan.textContent = lg.check_in;
      tdCell.appendChild(timeSpan);
      // badge +Xm menit terlambat sengaja tidak ditampilkan di tampilan harian
    } else if (lg.status === "day_off" || lg.status === "extra_off") {
      var badge = el("span", {
        className: "dt-cell-badge " + (STATUS_CLS[lg.status] || ""),
      });
      badge.textContent = lg.status === "day_off" ? "L" : "IZ";
      tdCell.appendChild(badge);
    } else if (lg.status === "sick") {
      var badgeS = el("span", { className: "dt-cell-badge s-sick" });
      badgeS.textContent = "SK";
      tdCell.appendChild(badgeS);
    } else if (lg.status === "absent") {
      var badgeA = el("span", { className: "dt-cell-badge s-absent" });
      badgeA.textContent = "AB";
      tdCell.appendChild(badgeA);
    } else {
      var dash = el("span", { className: "dt-cell-none" });
      dash.textContent = "—";
      tdCell.appendChild(dash);
    }
  }

  function renderDailyCellStatus(tdCell, lg) {
    var badge = el("span", {
      className: "dt-cell-badge " + (STATUS_CLS[lg.status] || ""),
    });
    badge.textContent = STATUS_LABEL[lg.status] || lg.status;
    tdCell.appendChild(badge);
  }

  // ─── Pagination ─────────────────────────────────────────────────────────────
  function updatePagination() {
    if (!elPagination) return;
    var total = filtered.length;
    var pages = Math.ceil(total / PAGE_SIZE);
    elPagination.hidden = pages <= 1;
    if (elPageInfo) {
      var start = currentPage * PAGE_SIZE + 1;
      var end = Math.min(start + PAGE_SIZE - 1, total);
      elPageInfo.textContent = (
        I18N.rptPagination || "{start}–{end} dari {total} karyawan"
      )
        .replace("{start}", start)
        .replace("{end}", end)
        .replace("{total}", total);
    }
    if (elPrev) elPrev.disabled = currentPage === 0;
    if (elNext) elNext.disabled = currentPage >= pages - 1;
  }

  function showEmpty(show) {
    var existing = document.getElementById("log-empty-state");
    if (show) {
      if (!existing) {
        var e = el("p", {
          id: "log-empty-state",
          className: "log-empty-state",
        });
        e.textContent =
          I18N.rptNoMatch || "Tidak ada karyawan yang cocok dengan filter.";
        elRoot.appendChild(e);
      }
    } else {
      if (existing) existing.parentNode.removeChild(existing);
    }
  }

  // ─── Export CSV ─────────────────────────────────────────────────────────────
  function exportCSVLog() {
    var headers = I18N.rptCsvHeadersLog || [
      "Nama",
      "Departemen",
      "Tanggal",
      "Hari",
      "Jam Masuk",
      "Menit Terlambat",
      "Status",
      "Jam Keluar",
      "Durasi (menit)",
      "Sumber",
      "Dikoreksi Oleh",
    ];
    var rows = [headers];
    filtered.forEach(function (emp) {
      var logs = filterSt
        ? emp.logs.filter(function (l) {
            return l.status === filterSt;
          })
        : emp.logs;
      logs.forEach(function (lg) {
        var d = new Date(lg.date + "T00:00:00");
        var date =
          zeroPad(d.getDate()) +
          "/" +
          zeroPad(d.getMonth() + 1) +
          "/" +
          d.getFullYear();
        rows.push([
          emp.name,
          emp.dept,
          date,
          DAY_FULL[lg.dow] || "",
          lg.check_in || "",
          lg.late_min || "",
          STATUS_LABEL[lg.status] || lg.status,
          lg.check_out || "",
          lg.duration || "",
          SOURCE_LABEL[lg.source] || lg.source || SOURCE_LABEL.gps,
          lg.corrector || "",
        ]);
      });
    });
    downloadCSV(
      rows,
      (I18N.rptCsvFileLog || "log_absensi") +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".csv",
    );
  }

  function exportCSVDaily() {
    var dateSet = {};
    filtered.forEach(function (emp) {
      var logs = filterSt
        ? emp.logs.filter(function (l) {
            return l.status === filterSt;
          })
        : emp.logs;
      logs.forEach(function (lg) {
        dateSet[lg.date] = lg.dow;
      });
    });
    var allDates = Object.keys(dateSet).sort();
    var colDate = I18N.rptColDate || "Tanggal";
    var colDay = I18N.rptColDay || "Hari";
    var headers = [colDate, colDay].concat(
      filtered.map(function (e) {
        return e.name;
      }),
    );
    var rows = [headers];

    allDates.forEach(function (dateStr) {
      var d = new Date(dateStr + "T00:00:00");
      var dateLabel =
        zeroPad(d.getDate()) +
        "/" +
        zeroPad(d.getMonth() + 1) +
        "/" +
        d.getFullYear();
      var row = [dateLabel, DAY_FULL[dateSet[dateStr]] || ""];
      filtered.forEach(function (emp) {
        var lg = null;
        for (var i = 0; i < emp.logs.length; i++) {
          if (emp.logs[i].date === dateStr) {
            lg = emp.logs[i];
            break;
          }
        }
        if (lg) {
          var cell = lg.check_in ? lg.check_in : "";
          // menit terlambat tidak disertakan di tampilan harian
          if (!lg.check_in) cell = STATUS_LABEL[lg.status] || lg.status;
          row.push(cell);
        } else {
          row.push("");
        }
      });
      rows.push(row);
    });

    rows.push([]);
    var sumRow = [I18N.rptCsvSummaryLabel || "RINGKASAN", ""];
    filtered.forEach(function (emp) {
      var s = emp.stats;
      sumRow.push(
        "H:" +
          (s.present || 0) +
          " TL:" +
          (s.late || 0) +
          " AB:" +
          (s.absent || 0),
      );
    });
    rows.push(sumRow);
    downloadCSV(
      rows,
      (I18N.rptCsvFileDaily || "absensi_harian") +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".csv",
    );
  }

  // ─── Download CSV helper ─────────────────────────────────────────────────────
  function downloadCSV(rows, filename) {
    var csv = rows
      .map(function (r) {
        return r
          .map(function (v) {
            return '"' + String(v).replace(/"/g, '""') + '"';
          })
          .join(",");
      })
      .join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Quick-range pills ──────────────────────────────────────────────────────
  function toISO(dt) {
    // JANGAN gunakan toISOString() — itu UTC dan bisa mundur 1 hari di WIB (UTC+7)
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var d = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function calcRange(range) {
    // Gunakan tanggal lokal Indonesia (hindari timezone offset)
    var now = new Date();
    var y = now.getFullYear(),
      mo = now.getMonth(),
      d = now.getDate();
    // Hari dalam minggu: Senin=0 ... Minggu=6
    var dow = (now.getDay() + 6) % 7; // JS getDay: 0=Sun → kita jadikan Senin=0

    var from, to;
    switch (range) {
      case "thisweek":
        // Senin minggu ini sampai Minggu minggu ini
        from = new Date(y, mo, d - dow);
        to = new Date(y, mo, d - dow + 6);
        break;
      case "lastweek":
        // Senin minggu lalu sampai Minggu minggu lalu
        from = new Date(y, mo, d - dow - 7);
        to = new Date(y, mo, d - dow - 1);
        break;
      case "thismonth":
        // 1 bulan ini sampai hari terakhir bulan ini
        from = new Date(y, mo, 1);
        to = new Date(y, mo + 1, 0);
        break;
      case "lastmonth":
        // 1 bulan lalu sampai hari terakhir bulan lalu
        from = new Date(y, mo - 1, 1);
        to = new Date(y, mo, 0);
        break;
      default:
        return null;
    }
    return { from: from, to: to };
  }

  // ─── DOM helpers ────────────────────────────────────────────────────────────
  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "colSpan") e.colSpan = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    return e;
  }
  function td(text, cls) {
    var e = document.createElement("td");
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  }
  function zeroPad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // ─── Event listeners ────────────────────────────────────────────────────────
  if (elSearch) {
    var searchTimer;
    elSearch.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var val = elSearch.value;
      searchTimer = setTimeout(function () {
        searchQ = val;
        applyFilters();
      }, 200);
    });
  }
  if (elFilterSt) {
    elFilterSt.addEventListener("change", function () {
      filterSt = elFilterSt.value;
      applyFilters();
    });
  }
  if (elFilterShift) {
    elFilterShift.addEventListener("change", function () {
      filterShift = elFilterShift.value;
      applyFilters();
    });
  }
  if (elPrev) {
    elPrev.addEventListener("click", function () {
      if (currentPage > 0) {
        currentPage--;
        renderPage();
        scrollToLog();
      }
    });
  }
  if (elNext) {
    elNext.addEventListener("click", function () {
      var pages = Math.ceil(filtered.length / PAGE_SIZE);
      if (currentPage < pages - 1) {
        currentPage++;
        renderPage();
        scrollToLog();
      }
    });
  }

  if (btnViewLog) {
    btnViewLog.addEventListener("click", function () {
      if (viewMode === "log") return;
      viewMode = "log";
      btnViewLog.classList.add("vt-active");
      btnViewDaily.classList.remove("vt-active");
      btnViewLog.setAttribute("aria-pressed", "true");
      btnViewDaily.setAttribute("aria-pressed", "false");
      if (elSubtitle)
        elSubtitle.textContent =
          I18N.rptLogSubtitle ||
          "Rincian harian: jam masuk, keluar, durasi, sumber data";
      currentPage = 0;
      renderPage();
      updateCount();
    });
  }
  if (btnViewDaily) {
    btnViewDaily.addEventListener("click", function () {
      if (viewMode === "daily") return;
      viewMode = "daily";
      btnViewDaily.classList.add("vt-active");
      btnViewLog.classList.remove("vt-active");
      btnViewDaily.setAttribute("aria-pressed", "true");
      btnViewLog.setAttribute("aria-pressed", "false");
      if (elSubtitle)
        elSubtitle.textContent =
          I18N.rptDailySubtitle ||
          "Tampilan pivot: setiap kolom satu karyawan, setiap baris satu hari";
      currentPage = 0;
      renderPage();
      updateCount();
    });
  }

  if (btnExportTrigger) {
    btnExportTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = !elExportMenu.hidden;
      elExportMenu.hidden = isOpen;
      btnExportTrigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });
  }
  document.addEventListener("click", function () {
    if (elExportMenu && !elExportMenu.hidden) {
      elExportMenu.hidden = true;
      if (btnExportTrigger)
        btnExportTrigger.setAttribute("aria-expanded", "false");
    }
  });
  if (btnExportLog) {
    btnExportLog.addEventListener("click", function () {
      elExportMenu.hidden = true;
      exportCSVLog();
    });
  }
  if (btnExportDaily) {
    btnExportDaily.addEventListener("click", function () {
      elExportMenu.hidden = true;
      exportCSVDaily();
    });
  }

  function scrollToLog() {
    var sec = document.getElementById("section-log");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelectorAll(".qr-pill").forEach(function (pill) {
    pill.addEventListener("click", function () {
      var r = calcRange(this.dataset.range);
      if (!r || !dateFrom || !dateTo) return;
      document.querySelectorAll(".qr-pill").forEach(function (p) {
        p.classList.remove("active");
      });
      this.classList.add("active");
      dateFrom.value = toISO(r.from);
      dateTo.value = toISO(r.to);
      dateTo.min = dateFrom.value;
      // Update hidden month input agar konsisten dengan range yang dipilih
      var monthInput = document.querySelector('input[name="month"]');
      if (monthInput) {
        var y = r.from.getFullYear();
        var m = String(r.from.getMonth() + 1).padStart(2, "0");
        monthInput.value = y + "-" + m;
      }
      // Auto-submit form agar halaman reload dengan range baru
      var form = dateFrom.closest("form");
      if (form) form.submit();
    });
  });
  if (dateFrom) {
    dateFrom.addEventListener("change", function () {
      if (dateTo && dateTo.value && dateTo.value < dateFrom.value)
        dateTo.value = dateFrom.value;
      if (dateTo) dateTo.min = dateFrom.value;
    });
  }

  if (window.requestIdleCallback) requestIdleCallback(loadData);
  else setTimeout(loadData, 0);

  // ─── Rekap Kehadiran: search + CSV export ───────────────────────────────────
  (function initRekap() {
    var elRekapSearch = document.getElementById("rekap-search");
    var elRekapExport = document.getElementById("btn-rekap-export-csv");
    var rekapRows = document.querySelectorAll(".rekap-tr[data-rekap-name]");

    function filterRekap() {
      var q = elRekapSearch ? elRekapSearch.value.toLowerCase().trim() : "";
      rekapRows.forEach(function (tr) {
        var name = (tr.dataset.rekapName || "").toLowerCase();
        var dept = (tr.dataset.rekapDept || "").toLowerCase();
        var match = !q || name.includes(q) || dept.includes(q);
        tr.style.display = match ? "" : "none";
      });
      var tfoot = document.querySelector(".rekap-table tfoot");
      if (tfoot) tfoot.style.display = q ? "none" : "";
    }

    if (elRekapSearch) {
      elRekapSearch.addEventListener("input", filterRekap);
    }

    if (elRekapExport) {
      elRekapExport.addEventListener("click", function () {
        var headers = [
          "Nama",
          "Departemen",
          "Hadir",
          "Terlambat",
          "Sakit",
          "Izin",
          "Alpha",
          "%",
        ];
        var csvRows = [headers];
        rekapRows.forEach(function (tr) {
          if (tr.style.display === "none") return;
          var cells = tr.querySelectorAll("td");
          if (cells.length < 7) return;
          var name = tr.dataset.rekapName || "";
          var dept = tr.dataset.rekapDept || "";
          var hadir = cells[1] ? cells[1].textContent.trim() : "";
          var terlambat = cells[2] ? cells[2].textContent.trim() : "";
          var sakit = cells[3] ? cells[3].textContent.trim() : "";
          var izin = cells[4] ? cells[4].textContent.trim() : "";
          var alpha = cells[5] ? cells[5].textContent.trim() : "";
          var pctEl = cells[6]
            ? cells[6].querySelector(".rekap-pct-val")
            : null;
          var pct = pctEl ? pctEl.textContent.trim() : "";
          csvRows.push([name, dept, hadir, terlambat, sakit, izin, alpha, pct]);
        });
        downloadCSV(
          csvRows,
          "rekap_kehadiran_" + new Date().toISOString().slice(0, 10) + ".csv",
        );
      });
    }
  })();
})();
