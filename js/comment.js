document.getElementById('comment-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    const commentText = document.getElementById('comment-text').value;
    if (file && selectedPages.size > 0 && commentText) {
        console.log('Adding comment to selected pages:', Array.from(selectedPages));
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();
            const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, Array.from(selectedPages).map(p => p - 1));

            pagesToCopy.forEach((page, index) => {
                const { width, height } = page.getSize();
                const text = pdfLibDoc.embedText(commentText, {
                    size: 24,
                    x: width / 2,
                    y: height / 2,
                    color: PDFLib.rgb(0, 0, 0),
                });
                page.drawText(text);
                pdfLibDoc.addPage(page);
            });

            const pdfBytes = await pdfLibDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = `commented.pdf`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            console.log('Comment added and PDF ready for download.');
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected or no pages/comments provided.');
    }
});
