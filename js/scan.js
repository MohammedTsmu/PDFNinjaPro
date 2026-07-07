// Scannify Tool — turn a clean digital PDF into a scanned-looking PDF.
// Each page is rasterised, given paper texture / skew / noise, then re-embedded
// as a JPEG image into a fresh PDF (image-only, like a real scan).
//
// A live "page 1" preview shares the exact render pipeline used for export, so
// what the user sees is what they get.

let scanFile = null;
let scanPdfDoc = null;
let scanPreviewPage = null;
let scanPreviewTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('scan-drop-zone');
    const fileInput = document.getElementById('scan-upload');
    const startBtn = document.getElementById('start-scan-btn');
    const resetBtn = document.getElementById('scan-reset-btn');
    const intensity = document.getElementById('scan-intensity');
    const intensityVal = document.getElementById('scan-intensity-val');

    if (intensity && intensityVal) {
        intensity.addEventListener('input', (e) => {
            intensityVal.textContent = intensityLabel(parseInt(e.target.value, 10));
            scheduleScanPreview();
        });
    }

    // Color mode radios -> refresh preview
    document.querySelectorAll('input[name="scan-color"]').forEach(r => {
        r.addEventListener('change', () => scheduleScanPreview());
    });

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleScanFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleScanFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetScanUI);
    if (startBtn) startBtn.addEventListener('click', startScannify);
});

function intensityLabel(v) {
    if (v <= 0) return 'None (clean)';
    if (v <= 30) return 'Light';
    if (v <= 60) return 'Medium';
    if (v <= 80) return 'Heavy';
    return 'Old photocopy';
}

async function handleScanFile(file) {
    scanFile = file;

    document.getElementById('scan-drop-zone').classList.add('hidden');
    document.getElementById('scan-file-info').classList.remove('hidden');
    document.getElementById('scan-settings').classList.remove('hidden');
    document.getElementById('start-scan-btn').classList.remove('hidden');

    document.getElementById('scan-filename').textContent = file.name;
    document.getElementById('scan-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loaded = await window.loadPdfProtected(arrayBuffer);
        if (!loaded) { resetScanUI(); return; } // password prompt cancelled
        scanPdfDoc = loaded.pdfDoc;
        scanPreviewPage = await scanPdfDoc.getPage(1);
        document.getElementById('scan-preview-wrap').classList.remove('hidden');
        renderScanPreview();
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetScanUI();
    }
}

function resetScanUI() {
    scanFile = null;
    scanPdfDoc = null;
    scanPreviewPage = null;

    document.getElementById('scan-drop-zone').classList.remove('hidden');
    document.getElementById('scan-file-info').classList.add('hidden');
    document.getElementById('scan-settings').classList.add('hidden');
    document.getElementById('scan-preview-wrap').classList.add('hidden');
    document.getElementById('start-scan-btn').classList.add('hidden');
    document.getElementById('scan-progress-container').classList.add('hidden');
    document.getElementById('scan-upload').value = '';
}

// ---- Shared render pipeline (used by both preview and export) ----

function currentScanSettings() {
    const grayscale = document.querySelector('input[name="scan-color"]:checked').value === 'gray';
    const t = parseInt(document.getElementById('scan-intensity').value, 10) / 100; // 0..1
    return {
        grayscale,
        t,
        rotationMax: t * 2.2,        // degrees of random skew
        noiseAmount: t * 32,         // +/- luminance jitter
        contrast: 1 + t * 0.22,      // contrast boost
        vignette: t * 0.22,          // scanner-edge darkening
        quality: Math.max(0.45, 0.82 - t * 0.22) // JPEG quality (lower = more "scanned")
    };
}

// Paper tint: cleaner near-white at low intensity, warmer/greyer as it rises.
function scanPaperColor(grayscale, t) {
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    if (grayscale) return `rgb(${lerp(249, 231)}, ${lerp(249, 229)}, ${lerp(247, 223)})`;
    return `rgb(${lerp(250, 241)}, ${lerp(249, 235)}, ${lerp(245, 226)})`;
}

