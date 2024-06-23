document.getElementById('merge-btn').addEventListener('click', async function () {
    const files = document.getElementById('pdf-merge-upload').files;
    if (files.length > 0) {
        console.log('Merging PDFs:', files);
        const pdfLibDoc = await PDFLib.PDFDocument.create();

        for (const file of files) {
            const fileReader = new FileReader();
            fileReader.onload = async function () {
                const typedarray = new Uint8Array(this.result);
                const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
                const pages = await pdfLibDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                pages.forEach((page) => {
                    pdfLibDoc.addPage(page);
                });

                if (file === files[files.length - 1]) {
                    const pdfBytes = await pdfLibDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const mergeDownloadLink = document.getElementById('merge-download-link');
                    mergeDownloadLink.href = url;
                    mergeDownloadLink.download = `merged.pdf`;
                    mergeDownloadLink.style.display = 'inline';
                    console.log('PDFs merged and ready for download.');
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    } else {
        console.log('No files selected for merging.');
    }
});
