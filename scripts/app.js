/**
 * app.js — Utilitas umum yang diload di semua halaman
 */

(function () {
    'use strict';

    // ── Auto-dismiss flash messages setelah 5 detik ───────────
    document.querySelectorAll('.flash').forEach(function (el) {
        setTimeout(function () {
            el.style.transition = 'opacity .4s';
            el.style.opacity    = '0';
            setTimeout(function () { el.remove(); }, 400);
        }, 5000);
    });

    // ── Active nav indicator helper ───────────────────────────
    // Sudah ditangani Jinja2 di template, ini backup untuk JS navigation
    const path = window.location.pathname;
    document.querySelectorAll('.bottom-nav a, .sidebar-nav a').forEach(function (a) {
        if (a.getAttribute('href') === path) {
            a.classList.add('active');
        }
    });

}());
