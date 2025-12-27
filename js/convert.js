document.getElementById('convert-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    if (file && selectedPages.size > 0) {
        console.log('Converting selected pages to images:', Array.from(selectedPages));
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const typedarray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedarray).promise.then(function (pdf) {
                selectedPages.forEach(pageNumber => {
                    pdf.getPage(pageNumber).then(function (page) {
                        const scale = 1.5;
                        const viewport = page.getViewport({ scale: scale });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        page.render({ canvasContext: context, viewport: viewport }).promise.then(function () {
                            canvas.toBlob(function (blob) {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `page-${pageNumber}.png`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                console.log(`Page ${pageNumber} converted to image.`);
                            });
                        });
                    }).catch(function (error) {
                        console.error('Error loading page', pageNumber, error);
                    });
                });
            }).catch(function (error) {
                console.error('Error loading PDF:', error);
            });
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected or no pages selected for conversion.');
    }
});
