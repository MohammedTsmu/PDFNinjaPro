// Compress Tool — shrink a PDF by re-encoding each page as a JPEG at a chosen
// resolution/quality, then rebuilding the PDF from those images. This reliably
// reduces size for scanned / image-heavy PDFs (the ones that are actually big).
// Trade-off: text becomes part of the image (not selectable) — stated in the UI.
//
// A live size estimate (shared render of page 1) lets the user see the savings
// before committing.

let compressFile = null;
let compressPdfDoc = null;
let compressOriginalSize = 0;
let compressPreviewCanvas = null; // page 1 rendered once at PREVIEW_SCALE, reused for estimates

const COMPRESS_PREVIEW_SCALE = 2.0;

// Compression levels -> render scale (relative to PDF points) + JPEG quality.
const COMPRESS_LEVELS = {
    low: { scale: 2.0, quality: 0.82 },   // Light — closest to original
    medium: { scale: 1.5, quality: 0.68 },// Balanced
    high: { scale: 1.1, quality: 0.55 }   // Maximum — smallest
};

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('compress-drop-zone');
    const fileInput = document.getElementById('compress-upload');
    const startBtn = document.getElementById('start-compress-btn');
    const resetBtn = document.getElementById('compress-reset-btn');

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleCompressFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleCompressFile(e.target.files[0]);
        });
    }

    document.querySelectorAll('input[name="compress-level"]').forEach(r => {
        r.addEventListener('change', updateCompressEstimate);
    });

    if (resetBtn) resetBtn.addEventListener('click', resetCompressUI);
    if (startBtn) startBtn.addEventListener('click', startCompress);
});

async function handleCompressFile(file) {
    compressFile = file;
    compressOriginalSize = file.size;

    document.getElementById('compress-drop-zone').classList.add('hidden');
    document.getElementById('compress-file-info').classList.remove('hidden');
    document.getElementById('compress-settings').classList.remove('hidden');
    document.getElementById('start-compress-btn').classList.remove('hidden');

    document.getElementById('compress-filename').textContent = file.name;
    document.getElementById('compress-filesize').textContent = fmtSize(file.size);

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loaded = await window.loadPdfProtected(arrayBuffer);
        if (!loaded) { resetCompressUI(); return; } // password prompt cancelled
        compressPdfDoc = loaded.pdfDoc;

        // Render page 1 ONCE. Estimates downscale this cached canvas rather than
        // re-rendering the PDF page (avoids concurrent pdf.js renders on rapid
        // level changes, which can deadlock the worker).
        const page = await compressPdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: COMPRESS_PREVIEW_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        compressPreviewCanvas = canvas;
        updateCompressEstimate();
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetCompressUI();
    }
}

function resetCompressUI() {
    compressFile = null;
    compressPdfDoc = null;
    compressPreviewCanvas = null;
    compressOriginalSize = 0;

    document.getElementById('compress-drop-zone').classList.remove('hidden');
    document.getElementById('compress-file-info').classList.add('hidden');
    document.getElementById('compress-settings').classList.add('hidden');
    document.getElementById('start-compress-btn').classList.add('hidden');
    document.getElementById('compress-progress-container').classList.add('hidden');
    document.getElementById('compress-upload').value = '';
    const est = document.getElementById('compress-estimate');
    if (est) est.textContent = '';
}

function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
}

function currentCompressLevel() {
    const val = document.querySelector('input[name="compress-level"]:checked').value;
    return COMPRESS_LEVELS[val] || COMPRESS_LEVELS.medium;
}

// Render a page to a JPEG blob at the given scale/quality.
async function pageToJpegBlob(page, scale, quality) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}

// Estimate a page's compressed size by downscaling the cached page-1 render
// to the level's scale and re-encoding — no PDF re-render needed.
async function estimateBlobFromCache(level) {
    const base = compressPreviewCanvas;
    const ratio = level.scale / COMPRESS_PREVIEW_SCALE;
    const w = Math.max(1, Math.round(base.width * ratio));
    const h = Math.max(1, Math.round(base.height * ratio));
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d').drawImage(base, 0, 0, w, h);
    return new Promise(r => tmp.toBlob(r, 'image/jpeg', level.quality));
}

async function updateCompressEstimate() {
    const est = document.getElementById('compress-estimate');
    if (!est || !compressPreviewCanvas || !compressPdfDoc) return;
    try {
        const level = currentCompressLevel();
        const blob = await estimateBlobFromCache(level);
        // ~1KB PDF overhead per page for the image wrapper.
        const estTotal = (blob.size + 1024) * compressPdfDoc.numPages;
        const pct = Math.round((1 - estTotal / compressOriginalSize) * 100);

        if (estTotal >= compressOriginalSize) {
            est.innerHTML = '<i class="fas fa-circle-info"></i> This PDF is already compact — ' +
                'compressing may not shrink it (est. ~' + fmtSize(estTotal) + ').';
        } else {
            est.innerHTML = '<i class="fas fa-database"></i> ' + fmtSize(compressOriginalSize) +
                ' &rarr; ~' + fmtSize(estTotal) + ' &nbsp;<strong style="color:var(--secondary-color)">(-' +
                pct + '%)</strong>';
        }
    } catch (e) {
        console.error('Compress estimate error:', e);
    }
}

async function startCompress() {
    if (!compressPdfDoc) return;

    const startBtn = document.getElementById('start-compress-btn');
    const progressContainer = document.getElementById('compress-progress-container');
    const progressFill = document.getElementById('compress-progress-fill');
    const currentSpan = document.getElementById('compress-current-page');
    const totalSpan = document.getElementById('compress-total-pages');

    const { scale, quality } = currentCompressLevel();

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Compressing...';
    progressContainer.classList.remove('hidden');
    if (window.showLoader) window.showLoader('Compressing your PDF…');

    const total = compressPdfDoc.numPages;
    totalSpan.textContent = total;

    try {
        const outPdf = await PDFLib.PDFDocument.create();

        for (let i = 1; i <= total; i++) {
            currentSpan.textContent = i;
            progressFill.style.width = ((i / total) * 100) + '%';
            if (window.updateLoader) window.updateLoader('Compressing page ' + i + ' of ' + total + '…');

            const page = await compressPdfDoc.getPage(i);
            const pageDims = page.getViewport({ scale: 1 }); // original page size in points
            const blob = await pageToJpegBlob(page, scale, quality);
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

        const newSize = pdfBytes.length;
        const outBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        saveAs(outBlob, compressFile.name.replace(/\.pdf$/i, '') + '_compressed.pdf');

        const pct = Math.round((1 - newSize / compressOriginalSize) * 100);
        if (window.showToast) {
            if (newSize < compressOriginalSize) {
                window.showToast('Compressed: ' + fmtSize(compressOriginalSize) + ' → ' +
                    fmtSize(newSize) + ' (-' + pct + '%).', 'success');
            } else {
                window.showToast('Done, but this PDF was already compact — the result is ' +
                    fmtSize(newSize) + '.', 'info');
            }
        }

        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';

        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-file-zipper"></i> Compress Again';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
            progressContainer.classList.add('hidden');
        }, 3000);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error compressing PDF: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-file-zipper"></i> Try Again';
    }
}
