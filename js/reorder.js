// Reorder Tool Logic

let reorderFile = null;
let reorderPdfDoc = null;
let reorderBytes = null; // decrypted bytes for pdf-lib save (handles protected PDFs)
let reorderPages = []; // { pageIndex, element }
let reorderSortable = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('reorder-drop-zone');
    const fileInput = document.getElementById('reorder-upload');
    const resetBtn = document.getElementById('reorder-reset-btn');
    const saveBtn = document.getElementById('reorder-save-btn');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleReorderFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleReorderFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetReorderUI);
    if (saveBtn) saveBtn.addEventListener('click', saveReorderedPDF);
});

async function handleReorderFile(file) {
    reorderFile = file;
    reorderPages = [];

    document.getElementById('reorder-drop-zone').classList.add('hidden');
    document.getElementById('reorder-file-info').classList.remove('hidden');
    document.getElementById('reorder-toolbar').classList.remove('hidden');
    document.getElementById('reorder-grid').classList.remove('hidden');

    document.getElementById('reorder-filename').textContent = file.name;
    document.getElementById('reorder-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loaded = await window.loadPdfProtected(arrayBuffer);
        if (!loaded) { resetReorderUI(); return; } // password prompt cancelled
        reorderPdfDoc = loaded.pdfDoc;
        reorderBytes = loaded.bytes;
        renderReorderGrid();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetReorderUI();
    }
}

function resetReorderUI() {
    reorderFile = null;
    reorderPdfDoc = null;
    reorderBytes = null;
    reorderPages = [];
    if (reorderSortable) {
        reorderSortable.destroy();
        reorderSortable = null;
    }
    document.getElementById('reorder-grid').innerHTML = '';

    document.getElementById('reorder-drop-zone').classList.remove('hidden');
    document.getElementById('reorder-file-info').classList.add('hidden');
    document.getElementById('reorder-toolbar').classList.add('hidden');
    document.getElementById('reorder-grid').classList.add('hidden');
    document.getElementById('reorder-upload').value = '';
}

async function renderReorderGrid() {
    const grid = document.getElementById('reorder-grid');
    grid.innerHTML = '';
    reorderPages = [];

    const totalPages = reorderPdfDoc.numPages;
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 50;

    // Create all placeholders first
    for (let i = 1; i <= totalPages; i++) {
        const card = document.createElement('div');
        card.className = 'page-card reorder-card loading';
        card.dataset.pageIndex = i;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.width = '150px';
        canvasWrapper.style.height = '200px';
        canvasWrapper.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px; color:rgba(255,255,255,0.3);"></i>';
        card.appendChild(canvasWrapper);

        const pageNum = document.createElement('div');
        pageNum.className = 'page-num';
        pageNum.textContent = `Page ${i}`;
        card.appendChild(pageNum);

        const dragIcon = document.createElement('div');
        dragIcon.className = 'drag-handle-icon';
        dragIcon.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        card.appendChild(dragIcon);

        grid.appendChild(card);

        reorderPages.push({
            pageIndex: i,
            element: card,
            rendered: false
        });
    }

    // Initialize Sortable immediately so user can reorder even while loading
    reorderSortable = new Sortable(grid, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.page-card',
        onEnd: function (evt) {
            const draggedCard = evt.item;
            const newPosition = evt.newIndex + 1;
            const oldPosition = evt.oldIndex + 1;

            if (oldPosition !== newPosition) {
                draggedCard.dataset.moved = 'true';
            }

            updatePageNumbers();
        }
    });

    // Render in batches
    // Use IntersectionObserver for true lazy loading
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const pageIndex = parseInt(card.dataset.pageIndex, 10);
                renderReorderPage(pageIndex);
                observer.unobserve(card);
            }
        });
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0
    });

    reorderPages.forEach(p => observer.observe(p.element));
}

