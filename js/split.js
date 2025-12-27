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
            } else if (selectedPages && selectedPages.size > 0) {
                // Fallback if input is empty but Set has data (should be synced, but just in case)
                finalPageIndices = Array.from(selectedPages).map(p => p - 1).sort((a, b) => a - b);
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
