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

    /* ---------- Password prompt modal ---------- */
    #pdf-pw-overlay {
        position: fixed; inset: 0; z-index: 100001; display: none;
        align-items: center; justify-content: center;
        background: rgba(2, 6, 23, 0.72); backdrop-filter: blur(6px);
    }
    #pdf-pw-overlay.active { display: flex; }
    .pdf-pw-card {
        width: min(400px, calc(100vw - 40px)); box-sizing: border-box;
        background: #0f172a; color: #f8fafc;
        border: 1px solid rgba(255,255,255,0.12); border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.55); padding: 24px;
        animation: pwIn .25s ease;
    }
    @keyframes pwIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
    .pdf-pw-card .pdf-pw-icon {
        width: 48px; height: 48px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(59,130,246,0.15); color: var(--primary-color, #3b82f6);
        font-size: 1.4rem; margin-bottom: 14px;
    }
    .pdf-pw-card h3 { margin: 0 0 6px; font-size: 1.1rem; font-weight: 700; }
    .pdf-pw-card p { margin: 0 0 16px; font-size: 0.9rem; color: #cbd5e1; line-height: 1.4; }
    .pdf-pw-input-wrap { position: relative; margin-bottom: 8px; }
    .pdf-pw-card input {
        width: 100%; box-sizing: border-box; padding: 12px 42px 12px 14px;
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.06); color: #f8fafc; font-size: 0.95rem;
    }
    .pdf-pw-card input:focus { outline: none; border-color: var(--primary-color, #3b82f6); }
    .pdf-pw-toggle {
        position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        background: none; border: none; color: rgba(255,255,255,0.55);
        cursor: pointer; padding: 6px; font-size: 0.95rem;
    }
    .pdf-pw-toggle:hover { color: #fff; }
    .pdf-pw-error { min-height: 18px; font-size: 0.8rem; color: #f43f5e; margin-bottom: 12px; }
    .pdf-pw-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .pdf-pw-actions button {
        padding: 10px 16px; border-radius: 10px; font-weight: 600; cursor: pointer;
        border: 1px solid transparent; font-size: 0.9rem;
    }
    .pdf-pw-cancel { background: rgba(255,255,255,0.08); color: #e2e8f0; }
    .pdf-pw-cancel:hover { background: rgba(255,255,255,0.15); }
    .pdf-pw-unlock { background: var(--primary-color, #3b82f6); color: #fff; }
    .pdf-pw-unlock:hover { filter: brightness(1.1); }
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

    /* ---------- @cantoo/pdf-lib loader (decrypts; app's pdf-lib cannot) ---------- */
    // Loaded on demand and captured into its own reference so window.PDFLib — the
    // app's stock pdf-lib — is left untouched. Shared with js/password.js.
    let _cantooLib = null;
    function getCantoo() {
        if (_cantooLib) return Promise.resolve(_cantooLib);
        const orig = window.PDFLib;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib/dist/pdf-lib.min.js';
            s.onload = () => {
                _cantooLib = window.PDFLib;
                window.PDFLib = orig; // restore the app's original pdf-lib
                resolve(_cantooLib);
            };
            s.onerror = () => {
                window.PDFLib = orig;
                reject(new Error('Failed to load the decryption library (check your connection).'));
            };
            document.head.appendChild(s);
        });
    }
    window.getCantoo = getCantoo;

    /* ---------- Password prompt modal ---------- */
    // Resolves to the entered password, or null if the user cancels.
    function promptPdfPassword(message, isRetry) {
        return new Promise((resolve) => {
            let overlay = document.getElementById('pdf-pw-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'pdf-pw-overlay';
                overlay.innerHTML =
                    '<div class="pdf-pw-card" role="dialog" aria-modal="true" aria-label="Password required">' +
                    '<div class="pdf-pw-icon"><i class="fas fa-lock"></i></div>' +
                    '<h3>Password required</h3>' +
                    '<p class="pdf-pw-msg"></p>' +
                    '<div class="pdf-pw-input-wrap">' +
                    '<input type="password" class="pdf-pw-field" autocomplete="off" placeholder="Enter password" />' +
                    '<button class="pdf-pw-toggle" type="button" aria-label="Show password"><i class="fas fa-eye"></i></button>' +
                    '</div>' +
                    '<div class="pdf-pw-error" role="alert"></div>' +
                    '<div class="pdf-pw-actions">' +
                    '<button class="pdf-pw-cancel" type="button">Cancel</button>' +
                    '<button class="pdf-pw-unlock" type="button">Unlock</button>' +
                    '</div></div>';
                document.body.appendChild(overlay);
            }

            const field = overlay.querySelector('.pdf-pw-field');
            const errEl = overlay.querySelector('.pdf-pw-error');
            const toggle = overlay.querySelector('.pdf-pw-toggle');
            const cancelBtn = overlay.querySelector('.pdf-pw-cancel');
            const unlockBtn = overlay.querySelector('.pdf-pw-unlock');

            overlay.querySelector('.pdf-pw-msg').textContent = message ||
                'This PDF is password-protected. Enter its password to open it.';
            errEl.textContent = isRetry ? 'Incorrect password — please try again.' : '';
            field.value = '';
            field.type = 'password';
            toggle.innerHTML = '<i class="fas fa-eye"></i>';

            overlay.classList.add('active');
            setTimeout(() => field.focus(), 30);

            function cleanup() {
                overlay.classList.remove('active');
                toggle.removeEventListener('click', onToggle);
                cancelBtn.removeEventListener('click', onCancel);
                unlockBtn.removeEventListener('click', onUnlock);
                field.removeEventListener('keydown', onKey);
                overlay.removeEventListener('mousedown', onBackdrop);
            }
            function onToggle() {
                const hidden = field.type === 'password';
                field.type = hidden ? 'text' : 'password';
                toggle.innerHTML = hidden ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
                field.focus();
            }
            function onCancel() { cleanup(); resolve(null); }
            function onUnlock() {
                const val = field.value;
                if (!val) { errEl.textContent = 'Please enter a password.'; field.focus(); return; }
                cleanup(); resolve(val);
            }
            function onKey(e) {
                if (e.key === 'Enter') { e.preventDefault(); onUnlock(); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }
            function onBackdrop(e) { if (e.target === overlay) onCancel(); }

            toggle.addEventListener('click', onToggle);
            cancelBtn.addEventListener('click', onCancel);
            unlockBtn.addEventListener('click', onUnlock);
            field.addEventListener('keydown', onKey);
            overlay.addEventListener('mousedown', onBackdrop);
        });
    }
    window.promptPdfPassword = promptPdfPassword;

    /* ---------- Unified protected-PDF loader ----------
       Opens a PDF with pdf.js, prompting for a password when the file is
       encrypted (looping until correct or cancelled). Returns:
         { pdfDoc, password, bytes }
       where `bytes` are DECRYPTED bytes safe to hand to pdf-lib for saving
       (pdf-lib cannot decrypt, so encrypted input is re-saved via
       @cantoo/pdf-lib). Non-encrypted input passes straight through. Returns
       null if the user cancels the prompt; throws for genuinely invalid files. */
    async function loadPdfProtected(input, extraParams) {
        // Keep a pristine master copy; pdf.js may detach whatever buffer we pass it.
        const master = input instanceof Uint8Array ? input.slice() : new Uint8Array(input).slice();
        const PwR = (window.pdfjsLib && pdfjsLib.PasswordResponses) ||
            { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };

        let password = null;
        let attempted = false;
        let pdfDoc = null;

        while (true) {
            const params = Object.assign({ data: master.slice() }, extraParams || {});
            if (password != null) params.password = password;
            try {
                pdfDoc = await pdfjsLib.getDocument(params).promise;
                break;
            } catch (err) {
                const isPw = err && (err.name === 'PasswordException' ||
                    err.code === PwR.NEED_PASSWORD || err.code === PwR.INCORRECT_PASSWORD);
                if (!isPw) throw err; // genuinely corrupt/invalid file
                password = await promptPdfPassword(
                    attempted ? 'That password was incorrect. Please try again.'
                        : 'This PDF is password-protected. Enter its password to open it.',
                    attempted);
                attempted = true;
                if (password == null) return null; // user cancelled
            }
        }

        let bytes = master;
        if (password != null) {
            // pdf-lib can't decrypt — re-save via @cantoo/pdf-lib to get plaintext bytes.
            const Cantoo = await getCantoo();
            const dec = await Cantoo.PDFDocument.load(master.slice(), { password });
            bytes = await dec.save();
        }
        return { pdfDoc, password, bytes };
    }
    window.loadPdfProtected = loadPdfProtected;

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
            delete: 'delete-file-info',
            scan: 'scan-file-info',
            markdown: 'markdown-file-info',
            compress: 'compress-file-info',
            ocr: 'ocr-file-info',
            password: 'password-file-info',
            unlock: 'unlock-file-info',
            watermark: 'watermark-file-info',
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
