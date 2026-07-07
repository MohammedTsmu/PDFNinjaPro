// Shared UI helpers: toasts, blocking loader, and global drag-drop routing.
// Loaded FIRST so every other module can rely on window.showToast / showLoader.
(function () {
    'use strict';

    /* ---------- Inject styles ---------- */
    const style = document.createElement('style');
    style.textContent = `
    #toast-stack {
        position: fixed; top: 20px; right: 20px; z-index: 100000;
        display: flex; flex-direction: column; gap: 10px;
        max-width: min(360px, calc(100vw - 40px)); pointer-events: none;
    }
    .toast {
        pointer-events: auto; display: flex; align-items: flex-start; gap: 10px;
        padding: 14px 16px; border-radius: 12px; color: #f8fafc;
        background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(255,255,255,0.12);
        box-shadow: 0 8px 32px rgba(0,0,0,0.45); backdrop-filter: blur(10px);
        font-size: 0.9rem; line-height: 1.4;
        transform: translateX(120%); opacity: 0;
        transition: transform .35s cubic-bezier(.4,0,.2,1), opacity .35s;
    }
    .toast.show { transform: translateX(0); opacity: 1; }
    .toast .toast-icon { font-size: 1.1rem; margin-top: 1px; flex-shrink: 0; }
    .toast .toast-msg { flex: 1; word-break: break-word; }
    .toast .toast-close {
        background: none; border: none; color: rgba(255,255,255,0.5);
        cursor: pointer; font-size: 1rem; padding: 0; line-height: 1;
    }
    .toast .toast-close:hover { color: #fff; }
    .toast.toast-error   { border-left: 4px solid #f43f5e; }
    .toast.toast-success { border-left: 4px solid #10b981; }
    .toast.toast-info    { border-left: 4px solid #3b82f6; }
    .toast.toast-error   .toast-icon { color: #f43f5e; }
    .toast.toast-success .toast-icon { color: #10b981; }
    .toast.toast-info    .toast-icon { color: #60a5fa; }

    #loader-bar {
        width: 220px; max-width: 60vw; height: 6px; border-radius: 3px;
        background: rgba(255,255,255,0.12); overflow: hidden; margin-top: 16px;
    }
    #loader-bar > span {
        display: block; height: 100%; width: 40%; border-radius: 3px;
        background: var(--primary-color, #3b82f6);
        animation: loaderSlide 1.1s ease-in-out infinite;
    }
    @keyframes loaderSlide {
        0%   { transform: translateX(-120%); }
        100% { transform: translateX(320%); }
    }

    #global-drop-overlay {
        position: fixed; inset: 0; z-index: 99000; display: none;
        align-items: center; justify-content: center;
        background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(6px);
        border: 3px dashed var(--primary-color, #3b82f6); border-radius: 0;
        pointer-events: none;
    }
    #global-drop-overlay.active { display: flex; }
    #global-drop-overlay .drop-hint {
        text-align: center; color: #f8fafc; font-size: 1.4rem; font-weight: 600;
    }
    #global-drop-overlay .drop-hint i { font-size: 3rem; display: block; margin-bottom: 12px; color: var(--primary-color, #3b82f6); }

    .shared-doc-banner {
        display: flex; align-items: center; gap: 10px;
        margin: 0 0 16px; padding: 10px 14px; border-radius: 12px;
        background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.4);
        color: #e2e8f0; font-size: 0.9rem; animation: sdbIn .3s ease;
    }
    @keyframes sdbIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    .shared-doc-banner > i { color: var(--primary-color, #3b82f6); font-size: 1.1rem; }
    .shared-doc-banner span { flex: 1; word-break: break-word; }
    .shared-doc-banner .sdb-use {
        background: var(--primary-color, #3b82f6); color: #fff; border: none;
        padding: 6px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; white-space: nowrap;
    }
    .shared-doc-banner .sdb-use:hover { filter: brightness(1.1); }
    .shared-doc-banner .sdb-dismiss {
        background: none; border: none; color: rgba(255,255,255,0.6);
        font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 0 2px;
    }
    .shared-doc-banner .sdb-dismiss:hover { color: #fff; }
    `;
    document.head.appendChild(style);

    /* ---------- Toasts ---------- */
    function getStack() {
        let stack = document.getElementById('toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toast-stack';
            document.body.appendChild(stack);
        }
        return stack;
    }

    const ICONS = {
        error: 'fa-circle-exclamation',
        success: 'fa-circle-check',
        info: 'fa-circle-info'
    };

    function showToast(message, type = 'info', duration = 4500) {
        const stack = getStack();
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.innerHTML =
            '<i class="toast-icon fas ' + (ICONS[type] || ICONS.info) + '"></i>' +
            '<span class="toast-msg"></span>' +
            '<button class="toast-close" aria-label="Dismiss">&times;</button>';
        toast.querySelector('.toast-msg').textContent = message;
        stack.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        let timer;
        const dismiss = () => {
            clearTimeout(timer);
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        };
        toast.querySelector('.toast-close').addEventListener('click', dismiss);
        if (duration > 0) timer = setTimeout(dismiss, duration);
        return dismiss;
    }
    window.showToast = showToast;

    // Route every legacy alert() through the toast system, auto-classifying by text.
    window.alert = function (msg) {
        const text = String(msg);
        let type = 'info';
        if (/error|invalid|failed|fail\b/i.test(text)) type = 'error';
        else if (/success|done|complete|saved/i.test(text)) type = 'success';
        showToast(text, type);
    };

    /* ---------- Blocking loader (reuses #spinner) ---------- */
    function loaderEl() { return document.getElementById('spinner'); }

    function showLoader(message) {
        const el = loaderEl();
        if (!el) return;
        el.innerHTML =
            '<div class="spinner"></div>' +
            '<p style="margin-top:14px; color:#fff; font-weight:500;">' +
            (message || 'Working…') + '</p>' +
            '<div id="loader-bar"><span></span></div>';
        el.classList.remove('hidden');
    }
    function updateLoader(message) {
        const p = document.querySelector('#spinner p');
        if (p && message) p.textContent = message;
    }
    function hideLoader() {
        const el = loaderEl();
        if (el) el.classList.add('hidden');
    }
    window.showLoader = showLoader;
    window.updateLoader = updateLoader;
    window.hideLoader = hideLoader;

    /* ---------- Global drag-drop routing ---------- */
    // Drop a file anywhere and it is routed to the currently-active tool's file input.
    document.addEventListener('DOMContentLoaded', function () {
        const overlay = document.createElement('div');
        overlay.id = 'global-drop-overlay';
        overlay.innerHTML =
            '<div class="drop-hint"><i class="fas fa-cloud-arrow-up"></i>Drop your file to load it here</div>';
        document.body.appendChild(overlay);

        let dragDepth = 0;
        const hasFiles = (e) => e.dataTransfer &&
            Array.from(e.dataTransfer.types || []).includes('Files');

        window.addEventListener('dragenter', function (e) {
            if (!hasFiles(e)) return;
            dragDepth++;
            // Let dedicated upload zones show their own affordance.
            if (e.target.closest && e.target.closest('.upload-zone')) return;
            overlay.classList.add('active');
        });
        window.addEventListener('dragover', function (e) {
            if (hasFiles(e)) e.preventDefault();
        });
        window.addEventListener('dragleave', function (e) {
            if (!hasFiles(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) overlay.classList.remove('active');
        });
        window.addEventListener('drop', function (e) {
            dragDepth = 0;
            overlay.classList.remove('active');
            if (!hasFiles(e)) return;
            // If dropped on a real upload zone, that zone handles it.
            if (e.target.closest && e.target.closest('.upload-zone')) return;

            e.preventDefault();
            const files = e.dataTransfer.files;
            if (!files || !files.length) return;

            const panel = document.querySelector('.tool-panel.active:not(.hidden)') ||
                document.querySelector('.tool-panel:not(.hidden)');
            const input = panel && panel.querySelector('input[type="file"]');
            if (!input) {
                showToast('Open a tool first, then drop your file.', 'info');
                return;
            }
            try {
                const dt = new DataTransfer();
                for (const f of files) dt.items.add(f);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (err) {
                showToast('Could not load the dropped file. Try the upload area.', 'error');
            }
        });

        /* ----- Shared document: "load once, carry across tools" ----- */
        // Remember the most recent PDF loaded through any tool's file input.
        document.addEventListener('change', function (e) {
            const t = e.target;
            if (t && t.matches && t.matches('input[type="file"]')) {
                const f = t.files && t.files[0];
                if (f && f.type === 'application/pdf') window.__lastPdf = f;
            }
        }, true);

        // Tools that operate on a single PDF -> their file-info card id.
        const SINGLE_DOC_TOOLS = {
            split: 'file-status-card',
            convert: 'convert-file-info',
            comment: 'comment-file-info',
            extract: 'extract-file-info',
            rotate: 'rotate-file-info',
            reorder: 'reorder-file-info',
            background: 'background-file-info',
            scan: 'scan-file-info',
            markdown: 'markdown-file-info',
            compress: 'compress-file-info',
            ocr: 'ocr-file-info',
            password: 'password-file-info',
            pagenum: 'pagenum-file-info'
        };

        function toolHasFile(targetId, panel) {
            const input = panel.querySelector('input[type="file"]');
            if (input && input.files && input.files.length) return true;
            const cardId = SINGLE_DOC_TOOLS[targetId];
            const card = cardId && document.getElementById(cardId);
            if (card && !card.classList.contains('hidden')) return true;
            return false;
        }

        function offerSharedDoc(targetId, label) {
            const panel = document.getElementById(targetId);
            if (!panel) return;
            const existing = panel.querySelector('.shared-doc-banner');
            if (existing) existing.remove();

            if (!(targetId in SINGLE_DOC_TOOLS)) return;
            const f = window.__lastPdf;
            if (!f) return;
            if (toolHasFile(targetId, panel)) return;

            const input = panel.querySelector('input[type="file"][accept*="pdf"]') ||
                panel.querySelector('input[type="file"]');
            if (!input) return;

            const banner = document.createElement('div');
            banner.className = 'shared-doc-banner';
            banner.innerHTML =
                '<i class="fas fa-file-pdf"></i>' +
                '<span>Continue with <strong></strong>?</span>' +
                '<button class="sdb-use">Use file</button>' +
                '<button class="sdb-dismiss" aria-label="Dismiss">&times;</button>';
            banner.querySelector('strong').textContent = f.name;

            const header = panel.querySelector('.tool-header');
            if (header) header.insertAdjacentElement('afterend', banner);
            else panel.insertBefore(banner, panel.firstChild);

            banner.querySelector('.sdb-use').addEventListener('click', function () {
                try {
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    showToast('Loaded "' + f.name + '" into ' + (label || targetId) + '.', 'success');
                } catch (err) {
                    showToast('Could not carry the file over — please upload it.', 'error');
                }
                banner.remove();
            });
            banner.querySelector('.sdb-dismiss').addEventListener('click', function () {
                banner.remove();
            });
        }

        // Offer the carried document when switching into an empty tool.
        document.querySelectorAll('.nav-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const targetId = btn.getAttribute('data-target');
                const label = (btn.querySelector('span') || {}).textContent || targetId;
                // Run after the app's own tab-switch handler has revealed the panel.
                setTimeout(function () { offerSharedDoc(targetId, label); }, 0);
            });
        });
    });
})();
