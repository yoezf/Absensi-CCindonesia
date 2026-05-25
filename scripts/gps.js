/**
 * GPS Check-in/out Handler
 * Dipakai di: employee/dashboard.html dan manager/dashboard.html
 *
 * Perbaikan:
 *  1. Office data di-fetch live dari API (/employee/offices.json atau
 *     /manager/offices.json) setiap kali halaman dibuka — tidak lagi
 *     bergantung pada window.OFFICES yang bisa stale setelah edit kantor.
 *  2. window.OFFICES tetap sebagai fallback jika fetch gagal (offline, dsb).
 *  3. setStatus() mempertahankan base class elemen (mgr-gps-status vs gps-status).
 *
 * I18N keys yang dibutuhkan (definisikan di template sebelum script ini):
 *   gpsOfficeNotConfigured, gpsOfficeNotFound, gpsTapCheckOut, gpsTapCheckIn,
 *   gpsWaiting, gpsDetecting, gpsInsideArea, gpsOutsideArea, gpsDistanceUnknown,
 *   gpsMetersFromOffice, gpsKmFromOffice, gpsPermissionDenied, gpsSignalUnavailable,
 *   gpsTimedOut, gpsError, gpsOutsideOffice, gpsBrowserNoSupport, gpsNotSupported,
 *   gpsNotReady, gpsProcessing, gpsUpdatingPage, gpsConnectionError
 */

