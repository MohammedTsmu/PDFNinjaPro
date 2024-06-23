document.getElementById('split-btn').addEventListener('click', async function () {
    const chapterName = document.getElementById('chapter-name').value;
    const startPage = parseInt(document.getElementById('start-page').value);
    const endPage = parseInt(document.getElementById('end-page').value);
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];

    if (chapterName && startPage && endPage && file) {
        console.log('Splitting PDF from page', startPage, 'to page', endPage);
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();

            if (startPage > 0 && endPage <= pdfDoc.getPageCount()) {
                const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, Array.from({ length: endPage - startPage + 1 }, (_, i) => i + startPage - 1));
                pagesToCopy.forEach((page) => {
                    pdfLibDoc.addPage(page);
                });

                const pdfBytes = await pdfLibDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const downloadLink = document.getElementById('download-link');
                downloadLink.href = url;
                downloadLink.download = `${chapterName}.pdf`;
                downloadLink.style.display = 'inline';

                const notification = document.getElementById('notification');
                notification.innerHTML = `PDF split successfully. Download: ${chapterName}.pdf`;
                notification.style.display = 'block';
                console.log('PDF split and ready for download.');
            } else {
                alert('Invalid page range.');
                console.error('Invalid page range:', startPage, endPage);
            }
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('Missing input for splitting PDF.');
    }
});
