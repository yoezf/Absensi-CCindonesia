/**
 * equipment.js — Halaman Inventaris Perlengkapan
 *
 * Fitur:
 *   1. Tab switching (Pico / Peralatan Lain)
 *   2. Search + filter real-time
 *   3. Modal detail + ubah status (GET /manager/pico/<id> | /manager/equipment/<id>)
 *   4. Modal Tambah Headset Pico  (POST /manager/pico/add)
 *   5. Modal Tambah Peralatan     (POST /manager/equipment/add)
 *   6. Modal Hubungkan Pemegang   (PATCH /manager/pico/<id>/assign | /manager/equipment/<id>/assign)
 */

(function () {
  "use strict";

  /* ── Elemen utama ─────────────────────────────────────────── */
  const tabs = document.querySelectorAll(".eq-tab");
  const panels = document.querySelectorAll(".eq-tab-panel");
  const searchInput = document.getElementById("eq-search");
  const filterStatus = document.getElementById("eq-filter-status");
  const filterCat = document.getElementById("eq-filter-category");

  /* ── Tab switching ─────────────────────────────────────────── */
  let activeTab = "pico";

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      activeTab = target;
      tabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === target);
        t.setAttribute("aria-selected", t.dataset.tab === target);
      });
      panels.forEach((p) =>
        p.classList.toggle("active", p.id === `tab-${target}`),
      );
      filterCat.classList.toggle("hidden", target === "pico");
      filterStatus.value = "";
      filterCat.value = "";
      searchInput.value = "";
      applyFilters();
    });
  });

  /* ── Filter + Search ───────────────────────────────────────── */
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const status = filterStatus.value;
    const cat = filterCat.value;
    const tableId = activeTab === "pico" ? "pico-table" : "equipment-table";
    const countId = activeTab === "pico" ? "pico-count" : "equipment-count";
    const rows = document.querySelectorAll(`#${tableId} tbody .eq-row`);
    const suffix = activeTab === "pico" ? "headset" : "item";

    let visible = 0;
    rows.forEach((row) => {
      const matchSearch = !query || (row.dataset.search || "").includes(query);
      const matchStatus = !status || (row.dataset.status || "") === status;
      const matchCat = !cat || (row.dataset.category || "") === cat;
      const show = matchSearch && matchStatus && matchCat;
      row.classList.toggle("eq-row--hidden", !show);
      if (show) visible++;
    });

    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = `${visible} ${suffix}`;
  }

  searchInput.addEventListener("input", applyFilters);
  filterStatus.addEventListener("change", applyFilters);
  filterCat.addEventListener("change", applyFilters);
  filterCat.classList.add("hidden"); // tab pico aktif by default

  /* ═══════════════════════════════════════════════════
     MODAL DETAIL
     ═══════════════════════════════════════════════════ */
  const modalOverlay = document.getElementById("modal-overlay");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const modalFooter = document.getElementById("modal-footer");
  const btnClose = document.getElementById("btn-modal-close");

  function openDetailModal(type, id) {
    modalTitle.textContent =
      type === "pico" ? "Detail Headset Pico" : "Detail Peralatan";
    modalBody.innerHTML = `
      <div class="eq-modal-loading">
        <div class="eq-spinner"></div><span>Memuat data…</span>
      </div>`;
    modalFooter.innerHTML = "";
    openOverlay(modalOverlay);

    const url =
      type === "pico" ? `/manager/pico/${id}` : `/manager/equipment/${id}`;
    fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (type === "pico") renderPicoDetail(data);
        else renderEquipmentDetail(data);
      })
      .catch((err) => {
        modalBody.innerHTML = `
          <div class="eq-empty" style="padding:2rem 0;">
            Gagal memuat data. Coba lagi.<br>
            <small style="color:var(--text-faint);">${esc(err.message)}</small>
          </div>`;
      });
  }

  function closeDetailModal() {
    closeOverlay(modalOverlay);
  }

  btnClose.addEventListener("click", closeDetailModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeDetailModal();
  });

  /* ── Render Pico detail ──────────────────────────────────── */
  function renderPicoDetail(d) {
    const iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>`;

    modalBody.innerHTML = `
      <div class="eq-detail-hero">
        <div class="eq-device-icon eq-device-icon--pico eq-detail-hero-icon">${iconHtml}</div>
        <div>
          <div class="eq-detail-hero-name">${esc(d.pico_number || "—")}</div>
          <div class="eq-detail-hero-sub">${esc(d.pico_username)}${d.call_name ? " · " + esc(d.call_name) : ""}</div>
        </div>
        <span class="badge badge-eq badge-eq--${esc(d.status)}" style="margin-left:auto;">${esc(d.status_label)}</span>
      </div>

      <div class="eq-detail-grid">
        <div class="eq-detail-item">
          <div class="eq-detail-label">Username Platform</div>
          <div class="eq-detail-value">${esc(d.pico_username)}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Nama Panggilan</div>
          <div class="eq-detail-value">${esc(d.call_name || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Pemegang</div>
          <div class="eq-detail-value eq-detail-value--holder" id="detail-holder-name">
            ${d.user_name ? `<span class="eq-holder-pill">${esc(d.user_name)}</span>` : '<span class="text-muted">Belum ditetapkan</span>'}
          </div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Model</div>
          <div class="eq-detail-value">${esc(d.model || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Nomor Seri</div>
          <div class="eq-detail-value">${esc(d.serial_number || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Firmware</div>
          <div class="eq-detail-value">${esc(d.firmware_version || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Tanggal Beli</div>
          <div class="eq-detail-value">${esc(d.purchase_date || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Garansi s.d.</div>
          <div class="eq-detail-value">${esc(d.warranty_until || "—")}</div>
        </div>
      </div>

      ${
        d.tracker
          ? `
      <div class="eq-detail-section">
        <div class="eq-detail-section-title">Tracker Terpasang</div>
        <div class="eq-detail-grid">
          <div class="eq-detail-item">
            <div class="eq-detail-label">Kode</div>
            <div class="eq-detail-value"><span class="eq-tracker-code">${esc(d.tracker.code)}</span></div>
          </div>
          <div class="eq-detail-item">
            <div class="eq-detail-label">Nama</div>
            <div class="eq-detail-value">${esc(d.tracker.name)}</div>
          </div>
          <div class="eq-detail-item">
            <div class="eq-detail-label">Status</div>
            <div class="eq-detail-value"><span class="badge badge-eq badge-eq--${esc(d.tracker.status)}">${esc(d.tracker.status_label)}</span></div>
          </div>
        </div>
      </div>`
          : ""
      }

      ${
        d.notes
          ? `
      <div class="eq-detail-section">
        <div class="eq-detail-section-title">Catatan</div>
        <div class="eq-detail-value" style="font-size:0.845rem;">${esc(d.notes)}</div>
      </div>`
          : ""
      }

      <div class="eq-detail-section">
        <div class="eq-detail-section-title">Ubah Status</div>
        <div class="eq-edit-row" style="grid-template-columns:1fr auto;">
          <select id="modal-status-select" class="eq-filter-select" style="max-width:100%;width:100%;">
            ${["active", "maintenance", "retired", "lost"]
              .map(
                (s) =>
                  `<option value="${s}" ${d.status === s ? "selected" : ""}>${statusLabel("pico", s)}</option>`,
              )
              .join("")}
          </select>
          <button class="btn btn-primary btn-sm" id="btn-save-status" data-type="pico" data-id="${esc(d.id)}">Simpan</button>
        </div>
      </div>`;

    /* Footer: tombol Hubungkan Pemegang */
    modalFooter.innerHTML = `
      <button class="btn btn-outline btn-sm btn-open-assign"
              data-type="pico" data-id="${esc(d.id)}"
              data-label="${esc(d.pico_number || d.pico_username)}"
              data-current-user="${esc(d.user_id || "")}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        Hubungkan Pemegang
      </button>`;

    setupSaveStatus();
    setupAssignBtnInFooter();
  }

  /* ── Render Equipment detail ─────────────────────────────── */
  function renderEquipmentDetail(d) {
    const catIconMap = {
      tracker: `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>`,
      camera: `<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>`,
      cable: `<path d="M17 8l4 4-4 4"/><path d="M3 12h18"/><circle cx="3" cy="12" r="2"/>`,
      charger: `<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>`,
      mount: `<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>`,
      storage: `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>`,
    };
    const iconPath =
      catIconMap[d.category] ||
      `<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="10"/>`;

    modalBody.innerHTML = `
      <div class="eq-detail-hero">
        <div class="eq-device-icon eq-device-icon--${esc(d.category)} eq-detail-hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
        </div>
        <div>
          <div class="eq-detail-hero-name">${esc(d.code)}</div>
          <div class="eq-detail-hero-sub">${esc(d.name)}</div>
        </div>
        <span class="badge badge-eq badge-eq--${esc(d.status)}" style="margin-left:auto;">${esc(d.status_label)}</span>
      </div>

      <div class="eq-detail-grid">
        <div class="eq-detail-item">
          <div class="eq-detail-label">Kategori</div>
          <div class="eq-detail-value"><span class="badge badge-cat badge-cat--${esc(d.category)}">${esc(d.category_label)}</span></div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Merek / Model</div>
          <div class="eq-detail-value">${esc(d.brand || "—")}${d.model ? " · " + esc(d.model) : ""}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Nomor Seri</div>
          <div class="eq-detail-value">${esc(d.serial_number || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Pemegang</div>
          <div class="eq-detail-value eq-detail-value--holder" id="detail-holder-name">
            ${d.holder_name ? `<span class="eq-holder-pill">${esc(d.holder_name)}</span>` : '<span class="text-muted">Belum ditetapkan</span>'}
          </div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Pasangan Pico</div>
          <div class="eq-detail-value">${d.pico_number ? `<span class="eq-tracker-code">${esc(d.pico_number)}</span>` : "—"}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Tanggal Beli</div>
          <div class="eq-detail-value">${esc(d.purchase_date || "—")}</div>
        </div>
        <div class="eq-detail-item">
          <div class="eq-detail-label">Garansi s.d.</div>
          <div class="eq-detail-value">${esc(d.warranty_until || "—")}</div>
        </div>
      </div>

      ${
        d.notes
          ? `
      <div class="eq-detail-section">
        <div class="eq-detail-section-title">Catatan</div>
        <div class="eq-detail-value" style="font-size:0.845rem;">${esc(d.notes)}</div>
      </div>`
          : ""
      }

      <div class="eq-detail-section">
        <div class="eq-detail-section-title">Ubah Status</div>
        <div class="eq-edit-row" style="grid-template-columns:1fr auto;">
          <select id="modal-status-select" class="eq-filter-select" style="max-width:100%;width:100%;">
            ${["available", "in_use", "maintenance", "retired", "lost"]
              .map(
                (s) =>
                  `<option value="${s}" ${d.status === s ? "selected" : ""}>${statusLabel("equipment", s)}</option>`,
              )
              .join("")}
          </select>
          <button class="btn btn-primary btn-sm" id="btn-save-status" data-type="equipment" data-id="${esc(d.id)}">Simpan</button>
        </div>
      </div>`;

    /* Footer: tombol Hubungkan Pemegang */
    modalFooter.innerHTML = `
      <button class="btn btn-outline btn-sm btn-open-assign"
              data-type="equipment" data-id="${esc(d.id)}"
              data-label="${esc(d.code)} — ${esc(d.name)}"
              data-current-user="${esc(d.holder_id || "")}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        Hubungkan Pemegang
      </button>`;

    setupSaveStatus();
    setupAssignBtnInFooter();
  }

  /* ── Save status ─────────────────────────────────────────── */
  function setupSaveStatus() {
    const btn = document.getElementById("btn-save-status");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      const status = document.getElementById("modal-status-select").value;
      const url =
        type === "pico"
          ? `/manager/pico/${id}/status`
          : `/manager/equipment/${id}/status`;

      btn.disabled = true;
      btn.textContent = "Menyimpan…";

      fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": getCsrf(),
        },
        body: JSON.stringify({ status }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "ok") {
            showFlash(data.message || "Status diperbarui.", "success");
            closeDetailModal();
            const row = document
              .querySelector(`button[data-type="${type}"][data-id="${id}"]`)
              ?.closest("tr");
            if (row) {
              row.dataset.status = status;
              const badge = row.querySelector(".badge-eq");
              if (badge) {
                badge.className = `badge badge-eq badge-eq--${status}`;
                badge.textContent = statusLabel(type, status);
              }
              applyFilters();
            }
          } else {
            showFlash(data.message || "Gagal menyimpan.", "danger");
            btn.disabled = false;
            btn.textContent = "Simpan";
          }
        })
        .catch(() => {
          showFlash("Terjadi kesalahan jaringan.", "danger");
          btn.disabled = false;
          btn.textContent = "Simpan";
        });
    });
  }

  /* ── Delegated click: tombol Detail ─────────────────────── */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-detail");
    if (btn) openDetailModal(btn.dataset.type, btn.dataset.id);
  });

  /* ── Buka assign dari footer modal detail ────────────────── */
  function setupAssignBtnInFooter() {
    const btn = modalFooter.querySelector(".btn-open-assign");
    if (!btn) return;
    btn.addEventListener("click", () => {
      closeDetailModal();
      openAssignModal(
        btn.dataset.type,
        btn.dataset.id,
        btn.dataset.label,
        btn.dataset.currentUser,
      );
    });
  }

  /* ═══════════════════════════════════════════════════
     MODAL HUBUNGKAN PEMEGANG
     ═══════════════════════════════════════════════════ */
  const assignOverlay = document.getElementById("modal-assign-overlay");
  const assignTitle = document.getElementById("assign-modal-title");
  const assignSubtitle = document.getElementById("assign-modal-subtitle");
  const assignItemId = document.getElementById("assign-item-id");
  const assignItemType = document.getElementById("assign-item-type");
  const assignSelect = document.getElementById("assign-user-select");
  const assignPreview = document.getElementById("assign-preview");
  const assignPreviewAva = document.getElementById("assign-preview-avatar");
  const assignPreviewName = document.getElementById("assign-preview-name");
  const btnAssignClose = document.getElementById("btn-assign-close");
  const btnAssignCancel = document.getElementById("btn-assign-cancel");
  const btnAssignSubmit = document.getElementById("btn-assign-submit");

  function openAssignModal(type, id, label, currentUserId) {
    if (!assignOverlay) return;
    assignTitle.textContent =
      type === "pico"
        ? "Hubungkan Pemegang — Headset"
        : "Hubungkan Pemegang — Peralatan";
    assignSubtitle.textContent = label || "";
    assignItemId.value = id;
    assignItemType.value = type;

    /* Set nilai select ke pemegang saat ini */
    if (assignSelect) {
      assignSelect.value = currentUserId || "";
      updateAssignPreview();
    }

    openOverlay(assignOverlay);
  }

  function closeAssignModal() {
    if (!assignOverlay) return;
    closeOverlay(assignOverlay);
  }

  /* Preview karyawan terpilih */
  function updateAssignPreview() {
    if (!assignSelect || !assignPreview) return;
    const opt = assignSelect.options[assignSelect.selectedIndex];
    if (opt && opt.value) {
      assignPreview.style.display = "flex";
      assignPreviewAva.textContent =
        opt.dataset.initials || opt.text.slice(0, 2).toUpperCase();
      assignPreviewName.textContent = opt.text;
    } else {
      assignPreview.style.display = "none";
    }
  }

  if (assignSelect)
    assignSelect.addEventListener("change", updateAssignPreview);
  if (btnAssignClose)
    btnAssignClose.addEventListener("click", closeAssignModal);
  if (btnAssignCancel)
    btnAssignCancel.addEventListener("click", closeAssignModal);
  if (assignOverlay)
    assignOverlay.addEventListener("click", (e) => {
      if (e.target === assignOverlay) closeAssignModal();
    });

  if (btnAssignSubmit) {
    btnAssignSubmit.addEventListener("click", () => {
      const type = assignItemType.value;
      const id = assignItemId.value;
      const userId = assignSelect ? assignSelect.value : "";
      const url =
        type === "pico"
          ? `/manager/pico/${id}/assign`
          : `/manager/equipment/${id}/assign`;

      btnAssignSubmit.disabled = true;
      btnAssignSubmit.innerHTML = "Menyimpan…";

      fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": getCsrf(),
        },
        body: JSON.stringify({ user_id: userId || null }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "ok") {
            showFlash(data.message || "Pemegang diperbarui.", "success");
            closeAssignModal();
            /* Update tabel tanpa reload */
            const row = document
              .querySelector(`button[data-type="${type}"][data-id="${id}"]`)
              ?.closest("tr");
            if (row) {
              const holderCell = row.querySelector(
                ".hide-xs .eq-holder, .hide-sm .eq-holder",
              );
              /* Reload halaman agar avatar & nama terbaru tampil */
              setTimeout(() => location.reload(), 700);
            }
          } else {
            showFlash(data.message || "Gagal menyimpan.", "danger");
            btnAssignSubmit.disabled = false;
            btnAssignSubmit.textContent = "Simpan";
          }
        })
        .catch(() => {
          showFlash("Terjadi kesalahan jaringan.", "danger");
          btnAssignSubmit.disabled = false;
          btnAssignSubmit.textContent = "Simpan";
        });
    });
  }

  /* ═══════════════════════════════════════════════════
     MODAL TAMBAH HEADSET PICO
     ═══════════════════════════════════════════════════ */
  const picoOverlay = document.getElementById("modal-pico-overlay");
  const btnAddPico = document.getElementById("btn-add-pico");
  const btnPicoClose = document.getElementById("btn-pico-close");
  const btnPicoCancel = document.getElementById("btn-pico-cancel");
  const btnPicoSubmit = document.getElementById("btn-pico-submit");
  const formAddPico = document.getElementById("form-add-pico");

  if (btnAddPico)
    btnAddPico.addEventListener("click", () => {
      if (picoOverlay) openOverlay(picoOverlay);
    });

  function closePicoModal() {
    if (!picoOverlay) return;
    closeOverlay(picoOverlay);
    if (formAddPico) formAddPico.reset();
  }

  if (btnPicoClose) btnPicoClose.addEventListener("click", closePicoModal);
  if (btnPicoCancel) btnPicoCancel.addEventListener("click", closePicoModal);
  if (picoOverlay)
    picoOverlay.addEventListener("click", (e) => {
      if (e.target === picoOverlay) closePicoModal();
    });

  if (formAddPico) {
    formAddPico.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = formDataToJson(formAddPico);
      if (btnPicoSubmit) {
        btnPicoSubmit.disabled = true;
        btnPicoSubmit.textContent = "Menyimpan…";
      }

      fetch("/manager/pico/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": getCsrf(),
        },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "ok") {
            showFlash(data.message || "Headset Pico ditambahkan.", "success");
            closePicoModal();
            setTimeout(() => location.reload(), 800);
          } else {
            showFlash(data.message || "Gagal menyimpan.", "danger");
            if (btnPicoSubmit) {
              btnPicoSubmit.disabled = false;
              btnPicoSubmit.textContent = "Simpan";
            }
          }
        })
        .catch(() => {
          showFlash("Terjadi kesalahan jaringan.", "danger");
          if (btnPicoSubmit) {
            btnPicoSubmit.disabled = false;
            btnPicoSubmit.textContent = "Simpan";
          }
        });
    });
  }

  /* ═══════════════════════════════════════════════════
     MODAL TAMBAH PERALATAN
     ═══════════════════════════════════════════════════ */
  const eqOverlay = document.getElementById("modal-equipment-overlay");
  const btnAddEq = document.getElementById("btn-add-equipment");
  const btnEqClose = document.getElementById("btn-eq-close");
  const btnEqCancel = document.getElementById("btn-eq-cancel");
  const btnEqSubmit = document.getElementById("btn-eq-submit");
  const formAddEq = document.getElementById("form-add-equipment");

  if (btnAddEq)
    btnAddEq.addEventListener("click", () => {
      if (eqOverlay) openOverlay(eqOverlay);
    });

  function closeEqModal() {
    if (!eqOverlay) return;
    closeOverlay(eqOverlay);
    if (formAddEq) formAddEq.reset();
  }

  if (btnEqClose) btnEqClose.addEventListener("click", closeEqModal);
  if (btnEqCancel) btnEqCancel.addEventListener("click", closeEqModal);
  if (eqOverlay)
    eqOverlay.addEventListener("click", (e) => {
      if (e.target === eqOverlay) closeEqModal();
    });

  if (formAddEq) {
    formAddEq.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = formDataToJson(formAddEq);
      if (btnEqSubmit) {
        btnEqSubmit.disabled = true;
        btnEqSubmit.textContent = "Menyimpan…";
      }

      fetch("/manager/equipment/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": getCsrf(),
        },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "ok") {
            showFlash(data.message || "Peralatan ditambahkan.", "success");
            closeEqModal();
            setTimeout(() => location.reload(), 800);
          } else {
            showFlash(data.message || "Gagal menyimpan.", "danger");
            if (btnEqSubmit) {
              btnEqSubmit.disabled = false;
              btnEqSubmit.textContent = "Simpan";
            }
          }
        })
        .catch(() => {
          showFlash("Terjadi kesalahan jaringan.", "danger");
          if (btnEqSubmit) {
            btnEqSubmit.disabled = false;
            btnEqSubmit.textContent = "Simpan";
          }
        });
    });
  }

  /* ── Escape key: tutup semua modal ─────────────────────────── */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDetailModal();
      closeAssignModal();
      closePicoModal();
      closeEqModal();
    }
  });

  /* ═══════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════ */
  function openOverlay(el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeOverlay(el) {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function formDataToJson(form) {
    const fd = new FormData(form);
    const obj = {};
    fd.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getCsrf() {
    return (
      document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content") ||
      document.querySelector('input[name="csrf_token"]')?.value ||
      ""
    );
  }

  function showFlash(message, type) {
    const wrap =
      document.querySelector(".flash-wrap") ||
      (() => {
        const el = document.createElement("div");
        el.className = "flash-wrap";
        document.getElementById("main-content")?.prepend(el);
        return el;
      })();
    const el = document.createElement("div");
    el.className = `flash flash-${type}`;
    el.innerHTML = `<span>${esc(message)}</span>
      <button class="flash-close" aria-label="Tutup">×</button>`;
    el.querySelector(".flash-close").addEventListener("click", () =>
      el.remove(),
    );
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  function statusLabel(type, status) {
    const picoMap = {
      active: "Aktif",
      maintenance: "Maintenance",
      retired: "Tidak Dipakai",
      lost: "Hilang",
    };
    const eqMap = {
      available: "Tersedia",
      in_use: "Digunakan",
      maintenance: "Maintenance",
      retired: "Tidak Dipakai",
      lost: "Hilang",
    };
    return (type === "pico" ? picoMap : eqMap)[status] || status;
  }
})();
