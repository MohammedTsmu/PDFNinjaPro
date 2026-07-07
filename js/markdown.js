// PDF to Markdown Tool.
// Extracts positioned text with pdf.js and reconstructs Markdown: groups items
// into lines, detects headings by relative font size, and detects bullet/
// numbered lists. Best-effort — layout-heavy PDFs won't be perfect.

let mdFile = null;
let mdPdfDoc = null;
let mdResultFull = '';

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('markdown-drop-zone');
    const fileInput = document.getElementById('markdown-upload');
    const startBtn = document.getElementById('start-markdown-btn');
    const resetBtn = document.getElementById('markdown-reset-btn');
    const copyBtn = document.getElementById('markdown-copy-btn');
    const dlBtn = document.getElementById('markdown-download-btn');

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleMarkdownFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleMarkdownFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetMarkdownUI);
    if (startBtn) startBtn.addEventListener('click', startMarkdown);

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (!mdResultFull) return;
            navigator.clipboard.writeText(mdResultFull).then(() => {
                const original = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => copyBtn.innerHTML = original, 2000);
            });
        });
    }

    if (dlBtn) {
        dlBtn.addEventListener('click', () => {
            if (!mdResultFull) return;
            const blob = new Blob([mdResultFull], { type: 'text/markdown;charset=utf-8' });
            saveAs(blob, (mdFile ? mdFile.name.replace(/\.pdf$/i, '') : 'document') + '.md');
        });
    }
});

async function handleMarkdownFile(file) {
    mdFile = file;

    document.getElementById('markdown-drop-zone').classList.add('hidden');
    document.getElementById('markdown-file-info').classList.remove('hidden');
    document.getElementById('start-markdown-btn').classList.remove('hidden');

    document.getElementById('markdown-filename').textContent = file.name;
    document.getElementById('markdown-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loaded = await window.loadPdfProtected(arrayBuffer);
        if (!loaded) { resetMarkdownUI(); return; } // password prompt cancelled
        mdPdfDoc = loaded.pdfDoc;
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetMarkdownUI();
    }
}

function resetMarkdownUI() {
    mdFile = null;
    mdPdfDoc = null;
    mdResultFull = '';

    document.getElementById('markdown-drop-zone').classList.remove('hidden');
    document.getElementById('markdown-file-info').classList.add('hidden');
    document.getElementById('start-markdown-btn').classList.add('hidden');
    document.getElementById('markdown-actions').classList.add('hidden');
    document.getElementById('markdown-result').classList.add('hidden');
    document.getElementById('markdown-upload').value = '';
    document.getElementById('markdown-result').value = '';
}

// Extract positioned lines from a page (no Markdown formatting yet).
async function extractLines(page) {
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str && it.str.trim().length);
    if (!items.length) return [];

    // Group items into lines by their y position.
    const rawLines = [];
    items.forEach(it => {
        const t = it.transform;
        const x = t[4], y = t[5];
        const size = Math.hypot(t[2], t[3]) || it.height || 10;
        let line = rawLines.find(l => Math.abs(l.y - y) <= Math.max(2, size * 0.4));
        if (!line) { line = { y, size, parts: [] }; rawLines.push(line); }
        line.parts.push({ x, str: it.str, w: it.width || 0, font: it.fontName || '' });
        line.size = Math.max(line.size, size);
    });

    // Top-to-bottom (PDF y grows upward).
    rawLines.sort((a, b) => b.y - a.y);

    return rawLines.map(l => {
        l.parts.sort((a, b) => a.x - b.x);
        let text = '';
        let prevEnd = null;
        const fontFreq = {};
        l.parts.forEach(p => {
            if (prevEnd !== null && (p.x - prevEnd) > l.size * 0.25 &&
                !text.endsWith(' ') && !p.str.startsWith(' ')) {
                text += ' ';
            }
            text += p.str;
            prevEnd = p.x + p.w;
            if (p.font) fontFreq[p.font] = (fontFreq[p.font] || 0) + p.str.length;
        });
        // Dominant font of the line (used to spot headings that are bold but
        // not larger than body text — they use a different font).
        const font = Object.keys(fontFreq).sort((a, b) => fontFreq[b] - fontFreq[a])[0] || '';
        return { text: text.replace(/\s+/g, ' ').trim(), size: l.size, y: l.y, font };
    }).filter(l => l.text);
}

// Most common (rounded) font size across the whole document = body text.
// Computed globally so pages with few lines don't mis-detect headings.
function computeBodySize(allLines) {
    const freq = {};
    allLines.forEach(l => {
        const key = Math.round(l.size);
        freq[key] = (freq[key] || 0) + 1;
    });
    let best = 10, bestCount = -1;
    Object.keys(freq).forEach(k => {
        if (freq[k] > bestCount) { bestCount = freq[k]; best = parseInt(k, 10); }
    });
    return best || 10;
}

// Dominant font across the document = body text font. Lines in a different
// font are likely headings (bold), even if not larger than the body.
function computeBodyFont(allLines) {
    const freq = {};
    allLines.forEach(l => { if (l.font) freq[l.font] = (freq[l.font] || 0) + (l.text ? l.text.length : 1); });
    let best = '', bestCount = -1;
    Object.keys(freq).forEach(k => { if (freq[k] > bestCount) { bestCount = freq[k]; best = k; } });
    return best;
}

