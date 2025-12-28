// Direct PDF Loader - Simplified & Reliable
// Eliminates Web Workers to prevent "Fake Worker" and "Cross-Origin" issues.

window.selectedPages = new Set();
let pdfDocGlobal = null;

document.addEventListener('DOMContentLoaded', function () {
    // UI Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('pdf-upload');
    const statusCard = document.getElementById('file-status-card');
    const pdfPreview = document.getElementById('pdf-preview');

    // Legacy element cleanup
    const viewPaginationBtn = document.getElementById('view-pagination');
    const viewWholeBtn = document.getElementById('view-whole');
    if (viewPaginationBtn) viewPaginationBtn.remove();
    if (viewWholeBtn) viewWholeBtn.remove();

    // 1. Setup Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', handleDrop, false);
        fileInput.addEventListener('change', (e) => {
            if (testFiles(e.target.files)) startLoading(e.target.files[0]);
        });
    }

    function handleDrop(e) {
        if (testFiles(e.dataTransfer.files)) startLoading(e.dataTransfer.files[0]);
    }

    function testFiles(files) {
        return files.length > 0 && files[0].type === 'application/pdf';
    }

    // 2. Main Loading Logic
    async function startLoading(file) {
        // UI Reset
        console.log('Starting direct load for:', file.name);
        document.querySelector('.upload-content').classList.add('hidden');
        if (statusCard) statusCard.classList.remove('hidden');

        document.getElementById('status-filename').textContent = file.name;
        document.getElementById('status-size').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        const statusInd = document.querySelector('.status-indicator');
        const statusPages = document.getElementById('status-pages');
        if (statusInd) statusInd.className = 'status-indicator processing';
        if (statusPages) statusPages.innerHTML = 'Reading file...';

        // Show Full Screen Spinner
        const spinner = document.getElementById('spinner');
        if (spinner) {
            spinner.classList.remove('hidden');
            spinner.innerHTML = '<div class="spinner"></div><p style="margin-top:10px; color:white;">Initializing engine...</p>';
        }

        try {
            // Read ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();

            // Load PDF Document
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
                cMapPacked: true
            });

            pdfDocGlobal = await loadingTask.promise;

            // --- RESTORE CHAPTER LOGIC ---
            // split.js needs these globals to work
            window.pdfDocLoaded = pdfDocGlobal;
            const outline = await pdfDocGlobal.getOutline();
            window.pdfOutline = outline;

            const bookmarkBtn = document.getElementById('split-by-bookmarks-btn');
            if (outline && outline.length > 0 && bookmarkBtn) {
                bookmarkBtn.classList.remove('hidden');
            } else if (bookmarkBtn) {
                bookmarkBtn.classList.add('hidden');
            }
            // -----------------------------

            // Success State
            statusInd.className = 'status-indicator success';
            statusPages.innerHTML = '<span style="color:#10B981; font-weight:bold;">Ready</span> • ' + pdfDocGlobal.numPages + ' Pages';

            // Initialize Grid
            window.totalPageCount = pdfDocGlobal.numPages;
            await renderGrid(pdfDocGlobal);

            // Unlock UI
            spinner.classList.add('hidden');
            document.body.style.overflow = 'auto';

            // Show Tools
            const toolbar = document.getElementById('selection-toolbar');
            if (toolbar) {
                toolbar.classList.remove('hidden');
                toolbar.style.display = 'flex';
            }
            document.getElementById('scroll-buttons').style.display = 'flex';

        } catch (error) {
            console.error(error);
            alert('Error loading PDF: ' + error.message);
            spinner.classList.add('hidden');
        }
    }

    // 3. Custom Loop Renderer
    async function renderGrid(pdfDoc) {
        const container = document.getElementById('pdf-preview');
        container.innerHTML = '';

        const spinnerText = document.querySelector('#spinner p');

        // 1. Create Skeletons FIRST (Instant visual structure)
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageContainer = document.createElement('div');
            pageContainer.className = 'page-container loading';
            pageContainer.dataset.pageNumber = i;
            pageContainer.innerHTML = '<div class="skeleton-spinner"></div><div class="page-number">' + i + '</div>';
            pageContainer.onclick = () => toggleSelect(i, pageContainer);
            container.appendChild(pageContainer);
        }

        // 2. Render Loop (Congestion Control)
        // We process in small chunks to keep UI responsive
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            if (spinnerText) spinnerText.textContent = 'Rendering page ' + i + ' of ' + pdfDoc.numPages;

            await renderSinglePage(pdfDoc, i);

            // BREATHING ROOM: Pause every 3 pages to let UI update
            if (i % 3 === 0) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // 3. Init Sortable (Drag & Drop)
        if (typeof Sortable !== 'undefined') {
            new Sortable(container, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: function () {
                    console.log('Reorder happened');
                    // Optional: Update page numbers visually if you want, 
                    // but keeping original numbers is often better for reference.
                }
            });
        }
    }

    async function renderSinglePage(pdfDoc, pageNum) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.4 }); // Thumbnail scale

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            await page.render(renderContext).promise;

            // Update DOM
            const container = document.querySelector('.page-container[data-page-number="' + pageNum + '"]');
            if (container) {
                container.classList.remove('loading');
                container.innerHTML = ''; // Clear skeleton
                container.appendChild(canvas);

                const num = document.createElement('div');
                num.className = 'page-number';
                num.textContent = pageNum;
                container.appendChild(num);

                // Quick Extract Button
                const dlBtn = document.createElement('button');
                dlBtn.className = 'quick-split-btn';
                dlBtn.innerHTML = '<i class="fas fa-download"></i>';
                dlBtn.title = 'Extract this page';
                dlBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (window.extractSinglePage) window.extractSinglePage(pageNum);
                };
                container.appendChild(dlBtn);

                // Re-apply selection if needed
                if (window.selectedPages && window.selectedPages.has(pageNum)) container.classList.add('selected');
            }

            page.cleanup();
        } catch (e) {
            console.error('Page render error:', pageNum, e);
            const container = document.querySelector('.page-container[data-page-number="' + pageNum + '"]');
            if (container) {
                container.classList.remove('loading');
                container.innerHTML = '<div style="color:red; font-size:20px;">✖</div>';
            }
        }
    }

    // 4. Selection Logic
    function toggleSelect(i, el) {
        if (window.selectedPages.has(i)) {
            window.selectedPages.delete(i);
            el.classList.remove('selected');
        } else {
            window.selectedPages.add(i);
            el.classList.add('selected');
        }
        updateSelectionUI();
    }

    // 5. Toolbox Actions
    document.getElementById('sel-all').addEventListener('click', () => {
        if (!pdfDocGlobal) return;
        for (let i = 1; i <= pdfDocGlobal.numPages; i++) window.selectedPages.add(i);
        updateSelectionUI();
    });

    document.getElementById('sel-none').addEventListener('click', () => {
        window.selectedPages.clear();
        updateSelectionUI();
    });

    document.getElementById('sel-inverse').addEventListener('click', () => {
        if (!pdfDocGlobal) return;
        for (let i = 1; i <= pdfDocGlobal.numPages; i++) {
            if (window.selectedPages.has(i)) window.selectedPages.delete(i);
            else window.selectedPages.add(i);
        }
        updateSelectionUI();
    });

    document.getElementById('sel-odd').addEventListener('click', () => {
        if (!pdfDocGlobal) return;
        window.selectedPages.clear();
        for (let i = 1; i <= pdfDocGlobal.numPages; i += 2) window.selectedPages.add(i);
        updateSelectionUI();
    });

    document.getElementById('sel-even').addEventListener('click', () => {
        if (!pdfDocGlobal) return;
        window.selectedPages.clear();
        for (let i = 2; i <= pdfDocGlobal.numPages; i += 2) window.selectedPages.add(i);
        updateSelectionUI();
    });

    function updateSelectionUI() {
        window.updateSelectionUI = updateSelectionUI; // Expose for other modules
        // Visual Update
        document.querySelectorAll('.page-container').forEach(container => {
            const num = parseInt(container.dataset.pageNumber);
            if (window.selectedPages.has(num)) container.classList.add('selected');
            else container.classList.remove('selected');
        });

        // Input Update
        const rangesInput = document.getElementById('page-ranges');
        if (rangesInput) {
            const sorted = Array.from(window.selectedPages).sort((a, b) => a - b);
            let ranges = [];
            for (let i = 0; i < sorted.length; i++) {
                const start = sorted[i];
                let end = start;
                while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
                    end++;
                    i++;
                }
                if (start === end) ranges.push(start);
                else ranges.push(start + '-' + end);
            }
            rangesInput.value = ranges.join(', ');
        }
    }

    // Reverse Sync: Input -> visual
    const rangesInput = document.getElementById('page-ranges');
    if (rangesInput) {
        rangesInput.addEventListener('input', function () {
            const val = this.value;
            const newSelected = new Set();
            if (val) {
                const parts = val.split(',');
                parts.forEach(part => {
                    const range = part.trim().split('-');
                    if (range.length === 2) {
                        const start = parseInt(range[0]);
                        const end = parseInt(range[1]);
                        if (!isNaN(start) && !isNaN(end)) {
                            const min = Math.min(start, end);
                            const max = Math.max(start, end);
                            for (let k = min; k <= max; k++) newSelected.add(k);
                        }
                    } else if (range.length === 1) {
                        const p = parseInt(range[0]);
                        if (!isNaN(p)) newSelected.add(p);
                    }
                });
            }
            selectedPages = newSelected;
            // Update visual only
            document.querySelectorAll('.page-container').forEach(container => {
                const num = parseInt(container.dataset.pageNumber);
                if (selectedPages.has(num)) container.classList.add('selected');
                else container.classList.remove('selected');
            });
        });
    }

    // Scroll Buttons
    document.getElementById('scroll-top-btn').addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('scroll-bottom-btn').addEventListener('click', () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
});