async function renderReorderPage(pageIndex) {
    const pageData = reorderPages[pageIndex - 1];
    if (!pageData || pageData.rendered) return;

    try {
        const page = await reorderPdfDoc.getPage(pageIndex);
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



function updatePageNumbers() {
    const cards = document.querySelectorAll('#reorder-grid .page-card');

    // Build swap pairs: find pages that swapped positions
    const swapPairs = [];
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    let colorIndex = 0;

    cards.forEach((card, idx) => {
        const originalPage = parseInt(card.dataset.pageIndex, 10);
        const currentPosition = idx + 1;
        const wasIntentionallyMoved = card.dataset.moved === 'true';

        if (wasIntentionallyMoved && originalPage !== currentPosition) {
            // Find if another page now occupies this page's original position
            const cardAtMyOriginalPos = Array.from(cards).find((c, i) => {
                return (i + 1) === originalPage && parseInt(c.dataset.pageIndex, 10) !== originalPage;
            });

            if (cardAtMyOriginalPos) {
                // Check if we already have this pair
                const cardAtOriginalPageIndex = parseInt(cardAtMyOriginalPos.dataset.pageIndex, 10);
                const existingPair = swapPairs.find(p =>
                    (p.pageA === originalPage && p.pageB === cardAtOriginalPageIndex) ||
                    (p.pageB === originalPage && p.pageA === cardAtOriginalPageIndex)
                );

                if (!existingPair) {
                    swapPairs.push({
                        pageA: originalPage,
                        pageB: cardAtOriginalPageIndex,
                        color: colors[colorIndex % colors.length]
                    });
                    colorIndex++;
                }
            }
        }
    });

    // Update display
    cards.forEach((card, idx) => {
        const originalPage = parseInt(card.dataset.pageIndex, 10);
        const currentPosition = idx + 1;
        const pageNum = card.querySelector('.page-num');
        const wasIntentionallyMoved = card.dataset.moved === 'true';

        // Remove old swap badge
        const oldBadge = card.querySelector('.swap-badge');
        if (oldBadge) oldBadge.remove();

        // Check if this page is part of a swap
        const swapInfo = swapPairs.find(p => p.pageA === originalPage || p.pageB === originalPage);

        if (wasIntentionallyMoved && originalPage !== currentPosition) {
            pageNum.innerHTML = `<span class="original-page">Page ${originalPage}</span> → <span class="new-position">Pos ${currentPosition}</span>`;
            card.classList.add('page-moved');

            // Add swap badge if part of a swap
            if (swapInfo) {
                const otherPage = swapInfo.pageA === originalPage ? swapInfo.pageB : swapInfo.pageA;
                const badge = document.createElement('div');
                badge.className = 'swap-badge';
                badge.style.background = swapInfo.color;
                badge.innerHTML = `<i class="fas fa-exchange-alt"></i> ${otherPage}`;
                badge.title = `Swapped with Page ${otherPage}`;
                card.appendChild(badge);
            }
        } else if (originalPage !== currentPosition) {
            pageNum.innerHTML = `Page ${originalPage} <span class="shifted-pos">(now ${currentPosition})</span>`;
            card.classList.remove('page-moved');
        } else {
            pageNum.textContent = `Page ${originalPage}`;
            card.classList.remove('page-moved');
            delete card.dataset.moved;
        }
    });
}

async function saveReorderedPDF() {
    if (!reorderFile) return;
    const btn = document.getElementById('reorder-save-btn');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const pdfDoc = await PDFLib.PDFDocument.load(reorderBytes, { ignoreEncryption: true });
        const newPdfDoc = await PDFLib.PDFDocument.create();

        // Get new order from DOM
        const cards = document.querySelectorAll('#reorder-grid .page-card');
        const newOrder = Array.from(cards).map(card => parseInt(card.dataset.pageIndex, 10) - 1);

        const copiedPages = await newPdfDoc.copyPages(pdfDoc, newOrder);
        copiedPages.forEach(page => newPdfDoc.addPage(page));

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = reorderFile.name.replace('.pdf', '_reordered.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Save Reordered PDF';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
