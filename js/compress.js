// document.getElementById('compress-btn').addEventListener('click', async function () {
//     const fileInput = document.getElementById('pdf-upload');
//     const file = fileInput.files[0];

//     if (file) {
//         console.log('Compressing PDF');
//         const fileReader = new FileReader();
//         fileReader.onload = async function () {
//             const typedarray = new Uint8Array(this.result);
//             const pdfDoc = await PDFLib.PDFDocument.load(typedarray);

//             // إنشاء مستند PDF جديد وضغط الصور
//             const newPdfDoc = await PDFLib.PDFDocument.create();
//             const copiedPages = await newPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());

//             copiedPages.forEach((page) => {
//                 newPdfDoc.addPage(page);
//                 // يمكننا تحسين الصور هنا إذا لزم الأمر
//                 // على سبيل المثال: page.compress()
//             });

//             const pdfBytes = await newPdfDoc.save();
//             const blob = new Blob([pdfBytes], { type: 'application/pdf' });
//             const url = URL.createObjectURL(blob);
//             const downloadLink = document.createElement('a');
//             downloadLink.href = url;
//             downloadLink.download = 'compressed.pdf';
//             document.body.appendChild(downloadLink);
//             downloadLink.click();
//             document.body.removeChild(downloadLink);
//             console.log('PDF compressed and ready for download.');
//         };
//         fileReader.readAsArrayBuffer(file);
//     } else {
//         console.log('No file selected.');
//     }
// });
