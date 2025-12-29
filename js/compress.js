const compressBtn = document.getElementById('compress-btn');
if (compressBtn) {
    compressBtn.addEventListener('click', async function () {
        const fileInput = document.getElementById('pdf-upload');
        const file = fileInput.files[0];

        if (file) {
            console.log('Compressing PDF');
            const fileReader = new FileReader();

            fileReader.onload = async function () {
                try {
                    const typedarray = new Uint8Array(this.result);
                    const pdfDoc = await PDFLib.PDFDocument.load(typedarray, { ignoreEncryption: true });

                    // Create new PDF
                    const newPdfDoc = await PDFLib.PDFDocument.create();
                    const copiedPages = await newPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());

                    copiedPages.forEach((page) => {
                        newPdfDoc.addPage(page);
                        // Future: Add compression logic here
                    });

                    const pdfBytes = await newPdfDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    // Download
                    const downloadLink = document.createElement('a');
                    downloadLink.href = url;
                    downloadLink.download = 'compressed_' + file.name;
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    document.body.removeChild(downloadLink);

                    console.log('PDF compressed and ready for download.');
                } catch (error) {
                    console.error('Compression error:', error);
                    alert('Error compressing PDF');
                }
            };

            fileReader.readAsArrayBuffer(file);
        } else {
            alert('Please select a PDF file first.');
        }
    });
}