(function () {
  "use strict";

  const I18N = window.I18N || {};

  const GPS_TIMEOUT = 12000;
  const GPS_MAX_AGE = 8000;

  const btnMain = document.getElementById("btn-main");
  const statusEl = document.getElementById("gps-status");
  const statusText = statusEl?.querySelector(".gps-status-text");
  const accuracyEl = document.getElementById("gps-accuracy");
  const noteEl = document.getElementById("checkin-note");

  // Preserve base class: employee uses "gps-status", manager uses "mgr-gps-status"
  const GPS_BASE_CLASS = statusEl?.classList.contains("mgr-gps-status")
    ? "mgr-gps-status"
    : "gps-status";

  const STATE = window.CHECKIN_STATE || "out";
  const IS_MANAGER = window.location.pathname.startsWith("/manager");
  const BASE_PATH = IS_MANAGER ? "/manager" : "/employee";

  // Jika sudah check-out, sedang cuti/izin, atau terlalu awal untuk checkout
  // — tidak perlu GPS sama sekali.
  if (STATE === "done" || STATE === "leave" || STATE === "early") return;

  // Jika sudah check-in tapi belum waktunya checkout (checkout_too_early),
  // GPS tetap berjalan agar tombol bisa aktif saat jam buka checkout tiba —
  // NAMUN jika CHECKOUT_TOO_EARLY = true saat init, nonaktifkan tombol dulu
  // dengan pesan yang tepat sampai GPS resolve & waktu valid.
  const IS_CHECKOUT_TOO_EARLY = window.CHECKOUT_TOO_EARLY === true;

  // Jika btn-main tidak ada (misal: absensi ditutup / past_cutoff),
  // GPS tetap berjalan agar status lokasi tetap ditampilkan di UI.
  // enableButton() dan disableButton() sudah null-safe (ada guard !btnMain).

  // ── State ──────────────────────────────────────────────────────────────────
  let offices = []; // populated after API fetch (or fallback)
  let userLat = null;
  let userLng = null;
  let userAccuracy = null;
  let gpsReady = false;
  let positionReady = false;

  // ── UI helpers ─────────────────────────────────────────────────────────────
  function setStatus(type, text) {
    if (!statusEl) return;
    statusEl.className = GPS_BASE_CLASS + " gps-" + type;
    if (statusText) statusText.textContent = text;
  }

  function setNote(text) {
    if (noteEl) noteEl.textContent = text;
  }

  function enableButton() {
    if (!btnMain) return;
    btnMain.disabled = false;
    setNote(STATE === "in" ? I18N.gpsTapCheckOut : I18N.gpsTapCheckIn);
  }

  function disableButton(reason) {
    if (!btnMain) return;
    btnMain.disabled = true;
    setNote(reason);
  }

  // ── Haversine ──────────────────────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Office proximity check ─────────────────────────────────────────────────
  function checkAllOffices(lat, lng) {
    if (!offices.length) return { inside: false, office: null, distance: null };

    let nearestOffice = null;
    let nearestDistance = null;

    for (const office of offices) {
      if (office.lat == null || office.lng == null) continue;
      const d = haversine(lat, lng, office.lat, office.lng);

      if (nearestDistance === null || d < nearestDistance) {
        nearestDistance = d;
        nearestOffice = office;
      }

      if (d <= office.radius_meters) {
        return { inside: true, office, distance: d };
      }
    }

    return { inside: false, office: nearestOffice, distance: nearestDistance };
  }

  // ── Evaluate position against current offices ──────────────────────────────
  function evaluatePosition() {
    if (!positionReady) return;

    if (!offices.length) {
      setStatus("error", I18N.gpsOfficeNotConfigured);
      disableButton(I18N.gpsOfficeNotFound);
      return;
    }

    const result = checkAllOffices(userLat, userLng);

    if (result.inside) {
      setStatus("ok", I18N.gpsInsideArea + " " + (result.office.name || ""));
      gpsReady = true;
      if (IS_CHECKOUT_TOO_EARLY) {
        // Dalam area, tapi belum waktunya checkout — update status lokasi
        // tapi jangan enable tombol (pesan sudah diset dari template)
        disableButton(I18N.checkoutTooEarly || I18N.gpsWaiting);
      } else {
        enableButton();
      }
    } else {
      gpsReady = false;
      const dist = result.distance;
      const distText =
        dist === null
          ? I18N.gpsDistanceUnknown
          : dist < 1000
            ? Math.round(dist) + " " + I18N.gpsMetersFromOffice
            : (dist / 1000).toFixed(1) + " " + I18N.gpsKmFromOffice;
      setStatus("outside", I18N.gpsOutsideArea + " · " + distText);
      disableButton(I18N.gpsOutsideOffice);
    }
  }

  // ── Fetch fresh office data from API ───────────────────────────────────────
  function fetchOffices() {
    return fetch(BASE_PATH + "/offices.json", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (Array.isArray(data.offices) && data.offices.length > 0) {
          offices = data.offices;
        } else {
          useFallbackOffices();
        }
      })
      .catch(function () {
        // Network/parse error — fallback to baked-in data silently
        useFallbackOffices();
      });
  }

  function useFallbackOffices() {
    offices =
      window.OFFICES && window.OFFICES.length
        ? window.OFFICES
        : window.OFFICE && window.OFFICE.lat
          ? [window.OFFICE]
          : [];
  }

  // ── GPS callbacks ──────────────────────────────────────────────────────────
  function onPosition(pos) {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    userAccuracy = pos.coords.accuracy;
    positionReady = true;

    if (accuracyEl) {
      accuracyEl.textContent = "\u00b1" + Math.round(userAccuracy) + " m";
    }
  }

  function onError(err) {
    const msgs = {
      1: I18N.gpsPermissionDenied,
      2: I18N.gpsSignalUnavailable,
      3: I18N.gpsTimedOut,
    };
    const msg = msgs[err.code] || I18N.gpsError;
    setStatus("error", msg);
    disableButton(msg);
    positionReady = false;
  }

  // ── Bootstrap: run GPS + office fetch in parallel ─────────────────────────
  if (!("geolocation" in navigator)) {
    setStatus("error", I18N.gpsBrowserNoSupport);
    disableButton(I18N.gpsNotSupported);
    return;
  }

  setStatus("detecting", I18N.gpsDetecting);
  if (IS_CHECKOUT_TOO_EARLY) {
    // Sudah check-in, belum waktunya checkout — tombol tetap disabled dengan pesan tepat
    disableButton(I18N.checkoutTooEarly || I18N.gpsWaiting);
  } else {
    disableButton(I18N.gpsWaiting);
  }

  const geoPromise = new Promise(function (resolve) {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        onPosition(pos);
        resolve();
      },
      function (err) {
        onError(err);
        resolve();
      },
      {
        enableHighAccuracy: true,
        timeout: GPS_TIMEOUT,
        maximumAge: GPS_MAX_AGE,
      },
    );
  });

  const officesPromise = fetchOffices();

  // Evaluate once BOTH are ready
  Promise.all([geoPromise, officesPromise]).then(function () {
    if (!positionReady) return; // GPS failed — onError() already handled UI
    evaluatePosition();
  });

  // ── Checkin / checkout action ──────────────────────────────────────────────
  window.doCheckin = function (action) {
    if (!gpsReady || userLat === null) {
      setNote(I18N.gpsNotReady);
      return;
    }

    btnMain.disabled = true;
    setNote(I18N.gpsProcessing);

    fetch(BASE_PATH + "/" + action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": window.CSRF_TOKEN || "",
      },
      body: JSON.stringify({
        lat: userLat,
        lng: userLng,
        accuracy: userAccuracy,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.status === "ok") {
          setStatus("ok", data.message || "OK");
          setNote(I18N.gpsUpdatingPage);
          setTimeout(function () {
            location.reload();
          }, 1100);
        } else if (data.status === "outside") {
          setStatus("outside", data.message || I18N.gpsOutsideOffice);
          setNote(data.message || I18N.gpsOutsideOffice);
          if (gpsReady) btnMain.disabled = false;
        } else {
          setNote(data.message || I18N.gpsError);
          if (gpsReady) btnMain.disabled = false;
        }
      })
      .catch(function () {
        setNote(I18N.gpsConnectionError);
        if (gpsReady) btnMain.disabled = false;
      });
  };
})();
