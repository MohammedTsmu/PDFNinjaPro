// تعيين مسار العامل الخاص بـ PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

let selectedPages = new Set();
let pdf = null;
let currentPage = 1;
let totalPages = 0;
let viewMode = 'whole'; // تغيير القيمة الافتراضية إلى 'whole'

document.addEventListener('DOMContentLoaded', function () {
    // إزالة أزرار التبديل بين طرق العرض
    const viewPaginationBtn = document.getElementById('view-pagination');
    const viewWholeBtn = document.getElementById('view-whole');
    if (viewPaginationBtn) viewPaginationBtn.remove();
    if (viewWholeBtn) viewWholeBtn.remove();

    // إعداد حدث التحميل للملف
    const fileInput = document.getElementById('pdf-upload');
    if (fileInput) {
        fileInput.addEventListener('change', function () {
            const file = this.files[0];
            if (file) {
                console.log('File selected:', file.name);
                const fileReader = new FileReader();

                fileReader.onloadstart = function () {
                    document.getElementById('spinner').classList.remove('hidden');
                };

                fileReader.onloadend = function () {
                    const notif = document.getElementById('upload-notification');
                    notif.classList.remove('hidden');
                    setTimeout(() => {
                        notif.classList.add('hidden');
                    }, 3000);
                };

                fileReader.onload = function () {
                    const typedarray = new Uint8Array(this.result);
                    pdfjsLib.getDocument(typedarray).promise.then(function (loadedPdf) {
                        console.log('PDF loaded with', loadedPdf.numPages, 'pages.');
                        pdf = loadedPdf;
                        totalPages = pdf.numPages;

                        // Expose for other scripts
                        console.log('PDF loaded with', loadedPdf.numPages, 'pages.');
                        pdf = loadedPdf;
                        totalPages = pdf.numPages;

                        // Expose for other scripts
                        window.pdfDocLoaded = pdf;
                        window.totalPageCount = totalPages;

                        // UI Feedback: Keep blocked, but update message
                        const notif = document.getElementById('upload-notification');
                        notif.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing PDF structure...';
                        notif.classList.remove('hidden');

                        // Check for bookmarks (chapters)
                        pdf.getOutline().then(outline => {
                            if (outline && outline.length > 0) {
                                window.pdfOutline = outline;
                                const btn = document.getElementById('split-by-bookmarks-btn');
                                if (btn) btn.classList.remove('hidden');
                            } else {
                                window.pdfOutline = null;
                            }
                        });

                        // Start Rendering
                        displayAllPages();
                    }).catch(function (error) {
                        pdf.getOutline().then(outline => {
                            if (outline && outline.length > 0) {
                                console.log('Bookmarks found:', outline);
                                window.pdfOutline = outline;
                                // Show "Split by Bookmark" button if hidden
                                const btn = document.getElementById('split-by-bookmarks-btn');
                                if (btn) btn.classList.remove('hidden');
                            } else {
                                window.pdfOutline = null;
                            }
                        });

                        // Start Rendering in Background
                        displayAllPages();
                    }).catch(function (error) {
                        console.error('Error loading PDF:', error);
                        document.getElementById('spinner').classList.add('hidden');
                    });
                };
                fileReader.readAsArrayBuffer(file);
            } else {
                console.log('No file selected.');
            }
        });
    }

    // إعداد أحداث أزرار التمرير
    document.getElementById('scroll-top-btn').addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('scroll-bottom-btn').addEventListener('click', function () {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });

    // Reverse Sync: Input -> Visual Selection
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
                            for (let i = min; i <= max; i++) newSelected.add(i);
                        }
                    } else if (range.length === 1) {
                        const page = parseInt(range[0]);
                        if (!isNaN(page)) newSelected.add(page);
                    }
                });
            }

            // Update Global State
            selectedPages = newSelected;

            // Update UI (but don't overwrite input self to avoid cursor jumps!)
            // We duplicate UI update logic here or extract it to updateVisualsOnly() 
            // Simpler: Just copy specific UI update code here
            document.querySelectorAll('.page-container').forEach(container => {
                const num = parseInt(container.getAttribute('data-page-number'));
                if (selectedPages.has(num)) {
                    container.classList.add('selected');
                } else {
                    container.classList.remove('selected');
                }
            });
        });
    }
});

function updateSelectionUI() {
    // Sync UI with selectedPages Set
    document.querySelectorAll('.page-container').forEach(container => {
        const num = parseInt(container.getAttribute('data-page-number'));
        if (selectedPages.has(num)) {
            container.classList.add('selected');
        } else {
            container.classList.remove('selected');
        }
    });

    // Sync Input with Range Formatting
    const rangesInput = document.getElementById('page-ranges');
    if (rangesInput) {
        const sorted = Array.from(selectedPages).sort((a, b) => a - b);
        let ranges = [];
        for (let i = 0; i < sorted.length; i++) {
            const start = sorted[i];
            let end = start;
            while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
                end++;
                i++;
            }
            if (start === end) ranges.push(start);
            else ranges.push(`${start}-${end}`);
        }
        rangesInput.value = ranges.join(', ');
    }
}

