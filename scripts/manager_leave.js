/**
 * manager_leave.js — Halaman Pengajuan Izin Manajer
 *
 * I18N keys yang dibutuhkan (definisikan di template sebelum script ini):
 *   mlOptional, mlDay, mlSubmitSuccess, mlError, mlTimeout, mlConnFailed,
 *   mlCancelSuccess, mlCancelFailed, mlApproveSuccess, mlApproveFailed,
 *   mlRejectSuccess, mlRejectFailed, mlThisEmployee, mlClose, mlDefaultType
 */

(function () {
  "use strict";

  const I18N = window.I18N || {};

  /* ── Utilitas ────────────────────────────────────────────────── */
  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  function fetchJSON(url, options, ms) {
    ms = ms || 15000;
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    if (ctrl) {
      options = Object.assign({}, options, { signal: ctrl.signal });
      timer = setTimeout(function () {
        ctrl.abort();
      }, ms);
    }
    return fetch(url, options).then(
      function (res) {
        if (timer) clearTimeout(timer);
        return res;
      },
      function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      },
    );
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
        overlay.querySelector(
          "button:not([disabled]), input:not([disabled]), select, textarea",
        );
      if (el) el.focus();
    }, 50);
  }
  function closeModal(overlay, returnEl) {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    unlockScroll();
    if (returnEl)
      setTimeout(function () {
        returnEl.focus();
      }, 50);
  }

  /* ── Referensi elemen — Modal Ajukan Izin Saya ──────────────── */
  var btnOpen = document.getElementById("btnOpenModal");
  var modalOverlay = document.getElementById("modalOverlay");
  var btnCloseModal = document.getElementById("btnCloseModal");
  var btnCancelModal = document.getElementById("btnCancelModal");
  var startInput = document.getElementById("startDate");
  var endInput = document.getElementById("endDate");
  var reasonArea = document.getElementById("reason");
  var reasonHint = document.getElementById("reasonHint");
  var durSummary = document.getElementById("durationSummary");
  var durText = document.getElementById("durationText");
  var extraOffInfo = document.getElementById("extraOffInfo");
  var btnSubmit = document.getElementById("btnSubmitLeave");
  var submitText = document.getElementById("submitText");
  var submitSpin = document.getElementById("submitSpinner");
  var typeError = document.getElementById("typeError");
  var startError = document.getElementById("startError");
  var endError = document.getElementById("endError");

  /* ── Modal Batalkan Izin Saya ────────────────────────────────── */
  var cancelOverlay = document.getElementById("cancelOverlay");
  var btnCloseCancel = document.getElementById("btnCloseCancelModal");
  var btnKeepLeave = document.getElementById("btnKeepLeave");
  var btnConfirmCancel = document.getElementById("btnConfirmCancel");
  var cancelTypeName = document.getElementById("cancelTypeName");
  var cancelText = document.getElementById("cancelText");
  var cancelSpin = document.getElementById("cancelSpinner");
  var cancelTargetId = null;

  /* ── Modal Approve ───────────────────────────────────────────── */
  var approveOverlay = document.getElementById("approveOverlay");
  var btnCloseApprove = document.getElementById("btnCloseApproveModal");
  var btnCancelApprove = document.getElementById("btnCancelApprove");
  var btnConfirmApprove = document.getElementById("btnConfirmApprove");
  var approveName = document.getElementById("approveName");
  var approveNote = document.getElementById("approveNote");
  var approveText = document.getElementById("approveText");
  var approveSpin = document.getElementById("approveSpinner");
  var approveTargetId = null;

  /* ── Modal Reject ────────────────────────────────────────────── */
  var rejectOverlay = document.getElementById("rejectOverlay");
  var btnCloseReject = document.getElementById("btnCloseRejectModal");
  var btnCancelReject = document.getElementById("btnCancelReject");
  var btnConfirmReject = document.getElementById("btnConfirmReject");
  var rejectName = document.getElementById("rejectName");
  var rejectNote = document.getElementById("rejectNote");
  var rejectNoteError = document.getElementById("rejectNoteError");
  var rejectText = document.getElementById("rejectText");
  var rejectSpin = document.getElementById("rejectSpinner");
  var rejectTargetId = null;

  /* ── Tabs ────────────────────────────────────────────────────── */
  var myStatusTabs = document.getElementById("myStatusTabs");
  var reviewStatusTabs = document.getElementById("reviewStatusTabs");

  [modalOverlay, cancelOverlay, approveOverlay, rejectOverlay].forEach(
    function (o) {
      if (o) o.setAttribute("aria-hidden", "true");
    },
  );

  /* ══════════════════════════════════════════════════════════════
     BAGIAN 1 — IZIN SAYA
     ══════════════════════════════════════════════════════════════ */
  function doOpenLeaveModal() {
    resetForm();
    openModal(modalOverlay);
  }
  function doCloseLeaveModal() {
    closeModal(modalOverlay, btnOpen);
  }

  if (btnOpen) btnOpen.addEventListener("click", doOpenLeaveModal);
  if (btnCloseModal) btnCloseModal.addEventListener("click", doCloseLeaveModal);
  if (btnCancelModal)
    btnCancelModal.addEventListener("click", doCloseLeaveModal);
  if (modalOverlay)
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) doCloseLeaveModal();
    });

  function doOpenCancelModal(id, typeName) {
    cancelTargetId = id;
    if (cancelTypeName) cancelTypeName.textContent = typeName;
    setCancelLoading(false);
    openModal(cancelOverlay, btnConfirmCancel);
  }
  function doCloseCancelModal() {
    cancelTargetId = null;
    closeModal(cancelOverlay);
  }

  if (btnCloseCancel)
    btnCloseCancel.addEventListener("click", doCloseCancelModal);
  if (btnKeepLeave) btnKeepLeave.addEventListener("click", doCloseCancelModal);
  if (cancelOverlay)
    cancelOverlay.addEventListener("click", function (e) {
      if (e.target === cancelOverlay) doCloseCancelModal();
    });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (rejectOverlay && rejectOverlay.classList.contains("is-open"))
      doCloseRejectModal();
    else if (approveOverlay && approveOverlay.classList.contains("is-open"))
      doCloseApproveModal();
    else if (cancelOverlay && cancelOverlay.classList.contains("is-open"))
      doCloseCancelModal();
    else if (modalOverlay && modalOverlay.classList.contains("is-open"))
      doCloseLeaveModal();
  });

  /* Radio jenis izin */
  var typeRadios = document.querySelectorAll('input[name="leave_type"]');
  typeRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (typeError) typeError.hidden = true;
      if (extraOffInfo) extraOffInfo.hidden = this.value !== "extra_off";
      if (reasonHint)
        reasonHint.textContent =
          this.value === "sick" ? I18N.mlOptional || "(opsional)" : "";
      recalcDuration();
    });
  });

  function getSelectedType() {
    var checked = document.querySelector('input[name="leave_type"]:checked');
    return checked ? checked.value : null;
  }

  function parseDateUTC(str) {
    if (!str) return NaN;
    var p = str.split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function recalcDuration() {
    if (!startInput || !endInput || !durSummary || !durText) return;
    var s = parseDateUTC(startInput.value);
    var e = parseDateUTC(endInput.value);
    if (isNaN(s) || isNaN(e) || e < s) {
      durSummary.hidden = true;
      return;
    }
    durText.textContent =
      Math.round((e - s) / 86400000) + 1 + " " + (I18N.mlDay || "hari");
    durSummary.hidden = false;
  }

  if (startInput) {
    startInput.addEventListener("change", function () {
      if (endInput && endInput.value && endInput.value < this.value)
        endInput.value = this.value;
      if (endInput) endInput.min = this.value;
      if (startError) startError.hidden = true;
      recalcDuration();
    });
  }
  if (endInput) {
    endInput.addEventListener("change", function () {
      if (endError) endError.hidden = true;
      recalcDuration();
    });
  }

  function validateForm() {
    var valid = true;
    if (!getSelectedType()) {
      if (typeError) typeError.hidden = false;
      valid = false;
    } else {
      if (typeError) typeError.hidden = true;
    }
    if (!startInput || !startInput.value) {
      if (startError) startError.hidden = false;
      valid = false;
    } else {
      if (startError) startError.hidden = true;
    }
    var sv = startInput ? startInput.value : "";
    var ev = endInput ? endInput.value : "";
    if (!ev || (sv && ev < sv)) {
      if (endError) endError.hidden = false;
      valid = false;
    } else {
      if (endError) endError.hidden = true;
    }
    return valid;
  }

  function resetForm() {
    typeRadios.forEach(function (r) {
      r.checked = false;
    });
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    if (reasonArea) reasonArea.value = "";
    if (typeError) typeError.hidden = true;
    if (startError) startError.hidden = true;
    if (endError) endError.hidden = true;
    if (durSummary) durSummary.hidden = true;
    if (extraOffInfo) extraOffInfo.hidden = true;
    if (reasonHint) reasonHint.textContent = "";
    setSubmitLoading(false);
  }

  function setSubmitLoading(on) {
    if (!btnSubmit) return;
    btnSubmit.disabled = on;
    if (submitText) submitText.hidden = on;
    if (submitSpin) submitSpin.hidden = !on;
  }

  if (btnSubmit) {
    btnSubmit.addEventListener("click", function () {
      if (!validateForm()) return;
      setSubmitLoading(true);
      fetchJSON("/manager/leaves", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken(),
        },
        body: JSON.stringify({
          leave_type: getSelectedType(),
          start_date: startInput ? startInput.value : "",
          end_date: endInput ? endInput.value : "",
          reason: reasonArea ? reasonArea.value.trim() : "",
        }),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            doCloseLeaveModal();
            showToast(
              r.d.message ||
                I18N.mlSubmitSuccess ||
                "Pengajuan berhasil dikirim.",
              "success",
            );
            setTimeout(function () {
              location.reload();
            }, 900);
          } else {
            showToast(
              r.d.message || I18N.mlError || "Terjadi kesalahan.",
              "danger",
            );
            setSubmitLoading(false);
          }
        })
        .catch(function (err) {
          showToast(
            err && err.name === "AbortError"
              ? I18N.mlTimeout || "Permintaan timeout."
              : I18N.mlConnFailed || "Gagal terhubung.",
            "danger",
          );
          setSubmitLoading(false);
        });
    });
  }

  if (myStatusTabs) {
    myStatusTabs.addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab) return;
      myStatusTabs.querySelectorAll(".tab").forEach(function (t) {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      var filter = tab.dataset.filter;
      document
        .querySelectorAll("#myLeaveTable tbody tr")
        .forEach(function (row) {
          row.classList.toggle(
            "row-hidden",
            filter !== "all" && row.dataset.status !== filter,
          );
        });
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".btn-cancel-leave");
    if (!btn) return;
    doOpenCancelModal(
      btn.dataset.id,
      btn.dataset.type || I18N.mlDefaultType || "izin",
    );
  });

  function setCancelLoading(on) {
    if (!btnConfirmCancel) return;
    btnConfirmCancel.disabled = on;
    if (cancelText) cancelText.hidden = on;
    if (cancelSpin) cancelSpin.hidden = !on;
  }

  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener("click", function () {
      if (!cancelTargetId) return;
      setCancelLoading(true);
      fetchJSON("/manager/leaves/" + cancelTargetId + "/cancel", {
        method: "POST",
        headers: { "X-CSRFToken": csrfToken() },
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            doCloseCancelModal();
            showToast(
              r.d.message || I18N.mlCancelSuccess || "Pengajuan dibatalkan.",
              "success",
            );
            setTimeout(function () {
              location.reload();
            }, 900);
          } else {
            showToast(
              r.d.message || I18N.mlCancelFailed || "Gagal membatalkan.",
              "danger",
            );
            setCancelLoading(false);
          }
        })
        .catch(function (err) {
          showToast(
            err && err.name === "AbortError"
              ? I18N.mlTimeout || "Permintaan timeout."
              : I18N.mlConnFailed || "Gagal terhubung.",
            "danger",
          );
          setCancelLoading(false);
        });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     BAGIAN 2 — APPROVAL IZIN TIM
     ══════════════════════════════════════════════════════════════ */
  if (reviewStatusTabs) {
    reviewStatusTabs.addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab) return;
      reviewStatusTabs.querySelectorAll(".tab").forEach(function (t) {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      var filter = tab.dataset.filter;
      document
        .querySelectorAll("#leaveListTable tbody tr")
        .forEach(function (row) {
          row.classList.toggle("row-hidden", row.dataset.status !== filter);
        });
    });
  }

  function doOpenApproveModal(id, name) {
    approveTargetId = id;
    if (approveName) approveName.textContent = name;
    if (approveNote) approveNote.value = "";
    setApproveLoading(false);
    openModal(approveOverlay, btnConfirmApprove);
  }
  function doCloseApproveModal() {
    approveTargetId = null;
    closeModal(approveOverlay);
  }

  if (btnCloseApprove)
    btnCloseApprove.addEventListener("click", doCloseApproveModal);
  if (btnCancelApprove)
    btnCancelApprove.addEventListener("click", doCloseApproveModal);
  if (approveOverlay)
    approveOverlay.addEventListener("click", function (e) {
      if (e.target === approveOverlay) doCloseApproveModal();
    });

  function doOpenRejectModal(id, name) {
    rejectTargetId = id;
    if (rejectName) rejectName.textContent = name;
    if (rejectNote) rejectNote.value = "";
    if (rejectNoteError) rejectNoteError.hidden = true;
    setRejectLoading(false);
    openModal(rejectOverlay, rejectNote);
  }
  function doCloseRejectModal() {
    rejectTargetId = null;
    closeModal(rejectOverlay);
  }

  if (btnCloseReject)
    btnCloseReject.addEventListener("click", doCloseRejectModal);
  if (btnCancelReject)
    btnCancelReject.addEventListener("click", doCloseRejectModal);
  if (rejectOverlay)
    rejectOverlay.addEventListener("click", function (e) {
      if (e.target === rejectOverlay) doCloseRejectModal();
    });

  document.addEventListener("click", function (e) {
    var approveBtn = e.target.closest(".btn-review-approve");
    if (approveBtn) {
      doOpenApproveModal(
        approveBtn.dataset.id,
        approveBtn.dataset.name || I18N.mlThisEmployee || "karyawan ini",
      );
      return;
    }
    var rejectBtn = e.target.closest(".btn-review-reject");
    if (rejectBtn) {
      doOpenRejectModal(
        rejectBtn.dataset.id,
        rejectBtn.dataset.name || I18N.mlThisEmployee || "karyawan ini",
      );
    }
  });

  function setApproveLoading(on) {
    if (!btnConfirmApprove) return;
    btnConfirmApprove.disabled = on;
    if (approveText) approveText.hidden = on;
    if (approveSpin) approveSpin.hidden = !on;
  }

  if (btnConfirmApprove) {
    btnConfirmApprove.addEventListener("click", function () {
      if (!approveTargetId) return;
      setApproveLoading(true);
      fetchJSON("/manager/leaves/" + approveTargetId + "/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken(),
        },
        body: JSON.stringify({
          note: approveNote ? approveNote.value.trim() : "",
        }),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            doCloseApproveModal();
            showToast(
              r.d.message || I18N.mlApproveSuccess || "Pengajuan disetujui.",
              "success",
            );
            setTimeout(function () {
              location.reload();
            }, 900);
          } else {
            showToast(
              r.d.message || I18N.mlApproveFailed || "Gagal menyetujui.",
              "danger",
            );
            setApproveLoading(false);
          }
        })
        .catch(function (err) {
          showToast(
            err && err.name === "AbortError"
              ? I18N.mlTimeout || "Permintaan timeout."
              : I18N.mlConnFailed || "Gagal terhubung.",
            "danger",
          );
          setApproveLoading(false);
        });
    });
  }

  function setRejectLoading(on) {
    if (!btnConfirmReject) return;
    btnConfirmReject.disabled = on;
    if (rejectText) rejectText.hidden = on;
    if (rejectSpin) rejectSpin.hidden = !on;
  }

  if (btnConfirmReject) {
    btnConfirmReject.addEventListener("click", function () {
      if (!rejectTargetId) return;
      var note = rejectNote ? rejectNote.value.trim() : "";
      if (!note) {
        if (rejectNoteError) rejectNoteError.hidden = false;
        return;
      }
      if (rejectNoteError) rejectNoteError.hidden = true;
      setRejectLoading(true);
      fetchJSON("/manager/leaves/" + rejectTargetId + "/reject", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken(),
        },
        body: JSON.stringify({ note }),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d };
          });
        })
        .then(function (r) {
          if (r.ok) {
            doCloseRejectModal();
            showToast(
              r.d.message || I18N.mlRejectSuccess || "Pengajuan ditolak.",
              "success",
            );
            setTimeout(function () {
              location.reload();
            }, 900);
          } else {
            showToast(
              r.d.message || I18N.mlRejectFailed || "Gagal menolak.",
              "danger",
            );
            setRejectLoading(false);
          }
        })
        .catch(function (err) {
          showToast(
            err && err.name === "AbortError"
              ? I18N.mlTimeout || "Permintaan timeout."
              : I18N.mlConnFailed || "Gagal terhubung.",
            "danger",
          );
          setRejectLoading(false);
        });
    });
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  function showToast(message, category) {
    var wrap = document.querySelector(".flash-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "flash-wrap";
      var main = document.getElementById("main-content");
      (main || document.body).insertBefore(
        wrap,
        (main || document.body).firstChild,
      );
    }
    var flash = document.createElement("div");
    flash.className = "flash flash-" + category;
    flash.setAttribute("role", "alert");
    flash.setAttribute("aria-live", "polite");
    var msg = document.createElement("span");
    msg.textContent = message;
    var close = document.createElement("button");
    close.className = "flash-close";
    close.setAttribute("aria-label", I18N.mlClose || "Tutup");
    close.textContent = "\u00d7";
    close.addEventListener("click", function () {
      flash.remove();
    });
    flash.appendChild(msg);
    flash.appendChild(close);
    wrap.appendChild(flash);
    setTimeout(function () {
      if (flash.parentNode) flash.remove();
    }, 5000);
  }
})();
