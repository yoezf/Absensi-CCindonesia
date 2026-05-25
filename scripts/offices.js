/**
 * offices.js — Manajemen kantor: modal tambah/edit, toggle aktif, detail karyawan
 *
 * I18N keys yang dibutuhkan (definisikan di template sebelum script ini):
 *   officeAddTitle, officeAddBtn, officeEditTitle, officeSaveBtn, officeSaving,
 *   officeNameRequired, officeCoordRequired, officeError, officeConnFailed,
 *   officeConfirmToggle  (template: gunakan {action} sebagai placeholder)
 *   officeDeactivate, officeActivate, officeToggleFailed, officeLoading,
 *   officeLoadFailed, officeEmployeesTitle  (prefix, diikuti nama kantor)
 *   officeNoEmployees
 */

(function () {
  "use strict";

  const I18N = window.I18N || {};
  const CSRF = () =>
    document.querySelector('meta[name="csrf-token"]')?.content || "";

  let editingId = null;

  function $(id) {
    return document.getElementById(id);
  }
  function openOverlay(id) {
    $(id).classList.add("open");
  }
  function closeOverlay(id) {
    $(id).classList.remove("open");
  }

  // ── Buka modal TAMBAH ──────────────────────────────────────────────────────
  window.openAdd = function () {
    editingId = null;
    $("ofc-modal-title").textContent = I18N.officeAddTitle || "Tambah Kantor";
    $("ofc-save-label").textContent = I18N.officeAddBtn || "Tambah";
    clearForm();
    openOverlay("ofc-modal-overlay");
    $("f-name").focus();
  };

  // ── Buka modal EDIT ────────────────────────────────────────────────────────
  window.openEdit = function (card) {
    editingId = card.dataset.id;
    $("ofc-modal-title").textContent = I18N.officeEditTitle || "Edit Kantor";
    $("ofc-save-label").textContent = I18N.officeSaveBtn || "Simpan Perubahan";
    $("f-name").value = card.dataset.name || "";
    $("f-address").value = card.dataset.address || "";
    $("f-lat").value = card.dataset.lat || "";
    $("f-lng").value = card.dataset.lng || "";
    $("f-radius").value = card.dataset.radius || 100;
    $("f-wstart").value = card.dataset.wstart || "08:00";
    $("f-wend").value = card.dataset.wend || "17:00";
    $("f-tol").value = card.dataset.tol || 15;
    openOverlay("ofc-modal-overlay");
    $("f-name").focus();
  };

  function clearForm() {
    ["f-name", "f-address"].forEach((id) => ($(id).value = ""));
    $("f-lat").value = "";
    $("f-lng").value = "";
    $("f-radius").value = "100";
    $("f-wstart").value = "08:00";
    $("f-wend").value = "17:00";
    $("f-tol").value = "15";
  }

  // ── Tutup modal ────────────────────────────────────────────────────────────
  window.closeModal = function (e) {
    if (e.target === $("ofc-modal-overlay")) closeOverlay("ofc-modal-overlay");
  };
  window.closeModalDirect = function () {
    closeOverlay("ofc-modal-overlay");
  };
  window.closeDetailModal = function (e) {
    if (e.target === $("ofc-detail-overlay"))
      closeOverlay("ofc-detail-overlay");
  };

  // ── Simpan (tambah / edit) ─────────────────────────────────────────────────
  window.saveOffice = async function () {
    const name = $("f-name").value.trim();
    const address = $("f-address").value.trim();
    const lat = parseFloat($("f-lat").value);
    const lng = parseFloat($("f-lng").value);
    const radius = parseInt($("f-radius").value);
    const wstart = $("f-wstart").value;
    const wend = $("f-wend").value;
    const tol = parseInt($("f-tol").value);

    if (!name) {
      alert(I18N.officeNameRequired || "Nama kantor wajib diisi.");
      return;
    }
    if (isNaN(lat) || isNaN(lng)) {
      alert(
        I18N.officeCoordRequired || "Koordinat latitude/longitude wajib diisi.",
      );
      return;
    }

    const btn = $("ofc-save-btn");
    btn.disabled = true;
    $("ofc-save-label").textContent = I18N.officeSaving || "Menyimpan…";

    const url = editingId
      ? `/manager/offices/${editingId}`
      : "/manager/offices";
    const method = editingId ? "PUT" : "POST";
    const body = JSON.stringify({
      name,
      address,
      latitude: lat,
      longitude: lng,
      radius_meters: radius,
      work_start: wstart,
      work_end: wend,
      late_tolerance_minutes: tol,
    });

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF() },
        body,
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || I18N.officeError || "Terjadi kesalahan.");
        return;
      }
      closeOverlay("ofc-modal-overlay");
      window.location.reload();
    } catch {
      alert(I18N.officeConnFailed || "Koneksi gagal. Coba lagi.");
    } finally {
      btn.disabled = false;
      $("ofc-save-label").textContent = editingId
        ? I18N.officeSaveBtn || "Simpan Perubahan"
        : I18N.officeAddBtn || "Tambah";
    }
  };

  // ── Toggle aktif / nonaktif ────────────────────────────────────────────────
  window.toggleOffice = async function (id, isActive, btn) {
    const action = isActive
      ? I18N.officeDeactivate || "nonaktifkan"
      : I18N.officeActivate || "aktifkan";
    const confirmMsg = (
      I18N.officeConfirmToggle || "Yakin ingin {action} kantor ini?"
    ).replace("{action}", action);

    if (!confirm(confirmMsg)) return;
    btn.disabled = true;

    try {
      const res = await fetch(`/manager/offices/${id}/toggle`, {
        method: "POST",
        headers: { "X-CSRFToken": CSRF() },
      });
      const data = await res.json();
      if (data.ok) window.location.reload();
      else
        alert(
          data.error ||
            I18N.officeToggleFailed ||
            "Gagal mengubah status kantor.",
        );
    } catch {
      alert(I18N.officeConnFailed || "Koneksi gagal.");
    } finally {
      btn.disabled = false;
    }
  };

  // ── Detail karyawan (modal) ────────────────────────────────────────────────
  window.showDetail = async function (officeId) {
    const list = $("ofc-detail-emp-list");
    list.innerHTML =
      '<div class="ofc-empty-emp">' +
      (I18N.officeLoading || "Memuat…") +
      "</div>";
    openOverlay("ofc-detail-overlay");

    try {
      const res = await fetch(`/manager/offices/${officeId}/detail`);
      const data = await res.json();

      if (!data.ok) {
        list.innerHTML =
          '<div class="ofc-empty-emp">' +
          (I18N.officeLoadFailed || "Gagal memuat data.") +
          "</div>";
        return;
      }

      $("ofc-detail-title").textContent =
        (I18N.officeEmployeesTitle || "Karyawan — ") + data.office.name;

      if (!data.employees.length) {
        list.innerHTML =
          '<div class="ofc-empty-emp">' +
          (I18N.officeNoEmployees ||
            "Belum ada karyawan yang di-assign ke kantor ini.") +
          "</div>";
        return;
      }

      list.innerHTML = data.employees
        .map(
          (emp) => `
        <div class="ofc-detail-emp-row${emp.is_active ? "" : " inactive"}">
          <div class="ofc-det-avatar">${emp.initials}</div>
          <div>
            <div class="ofc-det-name">${emp.full_name}</div>
            <div class="ofc-det-meta">${emp.department} · ${emp.code}</div>
          </div>
          ${emp.is_primary ? '<span class="ofc-det-primary">Utama</span>' : ""}
        </div>`,
        )
        .join("");
    } catch {
      list.innerHTML =
        '<div class="ofc-empty-emp">' +
        (I18N.officeLoadFailed || "Gagal memuat data.") +
        "</div>";
    }
  };

  // ── Keyboard ESC ──────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeOverlay("ofc-modal-overlay");
      closeOverlay("ofc-detail-overlay");
    }
  });
})();