document.getElementById('sel-all').addEventListener('click', () => {
    for (let i = 1; i <= totalPages; i++) selectedPages.add(i);
    updateSelectionUI();
});

document.getElementById('sel-none').addEventListener('click', () => {
    selectedPages.clear();
    updateSelectionUI();
});

document.getElementById('sel-inverse').addEventListener('click', () => {
    for (let i = 1; i <= totalPages; i++) {
        if (selectedPages.has(i)) selectedPages.delete(i);
        else selectedPages.add(i);
    }
    updateSelectionUI();
});

document.getElementById('sel-odd').addEventListener('click', () => {
    selectedPages.clear();
    for (let i = 1; i <= totalPages; i += 2) selectedPages.add(i);
    updateSelectionUI();
});

document.getElementById('sel-even').addEventListener('click', () => {
    selectedPages.clear();
    for (let i = 2; i <= totalPages; i += 2) selectedPages.add(i);
    updateSelectionUI();
});

function displayAllPages() {
    const pdfPreview = document.getElementById('pdf-preview');
    pdfPreview.innerHTML = '';

    // Show Toolbar
    document.getElementById('selection-toolbar').classList.remove('hidden');
    document.getElementById('selection-toolbar').style.display = 'flex';

    // Block User Interface with Spinner and Lock Scroll
    const spinner = document.getElementById('spinner');
    spinner.classList.remove('hidden');
    spinner.innerHTML = '<div class="spinner"></div><p style="margin-top:10px; color:white;">Loading pages...</p>';
    document.body.style.overflow = 'hidden'; // Lock scrolling

    // Concurrency settings
    const MAX_CONCURRENT_RENDERS = 4; // Safely render 4 pages at once
    let pagesRendered = 0;
    let nextPageToLoad = 1;

    // Init progress text immediately
    const spinnerText = document.querySelector('#spinner p');
    if (spinnerText) spinnerText.textContent = `Loading pages... 0%`;

    const updateProgress = () => {
        pagesRendered++;
        // Update progress text
        const pct = Math.round((pagesRendered / totalPages) * 100);
        if (spinnerText) spinnerText.textContent = `Loading pages... ${pct}%`;

        // Check completion
        if (pagesRendered >= totalPages) {
            document.getElementById('spinner').classList.add('hidden');
            document.body.style.overflow = 'auto'; // Unlock scrolling
            document.getElementById('upload-notification').classList.add('hidden');

            const success = document.createElement('div');
            success.className = 'notification';
            success.innerHTML = '<i class="fas fa-check-circle"></i> PDF Ready!';
            document.querySelector('.upload-hero').appendChild(success);
            setTimeout(() => success.remove(), 3000);

            document.getElementById('scroll-buttons').style.display = 'flex';
        } else {
            // Try to pick up next task
            startNextRender();
        }
    };

    const loadSinglePage = (pageNumber) => {
        return pdf.getPage(pageNumber).then(function (page) {
            // Low-res thumbnail for memory efficiency
            const scale = 0.3;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            const pageContainer = document.createElement('div');
            pageContainer.classList.add('page-container');
            pageContainer.style.order = pageNumber;
            pageContainer.setAttribute('data-page-number', pageNumber);

            const pageNumberDiv = document.createElement('div');
            pageNumberDiv.classList.add('page-number');
            pageNumberDiv.textContent = pageNumber;

            if (typeof selectedPages !== 'undefined' && selectedPages.has(pageNumber)) {
                pageContainer.classList.add('selected');
            }

            pageContainer.appendChild(canvas);
            pageContainer.appendChild(pageNumberDiv);

            pageContainer.addEventListener('click', function () {
                if (typeof selectedPages === 'undefined') return;
                if (selectedPages.has(pageNumber)) {
                    selectedPages.delete(pageNumber);
                } else {
                    selectedPages.add(pageNumber);
                }
                if (typeof updateSelectionUI === 'function') updateSelectionUI();
                else {
                    if (selectedPages.has(pageNumber)) pageContainer.classList.add('selected');
                    else pageContainer.classList.remove('selected');
                }
            });

            pdfPreview.appendChild(pageContainer);

            return page.render(renderContext).promise;
        }).catch(function (error) {
            console.error('Error loading page', pageNumber);
            if (spinnerText) spinnerText.innerText = `Error on page ${pageNumber}. Retrying...`;
            // Even if error, resolve to keep queue moving?
            // If we throw, the catch block in startNextRender calls updateProgress, which is good.
            throw error;
        });
    };

    const startNextRender = () => {
        if (nextPageToLoad > totalPages) return;

        const p = nextPageToLoad;
        nextPageToLoad++;

        loadSinglePage(p).then(() => {
            updateProgress();
        }).catch(() => {
            updateProgress(); // Mark as done/skipped to prevent hang
        });
    };

    // Kickoff initial batch
    const initialBatch = Math.min(totalPages, MAX_CONCURRENT_RENDERS);
    if (initialBatch > 0) {
        for (let i = 0; i < initialBatch; i++) {
            startNextRender();
        }
    } else {
        // Handle 0 pages edge case (corrupt PDF?)
        document.getElementById('spinner').classList.add('hidden');
        document.body.style.overflow = 'auto';
        alert("PDF loaded but appears to have 0 pages.");
    }
}
