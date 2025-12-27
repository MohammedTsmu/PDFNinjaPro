document.getElementById('rotate-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    const rotateAngle = parseInt(document.getElementById('rotate-angle').value);
    if (file && selectedPages.size > 0 && [90, 180, 270].includes(rotateAngle)) {
        console.log('Rotating selected pages:', Array.from(selectedPages), 'by', rotateAngle, 'degrees');
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();
            const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, Array.from(selectedPages).map(p => p - 1)); pagesToCopy.forEach((page, index) => {
                page.setRotation(PDFLib.degrees(rotateAngle));
                pdfLibDoc.addPage(page);
            });

            const pdfBytes = await pdfLibDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = 'rotated.pdf';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            console.log('Pages rotated and PDF ready for download.');
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected, no pages selected for rotation, or invalid angle.');
    }
});