/**
 * notifications.js — In-app notification bell
 *
 * Cara pakai: tambahkan elemen berikut di base.html (sidebar/header):
 *   <div id="notif-bell-wrap"></div>
 *
 * Script ini:
 *  - Membuat bell icon dengan badge unread count
 *  - Menampilkan dropdown list notifikasi dengan desain bersih
 *  - Polling tiap 60 detik untuk notifikasi baru
 *  - Mendukung mark as read per item maupun semua sekaligus
 */

(function () {
  "use strict";

  /* ─── Config ──────────────────────────────────────────────────────────── */

  const IS_MANAGER =
    window.location.pathname.startsWith("/manager") ||
    window.location.pathname.startsWith("/executive");
  const BASE = IS_MANAGER ? "/manager" : "/employee";
  const POLL_INTERVAL = 60_000; // ms

  /* ─── i18n strings: baca dari window.APP.I18N (diisi template Jinja2),
         fallback ke Bahasa Indonesia agar tidak crash jika APP belum tersedia ── */
  const _i = (window.APP && window.APP.I18N) || {};
  const T = {
    title: _i.notifTitle || "Notifikasi",
    markAllRead: _i.notifMarkAllRead || "Tandai semua dibaca",
    loading: _i.notifLoading || "Memuat\u2026",
    empty: _i.notifEmpty || "Tidak ada notifikasi",
    error: _i.notifError || "Gagal memuat notifikasi",
  };

  /* ─── Mount point ─────────────────────────────────────────────────────── */

  const wrap = document.getElementById("notif-bell-wrap");
  if (!wrap) return;

  /* ─── Inject HTML ─────────────────────────────────────────────────────── */

  wrap.innerHTML = `
    <div class="nb-container" id="nb-container">
      <button class="nb-bell" id="nb-bell" aria-label="${T.title}" aria-expanded="false" aria-haspopup="dialog">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="nb-badge" id="nb-badge" hidden aria-live="polite" aria-atomic="true">0</span>
      </button>

      <div class="nb-dropdown" id="nb-dropdown" role="dialog" aria-label="${T.title}" aria-modal="false" hidden>
        <div class="nb-dropdown-header">
          <span class="nb-dropdown-title">${T.title}</span>
          <button class="nb-read-all" id="nb-read-all" type="button">${T.markAllRead}</button>
        </div>
        <ul class="nb-list" id="nb-list" role="list">
          <li class="nb-empty" role="listitem">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span>${T.loading}</span>
          </li>
        </ul>
      </div>
    </div>
  `;

  /* ─── Inject CSS ──────────────────────────────────────────────────────── */

  if (!document.getElementById("nb-style")) {
    const style = document.createElement("style");
    style.id = "nb-style";
    style.textContent = `
/* Notification Bell — nb-* namespace */

.nb-container {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* Bell button */
.nb-bell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--color-text-secondary, #6b7280);
  transition: background 0.15s, color 0.15s;
  padding: 0;
}

.nb-bell:hover {
  background: var(--color-background-secondary, #f3f4f6);
  color: var(--color-text-primary, #111827);
}

.nb-bell:focus-visible {
  outline: 2px solid var(--color-border-focus, #3b82f6);
  outline-offset: 2px;
}

/* Badge */
.nb-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--color-background-danger, #ef4444);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  border: 2px solid var(--color-background-primary, #fff);
}

/* Dropdown panel */
.nb-dropdown {
  position: fixed;
  width: 340px;
  max-height: 480px;
  background: var(--color-background-primary, #fff);
  border: 1px solid var(--color-border-secondary, #e5e7eb);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,.14), 0 2px 8px rgba(0,0,0,.07);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: nb-fade-in 0.15s ease;
}

/* KRITIS: override browser [hidden]{display:none} yang dikalahkan display:flex di atas */
.nb-dropdown[hidden] {
  display: none !important;
}

@keyframes nb-fade-in {
  from { opacity: 0; transform: translateY(-6px) scale(.98); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

/* Dropdown header */
.nb-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--color-border-tertiary, #f3f4f6);
  flex-shrink: 0;
}

.nb-dropdown-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.nb-read-all {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-info, #3b82f6);
  padding: 3px 8px;
  border-radius: 6px;
  transition: background 0.12s;
  line-height: 1.4;
}

.nb-read-all:hover {
  background: var(--color-background-info, #eff6ff);
}

/* Notification list */
.nb-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
  scroll-behavior: smooth;
}

.nb-list::-webkit-scrollbar { width: 4px; }
.nb-list::-webkit-scrollbar-track { background: transparent; }
.nb-list::-webkit-scrollbar-thumb { background: var(--color-border-secondary, #e5e7eb); border-radius: 2px; }

/* Notification item */
.nb-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.12s;
  border-left: 3px solid transparent;
  position: relative;
}

.nb-item:hover {
  background: var(--color-background-secondary, #f9fafb);
}

.nb-item.nb-item--unread {
  border-left-color: var(--color-border-info, #3b82f6);
  background: var(--color-background-info, #eff6ff);
}

.nb-item.nb-item--unread:hover {
  background: #dbeafe;
}

/* Icon bubble */
.nb-item-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-warning, #fef3c7);
  color: var(--color-text-warning, #d97706);
}

.nb-item-icon svg {
  width: 15px;
  height: 15px;
}

.nb-item-icon.nb-icon--absent_alert {
  background: var(--color-background-danger, #fee2e2);
  color: var(--color-text-danger, #dc2626);
}

.nb-item-icon.nb-icon--leave_review {
  background: var(--color-background-info, #eff6ff);
  color: var(--color-text-info, #3b82f6);
}

/* Text content */
.nb-item-body {
  flex: 1;
  min-width: 0;
}

.nb-item-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  margin: 0 0 2px;
  line-height: 1.4;
  white-space: normal;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.nb-item-text {
  font-size: 11.5px;
  color: var(--color-text-secondary, #6b7280);
  margin: 0 0 3px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nb-item-time {
  font-size: 10.5px;
  color: var(--color-text-tertiary, #9ca3af);
  margin: 0;
}

/* Empty / loading state */
.nb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 20px;
  font-size: 13px;
  color: var(--color-text-tertiary, #9ca3af);
  text-align: center;
}

.nb-empty svg {
  opacity: 0.35;
}

/* Mobile: full-width bottom sheet */
@media (max-width: 480px) {
  .nb-dropdown {
    position: fixed !important;
    left: 12px !important;
    right: 12px !important;
    width: auto !important;
    top: auto !important;
    bottom: calc(68px + env(safe-area-inset-bottom)) !important;
    max-height: 60vh;
    border-radius: 16px;
  }
}
    `;
    document.head.appendChild(style);
  }

  /* ─── Refs ────────────────────────────────────────────────────────────── */

  const bell = document.getElementById("nb-bell");
  const badge = document.getElementById("nb-badge");
  const dropdown = document.getElementById("nb-dropdown");
  const list = document.getElementById("nb-list");
  const readAll = document.getElementById("nb-read-all");

  let isOpen = false;
  let notifData = [];

  /* ─── Helpers ─────────────────────────────────────────────────────────── */

  function escHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content || "";
  }

  function iconSvg(type) {
    if (type === "absent_alert") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>`;
    }
    if (type === "leave_review") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="9 11 12 14 22 4"/>
            </svg>`;
  }

  /* ─── Badge ───────────────────────────────────────────────────────────── */

  function updateBadge(count) {
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.removeAttribute("hidden");
    } else {
      badge.setAttribute("hidden", "");
    }
  }

  /* ─── Render list ─────────────────────────────────────────────────────── */

  function renderList() {
    if (!notifData.length) {
      list.innerHTML = `
        <li class="nb-empty" role="listitem">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span>${T.empty}</span>
        </li>`;
      return;
    }

    list.innerHTML = notifData
      .map(
        (n) => `
      <li class="nb-item ${n.is_read ? "" : "nb-item--unread"}"
          data-id="${escHtml(n.id)}"
          data-read="${n.is_read}"
          role="listitem"
          tabindex="0"
          aria-label="${escHtml(n.title)}">
        <div class="nb-item-icon nb-icon--${escHtml(n.type || "default")}">
          ${iconSvg(n.type)}
        </div>
        <div class="nb-item-body">
          <p class="nb-item-title">${escHtml(n.title)}</p>
          ${n.body ? `<p class="nb-item-text">${escHtml(n.body)}</p>` : ""}
          <p class="nb-item-time">${escHtml(n.created_at)}</p>
        </div>
      </li>
    `,
      )
      .join("");

    list.querySelectorAll(".nb-item").forEach((item) => {
      const activate = () => {
        const id = item.dataset.id;
        const read = item.dataset.read === "true";
        if (!read) markRead(id, item);
      };
      item.addEventListener("click", activate);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") activate();
      });
    });
  }

  /* ─── Fetch ───────────────────────────────────────────────────────────── */

  function fetchNotifications() {
    fetch(`${BASE}/notifications`, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error("Network error");
        return r.json();
      })
      .then((data) => {
        notifData = data.notifications || [];
        updateBadge(data.unread || 0);
        if (isOpen) renderList();
      })
      .catch(() => {
        // Jika dropdown terbuka, tampilkan pesan error
        if (isOpen) {
          list.innerHTML = `
            <li class="nb-empty" role="listitem">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>${T.error}</span>
            </li>`;
        }
      });
  }

  /* ─── Mark read (single) ──────────────────────────────────────────────── */

  function markRead(id, el) {
    fetch(`${BASE}/notifications/${id}/read`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRFToken": csrf() },
    })
      .then((r) => {
        if (!r.ok) return;
        el.classList.remove("nb-item--unread");
        el.dataset.read = "true";
        const n = notifData.find((x) => x.id === id);
        if (n) n.is_read = true;
        updateBadge(notifData.filter((x) => !x.is_read).length);
      })
      .catch(() => {
        /* silent */
      });
  }

  /* ─── Mark all read ───────────────────────────────────────────────────── */

  readAll.addEventListener("click", () => {
    fetch(`${BASE}/notifications/read-all`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRFToken": csrf() },
    })
      .then((r) => {
        if (!r.ok) return;
        notifData.forEach((n) => (n.is_read = true));
        renderList();
        updateBadge(0);
      })
      .catch(() => {
        /* silent */
      });
  });

  /* ─── Toggle dropdown ─────────────────────────────────────────────────── */

  function positionDropdown() {
    // Hitung posisi bell button lalu tempatkan dropdown agar tidak terpotong
    const rect = bell.getBoundingClientRect();
    const dropW = 340;
    const margin = 8;

    // Sisi kanan bell
    let left = rect.right - dropW;
    // Jangan keluar layar kiri
    if (left < margin) left = margin;
    // Jangan keluar layar kanan
    if (left + dropW > window.innerWidth - margin)
      left = window.innerWidth - dropW - margin;

    const top = rect.bottom + margin;

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
    // Hapus right/bottom agar tidak konflik
    dropdown.style.right = "auto";
    dropdown.style.bottom = "auto";
  }

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen = !isOpen;

    if (isOpen) {
      dropdown.removeAttribute("hidden");
      bell.setAttribute("aria-expanded", "true");
      positionDropdown();
      renderList();
      fetchNotifications();

      // Fokus trap sederhana: fokus ke pertama item
      requestAnimationFrame(() => {
        const first = list.querySelector(".nb-item");
        if (first) first.focus();
      });
    } else {
      closeDropdown();
    }
  });

  function closeDropdown() {
    isOpen = false;
    dropdown.setAttribute("hidden", "");
    bell.setAttribute("aria-expanded", "false");
  }

  /* ─── Close on outside click ──────────────────────────────────────────── */

  document.addEventListener("click", (e) => {
    if (!document.getElementById("nb-container").contains(e.target)) {
      closeDropdown();
    }
  });

  /* ─── Close on Escape ─────────────────────────────────────────────────── */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      closeDropdown();
      bell.focus();
    }
  });

  /* ─── Reposition on resize ────────────────────────────────────────────── */

  window.addEventListener("resize", () => {
    if (isOpen) positionDropdown();
  });

  /* ─── Initial load & polling ──────────────────────────────────────────── */

  fetchNotifications();
  setInterval(fetchNotifications, POLL_INTERVAL);
})();
