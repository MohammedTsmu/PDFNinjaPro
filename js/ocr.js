// OCR Tool — recognize text in scanned / image-only PDFs using Tesseract.js.
// Each page is rendered to a canvas and passed to Tesseract. Two outputs:
//   - Text (.txt): plain recognized text.
//   - Searchable PDF: the original page image with an invisible text layer,
//     so the result is selectable/searchable (Tesseract's pdf output, merged
//     with pdf-lib).
// Runs fully client-side; the language model is fetched from CDN on first use.

let ocrFile = null;
let ocrPdfDoc = null;
let ocrResultText = '';
let ocrCancelRequested = false;
// Tracked so the Tesseract logger can prefix its sub-status with the page number.
let ocrCurPage = 0;
let ocrTotalPages = 0;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('ocr-drop-zone');
    const fileInput = document.getElementById('ocr-upload');
    const startBtn = document.getElementById('start-ocr-btn');
    const resetBtn = document.getElementById('ocr-reset-btn');
    const copyBtn = document.getElementById('ocr-copy-btn');
    const dlBtn = document.getElementById('ocr-download-btn');

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleOcrFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleOcrFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetOcrUI);
    if (startBtn) startBtn.addEventListener('click', startOcr);

    const cancelBtn = document.getElementById('ocr-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        ocrCancelRequested = true;
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling…';
    });

    // Show/hide text actions based on output mode.
    document.querySelectorAll('input[name="ocr-mode"]').forEach(r => {
        r.addEventListener('change', () => {
            // Actions and result are only meaningful for text output; hide when
            // switching to PDF, until a run produces something.
            if (r.value === 'pdf' && r.checked) {
                document.getElementById('ocr-actions').classList.add('hidden');
                document.getElementById('ocr-result').classList.add('hidden');
            }
        });
    });

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (!ocrResultText) return;
            navigator.clipboard.writeText(ocrResultText).then(() => {
                const o = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => copyBtn.innerHTML = o, 2000);
            });
        });
    }
    if (dlBtn) {
        dlBtn.addEventListener('click', () => {
            if (!ocrResultText) return;
            const blob = new Blob([ocrResultText], { type: 'text/plain;charset=utf-8' });
            saveAs(blob, (ocrFile ? ocrFile.name.replace(/\.pdf$/i, '') : 'ocr') + '_ocr.txt');
        });
    }
});

async function handleOcrFile(file) {
    ocrFile = file;

    document.getElementById('ocr-drop-zone').classList.add('hidden');
    document.getElementById('ocr-file-info').classList.remove('hidden');
    document.getElementById('ocr-settings').classList.remove('hidden');
    document.getElementById('start-ocr-btn').classList.remove('hidden');

    document.getElementById('ocr-filename').textContent = file.name;
    document.getElementById('ocr-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    try {
        const arrayBuffer = await file.arrayBuffer();
        ocrPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetOcrUI();
    }
}

function resetOcrUI() {
    ocrFile = null;
    ocrPdfDoc = null;
    ocrResultText = '';

    document.getElementById('ocr-drop-zone').classList.remove('hidden');
    document.getElementById('ocr-file-info').classList.add('hidden');
    document.getElementById('ocr-settings').classList.add('hidden');
    document.getElementById('start-ocr-btn').classList.add('hidden');
    document.getElementById('ocr-progress-container').classList.add('hidden');
    document.getElementById('ocr-cancel-btn').classList.add('hidden');
    document.getElementById('ocr-actions').classList.add('hidden');
    document.getElementById('ocr-result').classList.add('hidden');
    document.getElementById('ocr-result').value = '';
    document.getElementById('ocr-upload').value = '';
}

async function renderOcrPage(pageNum, scale) {
    const page = await ocrPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup();
    return canvas;
}

// Reset the UI after a user-requested cancel: hide progress/cancel, restore the
// Start button. The worker itself is terminated by startOcr's `finally`.
function finishOcrCancelled() {
    if (window.hideLoader) window.hideLoader();
    document.getElementById('ocr-progress-container').classList.add('hidden');
    const cancelBtn = document.getElementById('ocr-cancel-btn');
    cancelBtn.classList.add('hidden');
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = '<i class="fas fa-stop"></i> Cancel';
    const startBtn = document.getElementById('start-ocr-btn');
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Run OCR';
    startBtn.className = 'btn btn-primary';
    startBtn.style.width = '100%';
    if (window.showToast) window.showToast('OCR cancelled.', 'info');
}