// A short line in a non-body font, not ending like a sentence → bold heading.
function looksLikeBoldHeading(l, bodyFont) {
    if (!l.font || !bodyFont || l.font === bodyFont) return false;
    const words = l.text.split(/\s+/).length;
    if (words > 10) return false;
    if (/[.:;,]$/.test(l.text)) return false;
    return true;
}

// Turn one page's lines into Markdown, using a shared document body size + font.
function linesToMarkdown(lines, bodySize, bodyFont) {
    if (!lines.length) return '';

    const bullet = /^[•·●▪–\-\*o]\s+/;
    const ordered = /^\d+[.)]\s+/;

    let md = '';
    let prevY = null, prevType = null;
    const ensureBlank = () => { if (md && !md.endsWith('\n\n')) md += md.endsWith('\n') ? '\n' : '\n\n'; };

    lines.forEach(l => {
        const ratio = l.size / bodySize;
        let type = 'p';
        let out = l.text;

        if (ratio >= 1.7) { type = 'h'; out = '# ' + l.text; }
        else if (ratio >= 1.4) { type = 'h'; out = '## ' + l.text; }
        else if (ratio >= 1.18) { type = 'h'; out = '### ' + l.text; }
        else if (bullet.test(l.text)) { type = 'li'; out = '- ' + l.text.replace(bullet, ''); }
        else if (ordered.test(l.text)) { type = 'li'; out = l.text; }
        else if (looksLikeBoldHeading(l, bodyFont)) { type = 'h'; out = '## ' + l.text; }

        const gap = prevY !== null ? (prevY - l.y) : 0;
        const bigGap = gap > bodySize * 1.8;

        if (type === 'h') {
            ensureBlank();
            md += out + '\n\n';
        } else if (type === 'li') {
            if (prevType !== 'li') ensureBlank();
            md += out + '\n';
        } else {
            if (bigGap || prevType === 'h' || prevType === 'li') ensureBlank();
            md += out + '\n';
        }
        prevY = l.y;
        prevType = type;
    });

    return md.trim();
}

// OCR each page (English) and return the recognized text — used when a PDF has
// no selectable text (scanned / image-only).
async function ocrMarkdownFallback(total, statusEl, resultArea) {
    const worker = await Tesseract.createWorker('eng');
    try {
        const parts = [];
        for (let i = 1; i <= total; i++) {
            statusEl.textContent = `OCR page ${i} of ${total}…`;
            const page = await mdPdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            page.cleanup();
            const { data } = await worker.recognize(canvas);
            const txt = (data.text || '').trim();
            if (txt) parts.push(txt);
            if (resultArea) { resultArea.value = parts.join('\n\n'); resultArea.scrollTop = resultArea.scrollHeight; }
        }
        return parts.join('\n\n');
    } finally {
        try { await worker.terminate(); } catch (e) { /* ignore */ }
    }
}

async function startMarkdown() {
    if (!mdPdfDoc) return;

    const startBtn = document.getElementById('start-markdown-btn');
    const resultArea = document.getElementById('markdown-result');
    const actions = document.getElementById('markdown-actions');
    const status = document.getElementById('markdown-status');

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Converting...';
    resultArea.classList.remove('hidden');
    resultArea.value = 'Converting to Markdown… please wait.';
    actions.classList.remove('hidden');

    const total = mdPdfDoc.numPages;

    try {
        // Pass 1: extract lines from every page.
        const perPageLines = [];
        for (let i = 1; i <= total; i++) {
            status.textContent = `Reading page ${i} of ${total}...`;
            const page = await mdPdfDoc.getPage(i);
            perPageLines.push(await extractLines(page));
            page.cleanup();
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
        }

        // Global body font size + font across the whole document.
        const allLines = perPageLines.flat();
        const bodySize = computeBodySize(allLines);
        const bodyFont = computeBodyFont(allLines);

        // Pass 2: render Markdown per page.
        const pagesMd = [];
        perPageLines.forEach((lines, idx) => {
            status.textContent = `Formatting page ${idx + 1} of ${total}...`;
            const pageMd = linesToMarkdown(lines, bodySize, bodyFont);
            if (pageMd) pagesMd.push(pageMd);
        });

        mdResultFull = pagesMd.join('\n\n');

        // Fallback: scanned / image-only PDFs have no text layer — recover it with OCR.
        if (!mdResultFull.trim()) {
            if (typeof Tesseract === 'undefined') {
                resultArea.value = '_No selectable text found — this PDF looks scanned, but the OCR engine could not load (check your connection)._';
            } else {
                status.textContent = 'No text layer found — running OCR…';
                resultArea.value = 'No selectable text found. Running OCR — this can take a while…';
                mdResultFull = await ocrMarkdownFallback(total, status, resultArea);
                resultArea.value = mdResultFull || '_OCR found no readable text._';
                if (window.showToast && mdResultFull) window.showToast('Scanned PDF — used OCR to recover the text.', 'info');
            }
        } else {
            resultArea.value = mdResultFull;
        }
        status.textContent = `Done — ${total} page(s) converted.`;

        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        if (window.showToast) window.showToast('Markdown ready — ' + total + ' page(s).', 'success');

        setTimeout(() => startBtn.classList.add('hidden'), 1200);

    } catch (e) {
        console.error(e);
        resultArea.value = 'Error converting to Markdown: ' + e.message;
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fab fa-markdown"></i> Try Again';
    }
}
