// Delete Pages Tool Logic

let deleteFile = null;
let deletePdfDoc = null;
let deletePages = []; // { pageIndex, marked, element }

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('delete-drop-zone');
    const fileInput = document.getElementById('delete-upload');
    const resetBtn = document.getElementById('delete-reset-btn');
    const saveBtn = document.getElementById('delete-save-btn');
    const selectAllBtn = document.getElementById('delete-select-all');
    const clearBtn = document.getElementById('delete-clear');
    const rangeInput = document.getElementById('delete-range');
    const rangeApplyBtn = document.getElementById('delete-range-apply');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleDeleteFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleDeleteFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetDeleteUI);
    if (saveBtn) saveBtn.addEventListener('click', saveDeletedPDF);
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllDeletePages);
    if (clearBtn) clearBtn.addEventListener('click', clearDeletePages);
    if (rangeApplyBtn) rangeApplyBtn.addEventListener('click', applyDeleteRange);
    if (rangeInput) rangeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyDeleteRange();
    });
});

async function handleDeleteFile(file) {
    deleteFile = file;
    deletePages = [];

    document.getElementById('delete-drop-zone').classList.add('hidden');
    document.getElementById('delete-file-info').classList.remove('hidden');
    document.getElementById('delete-toolbar').classList.remove('hidden');
    document.getElementById('delete-grid').classList.remove('hidden');

    document.getElementById('delete-filename').textContent = file.name;
    document.getElementById('delete-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        deletePdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        renderDeleteGrid();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetDeleteUI();
    }
}

function resetDeleteUI() {
    deleteFile = null;
    deletePdfDoc = null;
    deletePages = [];
    document.getElementById('delete-grid').innerHTML = '';

    document.getElementById('delete-drop-zone').classList.remove('hidden');
    document.getElementById('delete-file-info').classList.add('hidden');
    document.getElementById('delete-toolbar').classList.add('hidden');
    document.getElementById('delete-grid').classList.add('hidden');
    document.getElementById('delete-upload').value = '';
    updateDeleteCount();
}

async function renderDeleteGrid() {
    const grid = document.getElementById('delete-grid');
    grid.innerHTML = '';
    deletePages = [];

    const totalPages = deletePdfDoc.numPages;

    for (let i = 1; i <= totalPages; i++) {
        // Create placeholder card first (fast, no rendering)
        const card = document.createElement('div');
        card.className = 'page-card delete-card loading';
        card.dataset.pageIndex = i;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.width = '150px'; // Placeholder size
        canvasWrapper.style.height = '200px';
        canvasWrapper.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px; color:rgba(255,255,255,0.3);"></i>';
        card.appendChild(canvasWrapper);

        const pageNum = document.createElement('div');
        pageNum.className = 'page-num';
        pageNum.textContent = `Page ${i}`;
        card.appendChild(pageNum);

        // Red "marked for deletion" overlay badge (reuses the page-checkbox slot)
        const badge = document.createElement('div');
        badge.className = 'page-checkbox delete-badge';
        badge.innerHTML = '<i class="fas fa-times"></i>';
        card.appendChild(badge);

        grid.appendChild(card);

        const pageData = {
            pageIndex: i,
            marked: false,
            element: card,
            rendered: false
        };
        deletePages.push(pageData);

        card.addEventListener('click', () => {
            pageData.marked = !pageData.marked;
            card.classList.toggle('marked', pageData.marked);
            updateDeleteCount();
        });
    }

    // Use IntersectionObserver for true lazy loading
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const pageIndex = parseInt(card.dataset.pageIndex, 10);
                renderDeletePage(pageIndex);
                observer.unobserve(card); // Stop observing once rendered
            }
        });
    }, {
        root: null, // viewport
        rootMargin: '200px', // Start loading 200px before visible
        threshold: 0
    });

    deletePages.forEach(p => observer.observe(p.element));
    updateDeleteCount();
}

async function renderDeletePage(pageIndex) {
    const pageData = deletePages[pageIndex - 1];
    if (!pageData || pageData.rendered) return;

    try {
        const page = await deletePdfDoc.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 0.2 });

        const card = pageData.element;
        const canvasWrapper = card.querySelector('.canvas-wrapper');
        canvasWrapper.innerHTML = '';
        canvasWrapper.style.width = viewport.width + 'px';
        canvasWrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        canvasWrapper.appendChild(canvas);
        card.classList.remove('loading');
        pageData.rendered = true;
    } catch (e) {
        console.error('Error rendering page', pageIndex, e);
    }
}

function updateDeleteCount() {
    const countEl = document.getElementById('delete-count');
    if (!countEl) return;
    const marked = deletePages.filter(p => p.marked).length;
    countEl.textContent = marked === 1
        ? '1 page will be removed'
        : `${marked} pages will be removed`;
}

function selectAllDeletePages() {
    deletePages.forEach(p => {
        p.marked = true;
        p.element.classList.add('marked');
    });
    updateDeleteCount();
}

function clearDeletePages() {
    deletePages.forEach(p => {
        p.marked = false;
        p.element.classList.remove('marked');
    });
    updateDeleteCount();
}

// Mark pages from a range string like "2-4, 7, 10" (1-based). Adds to the
// current selection rather than replacing it.
function applyDeleteRange() {
    const input = document.getElementById('delete-range');
    if (!input) return;
    const raw = (input.value || '').trim();
    if (!raw) return;

    const total = deletePages.length;
    const toMark = new Set();

    raw.split(',').forEach(part => {
        part = part.trim();
        if (!part) return;
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
            let a = parseInt(m[1], 10);
            let b = parseInt(m[2], 10);
            if (a > b) [a, b] = [b, a];
            for (let n = a; n <= b; n++) if (n >= 1 && n <= total) toMark.add(n);
        } else if (/^\d+$/.test(part)) {
            const n = parseInt(part, 10);
            if (n >= 1 && n <= total) toMark.add(n);
        }
    });

    if (toMark.size === 0) {
        alert('Enter a valid range, e.g. 2-4, 7');
        return;
    }

    toMark.forEach(n => {
        const p = deletePages[n - 1];
        p.marked = true;
        p.element.classList.add('marked');
    });
    input.value = '';
    updateDeleteCount();
}

async function saveDeletedPDF() {
    if (!deleteFile) return;

    const markedPages = deletePages.filter(p => p.marked);
    if (markedPages.length === 0) {
        alert('Please mark at least one page to delete.');
        return;
    }

    // GUARD: never let the user delete every page.
    if (markedPages.length >= deletePages.length) {
        alert("Can't delete every page.");
        return;
    }

    const btn = document.getElementById('delete-save-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await deleteFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const newPdfDoc = await PDFLib.PDFDocument.create();

        // Build the KEEP list = all page indices (0-based) minus the marked ones,
        // preserving original order.
        const markedSet = new Set(markedPages.map(p => p.pageIndex - 1));
        const keepIndices = [];
        for (let i = 0; i < pdfDoc.getPageCount(); i++) {
            if (!markedSet.has(i)) keepIndices.push(i);
        }

        const copied = await newPdfDoc.copyPages(pdfDoc, keepIndices);
        copied.forEach(page => newPdfDoc.addPage(page));

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = deleteFile.name.replace(/\.pdf$/i, '_edited.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Delete & Save';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
