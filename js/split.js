// Quick Extract Helper
window.extractSinglePage = async function (pageNum) {
    const fileInput = document.getElementById('pdf-upload');
    if (!fileInput.files[0]) return;

    try {
        const file = fileInput.files[0];
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const newPdf = await PDFLib.PDFDocument.create();

        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
        newPdf.addPage(copiedPage);

        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.name.replace('.pdf', '')}_Page_${pageNum}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (e) {
        console.error('Quick extract failed', e);
        alert('Failed to extract page');
    }
};



// Batch Split Logic
document.getElementById('batch-split-btn')?.addEventListener('click', async function () {
    const list = document.getElementById('batch-download-list');
    const sizeInput = document.getElementById('batch-size');
    const fileInput = document.getElementById('pdf-upload');

    if (!window.totalPageCount || !sizeInput.value || !fileInput.files[0]) {
        alert('Please load a PDF and enter a batch size.');
        return;
    }

    const size = parseInt(sizeInput.value);
    if (size < 1) return;

    list.innerHTML = '';
    list.classList.remove('hidden');
    list.innerHTML = '<span class="text-muted">Generating links...</span>';

    try {
        const file = fileInput.files[0];
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const total = pdfDoc.getPageCount();
        const numFiles = Math.ceil(total / size);

        list.innerHTML = ''; // Clear loading text

        for (let i = 0; i < numFiles; i++) {
            const start = i * size;
            const end = Math.min(start + size, total);
            // 0-based index for copy
            const indices = [];
            for (let p = start; p < end; p++) indices.push(p);

            // Generate Button
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-light';
            btn.style.margin = '2px';
            btn.innerHTML = `<i class="fas fa-file-pdf"></i> Part ${i + 1} (${start + 1}-${end})`;

            btn.onclick = async () => {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
                try {
                    const newPdf = await PDFLib.PDFDocument.create();
                    const copiedPages = await newPdf.copyPages(pdfDoc, indices);
                    copiedPages.forEach(p => newPdf.addPage(p));

                    const pdfBytes = await newPdf.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${file.name.replace('.pdf', '')}_Part_${i + 1}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    btn.innerHTML = `<i class="fas fa-check"></i> Done`;
                    setTimeout(() => btn.innerHTML = `<i class="fas fa-file-pdf"></i> Part ${i + 1} (${start + 1}-${end})`, 2000);
                } catch (e) {
                    console.error(e);
                    btn.innerHTML = 'Error';
                }
            };
            list.appendChild(btn);
        }

    } catch (e) {
        console.error(e);
        alert('Error preparing batch split.');
    }
});

// Bookmark Split Logic
document.getElementById('split-by-bookmarks-btn')?.addEventListener('click', async function () {
    if (!window.pdfOutline || window.pdfOutline.length === 0) return;

    const listContainer = document.getElementById('chapter-list');
    listContainer.innerHTML = '<div class="spinner-sm"></div> Loading chapters...';
    listContainer.classList.remove('hidden');

    try {
        const chapters = [];

        // Recursive flattener to get ALL chapters, not just top level
        const resolveDestination = async (dest) => {
            if (typeof dest === 'string') {
                return window.pdfDocLoaded.getDestination(dest).then(resolved => {
                    if (resolved) return window.pdfDocLoaded.getPageIndex(resolved[0]);
                    return -1;
                });
            } else if (Array.isArray(dest)) {
                return window.pdfDocLoaded.getPageIndex(dest[0]);
            }
            return -1;
        };

        const flatten = async (items, level = 0) => {
            for (const item of items) {
                let pageIndex = -1;
                if (item.dest) pageIndex = await resolveDestination(item.dest);
                else if (item.url) continue;

                if (pageIndex !== -1) {
                    chapters.push({
                        title: item.title,
                        page: pageIndex + 1,
                        level: level // Track depth for UI
                    });
                }

                // Recurse if children exist, BUT limit depth to avoid "Topics" (small sections)
                // We only want Level 0 (Parts) and Level 1 (Chapters).
                // Stopping recursion here prevents digging into Level 2+
                if (level < 1 && item.items && item.items.length > 0) {
                    await flatten(item.items, level + 1);
                }
            }
        };

        await flatten(window.pdfOutline);

        // --- SMART FILTERING & RANGING ---
        // 1. Calculate Ranges
        let processedChapters = [];

        for (let i = 0; i < chapters.length; i++) {
            const chap = chapters[i];

            // Calculate hypothetical end based on next chapter's start
            let endPage = window.totalPageCount;
            if (i < chapters.length - 1) {
                endPage = chapters[i + 1].page - 1;
            }
            if (endPage < chap.page) endPage = chap.page; // Fix overlap for same-page chapters

            chap.start = chap.page;
            chap.end = endPage;

            // 2. Filter Logic: "Real Chapters Only"
            // If this chapter starts on the same page as the *next* one, it's likely a Container Section.
            // Example: "Unit 1" (Pg 5) -> "Chapter 1" (Pg 5).
            // We want to skip "Unit 1" and show "Chapter 1".

            let isContainer = false;
            // Check if next item exists and has same start page
            if (i < chapters.length - 1 && chapters[i + 1].page === chap.page) {
                isContainer = true;
            }

            // Only add if it's NOT a container (or if it's the last specific item on that page)
            if (!isContainer) {
                processedChapters.push(chap);
            }
        }

        // Re-calculate ends for the *filtered* list to fill gaps if any (Optional, but safer to keep original logic)
        // Actually, the simple logic above works: The "Container" had a range of 0 length. 
        // The "Child" will naturally pick up the correct end from the *next-next* item.

        // Wait, if I skip the container, the child (next item) needs to know its end.
        // The loop above calculated 'end' based on 'chapters[i+1]'.
        // If Chap 1 is at i+1, it has the correct page.
        // So Chap 1's end will be calculated based on Chap 2.
        // Section 1's end was calculated based on Chap 1 (resulting in 0 length).
        // So skipping Section 1 is safe.

        // Render List
        listContainer.innerHTML = '';
        if (processedChapters.length === 0) {
            listContainer.innerHTML = '<p class="text-muted">No valid chapters found.</p>';
            return;
        }

        processedChapters.forEach(chap => {
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
