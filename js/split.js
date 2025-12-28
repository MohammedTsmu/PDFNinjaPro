// Bookmark Split Logic
document.getElementById('split-by-bookmarks-btn')?.addEventListener('click', async function () {
    if (!window.pdfOutline || window.pdfOutline.length === 0) return;

    const listContainer = document.getElementById('chapter-list');
    listContainer.innerHTML = '<div class="spinner-sm"></div> Loading chapters...';
    listContainer.classList.remove('hidden');

    try {
        const chapters = [];

        // Helper to resolve page index from outline item
        const resolveDestination = async (dest) => {
            if (typeof dest === 'string') {
                // Named destination
                return window.pdfDocLoaded.getDestination(dest).then(resolved => {
                    if (resolved) return window.pdfDocLoaded.getPageIndex(resolved[0]);
                    return -1;
                });
            } else if (Array.isArray(dest)) {
                // Explicit destination [ref, ...]
                return window.pdfDocLoaded.getPageIndex(dest[0]);
            }
            return -1;
        };

        // Iterate top-level outline items
        for (let i = 0; i < window.pdfOutline.length; i++) {
            const item = window.pdfOutline[i];
            let pageIndex = -1;

            if (item.dest) {
                pageIndex = await resolveDestination(item.dest);
            } else if (item.url) {
                continue; // External link
            }

            if (pageIndex !== -1) {
                chapters.push({ title: item.title, page: pageIndex + 1 }); // 1-based page
            }
        }

        // Calculate ranges (start of current to start of next - 1)
        for (let i = 0; i < chapters.length; i++) {
            chapters[i].start = chapters[i].page;
            if (i < chapters.length - 1) {
                chapters[i].end = chapters[i + 1].page - 1;
            } else {
                chapters[i].end = window.totalPageCount || 9999; // Last chapter goes to end
            }
        }

        // Render List
        listContainer.innerHTML = '';
        if (chapters.length === 0) {
            listContainer.innerHTML = '<p class="text-muted">No valid chapters found.</p>';
            return;
        }

        chapters.forEach(chap => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-light';
            btn.style.display = 'block';
            btn.style.width = '100%';
            btn.style.marginBottom = '5px';
            btn.style.textAlign = 'left';
            btn.innerHTML = `<i class="fas fa-book-open"></i> ${chap.title} <span class="text-muted" style="float: right;">(Pg ${chap.start}-${chap.end})</span>`;

            btn.addEventListener('click', () => {
                // Select these pages
                if (typeof window.selectedPages !== 'undefined') {
                    window.selectedPages.clear();
                    const end = Math.min(chap.end, window.totalPageCount);
                    for (let p = chap.start; p <= end; p++) {
                        window.selectedPages.add(p);
                    }
                    if (typeof window.updateSelectionUI === 'function') window.updateSelectionUI();

                    // Also auto-fill chapter name
                    const nameInput = document.getElementById('chapter-name');
                    if (nameInput) nameInput.value = chap.title.replace(/[^a-zA-Z0-9-_]/g, '_');
                }
            });
            listContainer.appendChild(btn);
        });

    } catch (err) {
        console.error('Error parsing bookmarks:', err);
        listContainer.innerHTML = '<p class="text-danger">Error loading chapters.</p>';
    }
});

document.getElementById('split-btn').addEventListener('click', async function () {
    const chapterName = document.getElementById('chapter-name').value || 'split_document';
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];

    if (file) {
        console.log('Preparing to split PDF...');
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();

            let finalPageIndices = [];

            // Priority: Parse "page-ranges" input since it's synced with clicks
            const pageRanges = document.getElementById('page-ranges').value;

            if (pageRanges) {
                const parts = pageRanges.split(',');
                const indices = new Set();

                parts.forEach(part => {
                    const range = part.trim().split('-');
                    if (range.length === 2) {
                        const start = parseInt(range[0]);
                        const end = parseInt(range[1]);
                        if (!isNaN(start) && !isNaN(end)) {
                            // Handle reverse ranges too (5-1) if needed, but standard is min-max
                            const min = Math.min(start, end);
                            const max = Math.max(start, end);
                            for (let i = min; i <= max; i++) {
                                indices.add(i);
                            }
                        }
                    } else if (range.length === 1) {
                        const page = parseInt(range[0]);
                        if (!isNaN(page)) {
                            indices.add(page);
                        }
                    }
                });

                // Convert to 0-based indices, filter invalid pages, and sort
                finalPageIndices = Array.from(indices)
                    .filter(p => p > 0 && p <= pdfDoc.getPageCount())
                    .map(p => p - 1)
                    .sort((a, b) => a - b);

            } else {
                // VISUAL ORDER MODE regarding Global Selection
                // We scan the DOM to see the actual order of pages (handling reordering)
                const domPages = document.querySelectorAll('.page-container');
                finalPageIndices = [];

                domPages.forEach(el => {
                    const pageNum = parseInt(el.dataset.pageNumber);
                    if (window.selectedPages && window.selectedPages.has(pageNum)) {
                        finalPageIndices.push(pageNum - 1); // 0-based for pdf-lib
                    }
                });
            }

            if (finalPageIndices.length === 0) {
                alert('Please select pages in the preview or enter a valid page range.');
                return;
            }

            // Copy selected pages
            const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, finalPageIndices);
            pagesToCopy.forEach((page) => {
                pdfLibDoc.addPage(page);
            });

            const pdfBytes = await pdfLibDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const downloadLink = document.getElementById('download-link');
            downloadLink.href = url;
            downloadLink.download = `${chapterName}.pdf`;
            downloadLink.style.display = 'inline-flex';

            const notification = document.getElementById('notification');
            notification.innerHTML = `PDF split successfully! Contains ${finalPageIndices.length} pages.`;
            notification.classList.remove('hidden');
            setTimeout(() => notification.classList.add('hidden'), 5000);

            console.log('PDF split complete.');
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        alert('Please upload a PDF first.');
    }
});
