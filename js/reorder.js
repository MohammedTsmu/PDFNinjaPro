document.getElementById('reorder-btn').addEventListener('click', async function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    if (file) {
        console.log('Reordering pages');
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();

            const pageContainers = document.querySelectorAll('.page-container');
            const newOrder = Array.from(pageContainers).map(container => parseInt(container.getAttribute('data-page-number'), 10) - 1);
            console.log('New order:', newOrder);

            const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, newOrder);
            pagesToCopy.forEach((page) => {
                pdfLibDoc.addPage(page);
            });

            const pdfBytes = await pdfLibDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = 'reordered.pdf';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            console.log('Pages reordered and PDF ready for download.');
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected.');
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const pdfPreview = document.getElementById('pdf-preview');
    new Sortable(pdfPreview, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen'
    });
});
