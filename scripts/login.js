/**
 * login.js — logika halaman autentikasi
 *
 * I18N keys yang dibutuhkan (definisikan di template sebelum script ini):
 *   loginEmailRequired, loginEmailInvalid, loginPasswordRequired,
 *   loginFailed, loginConnectionFailed, loginHidePassword, loginShowPassword
 */

(function () {
  "use strict";

  const I18N = window.I18N || {};

  /* ── Elemen ──────────────────────────────────────────────── */
  const form = document.getElementById("loginForm");
  const emailEl = document.getElementById("email");
  const passwordEl = document.getElementById("password");
  const toggleBtn = document.getElementById("togglePw");
  const eyeIcon = document.getElementById("eyeIcon");
  const submitBtn = document.getElementById("loginBtn");
  const alert = document.getElementById("loginAlert");
  const alertMsg = document.getElementById("loginAlertMsg");

  if (!form) return;

  /* ── SVG ikon mata ───────────────────────────────────────── */
  const SVG_EYE_OPEN =
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
    '<circle cx="12" cy="12" r="3"/>';

  const SVG_EYE_CLOSED =
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8' +
    'a18.45 18.45 0 0 1 5.06-5.94"/>' +
    '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8' +
    'a18.5 18.5 0 0 1-2.16 3.19"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>';

  /* ── Helpers ─────────────────────────────────────────────── */
  function showAlert(msg) {
    alertMsg.textContent = msg;
    alert.hidden = false;
    alert.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function hideAlert() {
    alert.hidden = true;
    alertMsg.textContent = "";
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-loading", on);
    submitBtn.setAttribute("aria-busy", on ? "true" : "false");
  }

  /* ── Toggle show / hide password ─────────────────────────── */
  toggleBtn.addEventListener("click", function () {
    const isHidden = passwordEl.type === "password";
    passwordEl.type = isHidden ? "text" : "password";
    eyeIcon.innerHTML = isHidden ? SVG_EYE_CLOSED : SVG_EYE_OPEN;
    toggleBtn.setAttribute(
      "aria-label",
      isHidden
        ? I18N.loginHidePassword || "Sembunyikan kata sandi"
        : I18N.loginShowPassword || "Tampilkan kata sandi",
    );
  });

  [emailEl, passwordEl].forEach((el) =>
    el.addEventListener("input", hideAlert),
  );

  /* ── Validasi ────────────────────────────────────────────── */
  function validate() {
    const email = emailEl.value.trim();
    const password = passwordEl.value;

    if (!email) {
      showAlert(I18N.loginEmailRequired || "Email tidak boleh kosong.");
      emailEl.focus();
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAlert(I18N.loginEmailInvalid || "Format email tidak valid.");
      emailEl.focus();
      return false;
    }
    if (!password) {
      showAlert(I18N.loginPasswordRequired || "Kata sandi tidak boleh kosong.");
      passwordEl.focus();
      return false;
    }
    return true;
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  /* ── Submit ──────────────────────────────────────────────── */
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    hideAlert();

    if (!validate()) return;

    setLoading(true);

    const payload = {
      email: emailEl.value.trim(),
      password: passwordEl.value,
      remember: document.getElementById("remember").checked,
    };

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }

      showAlert(
        data.message ||
          I18N.loginFailed ||
          "Email atau kata sandi salah. Silakan coba lagi.",
      );
    } catch {
      showAlert(
        I18N.loginConnectionFailed ||
          "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.",
      );
    } finally {
      if (!document.hidden) setLoading(false);
    }
  });
})();
