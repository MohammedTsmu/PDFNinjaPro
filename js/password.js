// Protect Tool — password-protect (encrypt) a PDF, fully client-side.
//
// pdf-lib (used everywhere else in the app) cannot encrypt, so we lazy-load
// @cantoo/pdf-lib — a pure-JS pdf-lib fork with AES encryption — only when the
// user actually protects a file. It is captured into its own reference so the
// app's main window.PDFLib is left untouched. Works on static hosting
// (GitHub Pages): no WASM, no special headers.

let passwordFile = null;
let cantooLib = null;

// Lazy-load @cantoo/pdf-lib from CDN, isolated from window.PDFLib.
async function getCantoo() {
    if (cantooLib) return cantooLib;
    const orig = window.PDFLib;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib/dist/pdf-lib.min.js';
        s.onload = res;
        s.onerror = () => rej(new Error('Failed to load the encryption library (check your connection).'));
        document.head.appendChild(s);
    });
    cantooLib = window.PDFLib;
    window.PDFLib = orig; // restore the app's original pdf-lib
    return cantooLib;
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('password-drop-zone');
    const fileInput = document.getElementById('password-upload');
    const startBtn = document.getElementById('start-password-btn');
    const resetBtn = document.getElementById('password-reset-btn');
    const pw = document.getElementById('password-input');
    const confirm = document.getElementById('password-confirm');
    const show = document.getElementById('password-show');

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, preventDefaults, false);
        });
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        ['dragenter', 'dragover'].forEach(evt => {
            dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'), false);
        });
        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handlePasswordFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handlePasswordFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetPasswordUI);
    if (startBtn) startBtn.addEventListener('click', startProtect);

    if (pw) pw.addEventListener('input', validatePassword);
    if (confirm) confirm.addEventListener('input', validatePassword);
    if (show) {
        show.addEventListener('change', () => {
            const t = show.checked ? 'text' : 'password';
            pw.type = t;
            confirm.type = t;
        });
    }
});

function handlePasswordFile(file) {
    passwordFile = file;

    document.getElementById('password-drop-zone').classList.add('hidden');
    document.getElementById('password-file-info').classList.remove('hidden');
    document.getElementById('password-settings').classList.remove('hidden');
    document.getElementById('start-password-btn').classList.remove('hidden');

    document.getElementById('password-filename').textContent = file.name;
    document.getElementById('password-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    validatePassword();
}

function resetPasswordUI() {
    passwordFile = null;
    document.getElementById('password-drop-zone').classList.remove('hidden');
    document.getElementById('password-file-info').classList.add('hidden');
    document.getElementById('password-settings').classList.add('hidden');
    document.getElementById('start-password-btn').classList.add('hidden');
    document.getElementById('password-upload').value = '';
    document.getElementById('password-input').value = '';
    document.getElementById('password-confirm').value = '';
    document.getElementById('password-msg').textContent = '';
}

// Returns the password if valid, else null (and shows a message).
function validatePassword() {
    const pw = document.getElementById('password-input').value;
    const confirm = document.getElementById('password-confirm').value;
    const msg = document.getElementById('password-msg');

    if (!pw) { msg.className = 'text-muted'; msg.textContent = 'Enter a password to protect the PDF.'; return null; }
    if (pw.length < 4) { msg.className = 'text-danger'; msg.textContent = 'Password should be at least 4 characters.'; return null; }
    if (confirm && pw !== confirm) { msg.className = 'text-danger'; msg.textContent = 'Passwords do not match.'; return null; }
    if (!confirm) { msg.className = 'text-muted'; msg.textContent = 'Re-enter the password to confirm.'; return null; }
    msg.className = 'text-muted';
    msg.style.color = 'var(--secondary-color)';
    msg.textContent = '✓ Passwords match — ready to protect.';
    return pw;
}

async function startProtect() {
    if (!passwordFile) return;
    const password = validatePassword();
    if (!password) {
        if (window.showToast) window.showToast('Please enter and confirm a valid password.', 'error');
        return;
    }

    const startBtn = document.getElementById('start-password-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Protecting...';
    if (window.showLoader) window.showLoader('Encrypting your PDF…');

    try {
        const Cantoo = await getCantoo();
        const bytes = new Uint8Array(await passwordFile.arrayBuffer());

        let doc;
        try {
            doc = await Cantoo.PDFDocument.load(bytes);
        } catch (loadErr) {
            throw new Error('Could not read this PDF (it may already be password-protected).');
        }

        await doc.encrypt({
            userPassword: password,
            ownerPassword: password,
            permissions: { printing: 'highResolution' }
        });
        const outBytes = await doc.save();

        if (window.hideLoader) window.hideLoader();
        saveAs(new Blob([outBytes], { type: 'application/pdf' }),
            passwordFile.name.replace(/\.pdf$/i, '') + '_protected.pdf');

        if (window.showToast) window.showToast('Protected PDF saved — it now requires the password to open.', 'success');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';
        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-lock"></i> Protect PDF';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
        }, 2500);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-lock"></i> Try Again';
    }
}
