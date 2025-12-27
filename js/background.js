document.getElementById('background-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    const backgroundColor = document.getElementById('background-color').value;

    if (file && selectedPages.size > 0) {
        console.log('Adding background color to selected pages:', Array.from(selectedPages), 'Color:', backgroundColor);
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();

            const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, Array.from(selectedPages).map(p => p - 1));

            for (const page of pagesToCopy) {
                const { width, height } = page.getSize();
                const newPage = pdfLibDoc.addPage([width, height]);

                newPage.drawRectangle({
                    x: 0,
                    y: 0,
                    width: width,
                    height: height,
                    color: PDFLib.rgb(
                        parseInt(backgroundColor.slice(1, 3), 16) / 255,
                        parseInt(backgroundColor.slice(3, 5), 16) / 255,
                        parseInt(backgroundColor.slice(5, 7), 16) / 255
                    ),
                    opacity: 0.5,
                });

                const embeddedPage = await pdfLibDoc.embedPage(page);
                newPage.drawPage(embeddedPage);
            }

            const pdfBytes = await pdfLibDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = 'background.pdf';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            console.log('Background added and PDF ready for download.');
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected or no pages selected for background application.');
    }
});
