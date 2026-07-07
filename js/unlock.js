// Unlock Tool — remove the password from a protected PDF, fully client-side.
//
// Mirrors the Protect tool (js/password.js) but decrypts instead of encrypts.
// pdf-lib (used everywhere else in the app) cannot open encrypted PDFs, so we
// lazy-load @cantoo/pdf-lib — a pure-JS pdf-lib fork with AES support — only
// when the user actually unlocks a file. It is captured into its own reference
// so the app's main window.PDFLib is left untouched. Works on static hosting
// (GitHub Pages): no WASM, no special headers.

let unlockFile = null;
let unlockCantooLib = null;

// Lazy-load @cantoo/pdf-lib from CDN, isolated from window.PDFLib.
async function getUnlockCantoo() {
    if (unlockCantooLib) return unlockCantooLib;
    const orig = window.PDFLib;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib/dist/pdf-lib.min.js';
        s.onload = res;
        s.onerror = () => rej(new Error('Failed to load the decryption library (check your connection).'));
        document.head.appendChild(s);
    });
    unlockCantooLib = window.PDFLib;
    window.PDFLib = orig; // restore the app's original pdf-lib
    return unlockCantooLib;
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('unlock-drop-zone');
    const fileInput = document.getElementById('unlock-upload');
    const startBtn = document.getElementById('start-unlock-btn');
    const resetBtn = document.getElementById('unlock-reset-btn');
    const pw = document.getElementById('unlock-input');
    const show = document.getElementById('unlock-show');

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleUnlockFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleUnlockFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetUnlockUI);
    if (startBtn) startBtn.addEventListener('click', startUnlock);

    if (pw) pw.addEventListener('input', validateUnlock);
    if (show) {
        show.addEventListener('change', () => {
            pw.type = show.checked ? 'text' : 'password';
        });
    }
});

function handleUnlockFile(file) {
    unlockFile = file;

    document.getElementById('unlock-drop-zone').classList.add('hidden');
    document.getElementById('unlock-file-info').classList.remove('hidden');
    document.getElementById('unlock-settings').classList.remove('hidden');
    document.getElementById('start-unlock-btn').classList.remove('hidden');

    document.getElementById('unlock-filename').textContent = file.name;
    document.getElementById('unlock-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    validateUnlock();
}

function resetUnlockUI() {
    unlockFile = null;
    document.getElementById('unlock-drop-zone').classList.remove('hidden');
    document.getElementById('unlock-file-info').classList.add('hidden');
    document.getElementById('unlock-settings').classList.add('hidden');
    document.getElementById('start-unlock-btn').classList.add('hidden');
    document.getElementById('unlock-upload').value = '';
    document.getElementById('unlock-input').value = '';
    document.getElementById('unlock-msg').textContent = '';
}

// Returns the password if present, else null (and shows a hint).
function validateUnlock() {
    const pw = document.getElementById('unlock-input').value;
    const msg = document.getElementById('unlock-msg');

    if (!pw) { msg.className = 'text-muted'; msg.style.color = ''; msg.textContent = 'Enter the current password to unlock the PDF.'; return null; }
    msg.className = 'text-muted';
    msg.style.color = 'var(--secondary-color)';
    msg.textContent = '✓ Ready to unlock.';
    return pw;
}

async function startUnlock() {
    if (!unlockFile) return;
    const password = validateUnlock();
    if (!password) {
        if (window.showToast) window.showToast('Please enter the PDF password.', 'error');
        return;
    }

    const startBtn = document.getElementById('start-unlock-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Unlocking...';
    if (window.showLoader) window.showLoader('Decrypting your PDF…');

    try {
        const Cantoo = await getUnlockCantoo();
        const bytes = new Uint8Array(await unlockFile.arrayBuffer());

        let doc;
        try {
            doc = await Cantoo.PDFDocument.load(bytes, { password });
        } catch (loadErr) {
            // Wrong password (or a genuinely unreadable file) lands here.
            if (window.hideLoader) window.hideLoader();
            console.error(loadErr);
            if (window.showToast) window.showToast('Incorrect password — please try again.', 'error');
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-lock-open"></i> Try Again';
            return;
        }

        // Save WITHOUT calling encrypt → a decrypted PDF.
        const outBytes = await doc.save();

        if (window.hideLoader) window.hideLoader();
        saveAs(new Blob([outBytes], { type: 'application/pdf' }),
            unlockFile.name.replace(/\.pdf$/i, '') + '_unlocked.pdf');

        if (window.showToast) window.showToast('Unlocked PDF saved — it no longer needs a password to open.', 'success');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';
        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock PDF';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
        }, 2500);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-lock-open"></i> Try Again';
    }
}
