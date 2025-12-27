document.getElementById('extract-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    if (file && selectedPages.size > 0) {
        console.log('Extracting text from selected pages:', Array.from(selectedPages));
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const typedarray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedarray).promise.then(async function (pdf) {
                let extractedText = '';
                for (const pageNumber of selectedPages) {
                    const page = await pdf.getPage(pageNumber);
                    const textContent = await page.getTextContent();
                    const textItems = textContent.items.map(item => item.str);
                    extractedText += `Page ${pageNumber}:\n${textItems.join(' ')}\n\n`;
                }
                const blob = new Blob([extractedText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'extracted-text.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                console.log('Text extracted and file ready for download.');
            }).catch(function (error) {
                console.error('Error extracting text:', error);
            });
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected or no pages selected for text extraction.');
    }
});