// Apply grayscale / contrast / paper noise in place.
function applyScanEffects(imgData, opts) {
    const d = imgData.data;
    const c = opts.contrast;
    const intercept = 128 * (1 - c);
    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (opts.grayscale) {
            const v = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = v;
        }
        r = r * c + intercept;
        g = g * c + intercept;
        b = b * c + intercept;
        if (opts.noiseAmount > 0) {
            const n = (Math.random() - 0.5) * opts.noiseAmount;
            r += n; g += n; b += n;
        }
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
}

// Render one page with scan effects onto a canvas.
async function scannifyToCanvas(page, settings, scale) {
    const viewport = page.getViewport({ scale });

    const src = document.createElement('canvas');
    src.width = viewport.width;
    src.height = viewport.height;
    await page.render({ canvasContext: src.getContext('2d'), viewport }).promise;

    const out = document.createElement('canvas');
    out.width = viewport.width;
    out.height = viewport.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = scanPaperColor(settings.grayscale, settings.t);
    ctx.fillRect(0, 0, out.width, out.height);

    const angle = (Math.random() - 0.5) * 2 * settings.rotationMax * Math.PI / 180;
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(angle);
    const shrink = 0.975;
    ctx.drawImage(src, -out.width / 2 * shrink, -out.height / 2 * shrink,
        out.width * shrink, out.height * shrink);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, out.width, out.height);
    applyScanEffects(imgData, settings);
    ctx.putImageData(imgData, 0, 0);

    // Scanner-edge vignette (darker toward the borders).
    if (settings.vignette > 0) {
        const cx = out.width / 2, cy = out.height / 2;
        const g = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.55, cx, cy, Math.hypot(cx, cy));
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${settings.vignette})`);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.globalCompositeOperation = 'source-over';
    }

    return out;
}

// ---- Live preview ----

function scheduleScanPreview() {
    if (!scanPreviewPage) return;
    clearTimeout(scanPreviewTimer);
    scanPreviewTimer = setTimeout(renderScanPreview, 150);
}

async function renderScanPreview() {
    if (!scanPreviewPage) return;
    try {
        const settings = currentScanSettings();
        const canvas = await scannifyToCanvas(scanPreviewPage, settings, 1.1);
        const target = document.getElementById('scan-preview-canvas');
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext('2d').drawImage(canvas, 0, 0);
    } catch (e) {
        console.error('Scan preview error:', e);
    }
}

// ---- Export ----

async function startScannify() {
    if (!scanPdfDoc) return;

    const startBtn = document.getElementById('start-scan-btn');
    const progressContainer = document.getElementById('scan-progress-container');
    const progressFill = document.getElementById('scan-progress-fill');
    const currentSpan = document.getElementById('scan-current-page');
    const totalSpan = document.getElementById('scan-total-pages');

    const settings = currentScanSettings();

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
    progressContainer.classList.remove('hidden');
    if (window.showLoader) window.showLoader('Scannifying your PDF…');

    const total = scanPdfDoc.numPages;
    totalSpan.textContent = total;

    try {
        const outPdf = await PDFLib.PDFDocument.create();

        for (let i = 1; i <= total; i++) {
            currentSpan.textContent = i;
            progressFill.style.width = ((i / total) * 100) + '%';
            if (window.updateLoader) window.updateLoader('Scanning page ' + i + ' of ' + total + '…');

            const page = await scanPdfDoc.getPage(i);
            const pageDims = page.getViewport({ scale: 1 }); // PDF points for output page size
            const canvas = await scannifyToCanvas(page, settings, 2.0);

            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', settings.quality));
            const jpgBytes = new Uint8Array(await blob.arrayBuffer());
            const jpg = await outPdf.embedJpg(jpgBytes);
            const newPage = outPdf.addPage([pageDims.width, pageDims.height]);
            newPage.drawImage(jpg, { x: 0, y: 0, width: pageDims.width, height: pageDims.height });

            page.cleanup();
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 10));
        }

        startBtn.innerHTML = '<i class="fas fa-file-archive"></i> Saving...';
        const pdfBytes = await outPdf.save();
        if (window.hideLoader) window.hideLoader();

        const outBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        saveAs(outBlob, scanFile.name.replace(/\.pdf$/i, '') + '_scanned.pdf');

        if (window.showToast) window.showToast('Scanned PDF ready — ' + total + ' page(s).', 'success');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';

        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-print"></i> Scan Again';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
            progressContainer.classList.add('hidden');
        }, 3000);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error creating scanned PDF: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-print"></i> Try Again';
    }
}