async function startOcr() {
    if (!ocrPdfDoc) return;
    if (typeof Tesseract === 'undefined') {
        alert('OCR engine failed to load. Check your internet connection and try again.');
        return;
    }

    const startBtn = document.getElementById('start-ocr-btn');
    const progressContainer = document.getElementById('ocr-progress-container');
    const progressFill = document.getElementById('ocr-progress-fill');
    const statusEl = document.getElementById('ocr-progress-status');
    const currentSpan = document.getElementById('ocr-current-page');
    const totalSpan = document.getElementById('ocr-total-pages');
    const cancelBtn = document.getElementById('ocr-cancel-btn');
    const resultArea = document.getElementById('ocr-result');
    const actions = document.getElementById('ocr-actions');

    const mode = document.querySelector('input[name="ocr-mode"]:checked').value; // 'text' | 'pdf'
    const lang = document.getElementById('ocr-lang').value;

    // Fresh run: clear any prior cancel request and reset the Cancel button.
    ocrCancelRequested = false;
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = '<i class="fas fa-stop"></i> Cancel';
    cancelBtn.classList.remove('hidden');

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running OCR...';
    progressContainer.classList.remove('hidden');
    progressFill.style.width = '0%';
    statusEl.textContent = 'Loading ' + lang + ' model…';

    const total = ocrPdfDoc.numPages;
    ocrTotalPages = total;
    ocrCurPage = 0;
    totalSpan.textContent = total;
    currentSpan.textContent = '0';

    let worker = null;
    try {
        worker = await Tesseract.createWorker(lang, 1, {
            logger: (m) => {
                if (m.status && typeof m.progress === 'number') {
                    const prefix = ocrCurPage ? ('Page ' + ocrCurPage + ' / ' + ocrTotalPages + ' · ') : '';
                    statusEl.textContent = prefix + m.status + ' ' + Math.round(m.progress * 100) + '%';
                }
            }
        });

        if (mode === 'text') {
            resultArea.classList.remove('hidden');
            resultArea.value = 'Recognizing…';
            actions.classList.remove('hidden');
            let full = '';
            for (let i = 1; i <= total; i++) {
                if (ocrCancelRequested) { finishOcrCancelled(); return; }
                ocrCurPage = i;
                currentSpan.textContent = i;
                progressFill.style.width = ((i - 1) / total * 100) + '%';
                const canvas = await renderOcrPage(i, 2.0);
                const { data } = await worker.recognize(canvas);
                full += (data.text || '').trim() + '\n\n';
                resultArea.value = full;
                resultArea.scrollTop = resultArea.scrollHeight;
            }
            if (ocrCancelRequested) { finishOcrCancelled(); return; }
            progressFill.style.width = '100%';
            ocrResultText = full.trim();
            resultArea.value = ocrResultText || '_No text recognized._';
            statusEl.textContent = 'Done';
            if (window.showToast) window.showToast('OCR complete — ' + total + ' page(s).', 'success');
        } else {
            // Searchable PDF: collect Tesseract's per-page PDFs, merge with pdf-lib.
            if (window.showLoader) window.showLoader('Running OCR…');
            const merged = await PDFLib.PDFDocument.create();
            for (let i = 1; i <= total; i++) {
                if (ocrCancelRequested) { finishOcrCancelled(); return; }
                ocrCurPage = i;
                currentSpan.textContent = i;
                progressFill.style.width = ((i - 1) / total * 100) + '%';
                if (window.updateLoader) window.updateLoader('OCR page ' + i + ' of ' + total + '…');
                const canvas = await renderOcrPage(i, 2.0);
                const { data } = await worker.recognize(canvas, {}, { pdf: true });
                const pageBytes = new Uint8Array(data.pdf);
                const pagePdf = await PDFLib.PDFDocument.load(pageBytes);
                const copied = await merged.copyPages(pagePdf, pagePdf.getPageIndices());
                copied.forEach(p => merged.addPage(p));
            }
            // Cancelled after the last page but before saving: abort without saving.
            if (ocrCancelRequested) { finishOcrCancelled(); return; }
            progressFill.style.width = '100%';
            const outBytes = await merged.save();
            if (window.hideLoader) window.hideLoader();
            saveAs(new Blob([outBytes], { type: 'application/pdf' }),
                ocrFile.name.replace(/\.pdf$/i, '') + '_searchable.pdf');
            statusEl.textContent = 'Done';
            if (window.showToast) window.showToast('Searchable PDF ready — ' + total + ' page(s).', 'success');
        }

        cancelBtn.classList.add('hidden');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';
        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Run OCR Again';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
        }, 2500);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        cancelBtn.classList.add('hidden');
        alert('OCR error: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Try Again';
    } finally {
        if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } }
    }
}
