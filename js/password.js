// document.getElementById('password-btn').addEventListener('click', async function () {
//     const fileInput = document.getElementById('pdf-upload');
//     const file = fileInput.files[0];
//     const password = document.getElementById('pdf-password').value;

//     if (file && password) {
//         console.log('Applying password protection');
//         const fileReader = new FileReader();
//         fileReader.onload = async function () {
//             const typedarray = new Uint8Array(this.result);
//             const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
//             const newPdfDoc = await PDFLib.PDFDocument.create();

//             const copiedPages = await newPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
//             copiedPages.forEach((page) => newPdfDoc.addPage(page));

//             const pdfBytes = await newPdfDoc.save();

//             const protectedPdfBytes = await addPasswordProtection(pdfBytes, password);

//             const blob = new Blob([protectedPdfBytes], { type: 'application/pdf' });
//             const url = URL.createObjectURL(blob);
//             const downloadLink = document.createElement('a');
//             downloadLink.href = url;
//             downloadLink.download = 'protected.pdf';
//             document.body.appendChild(downloadLink);
//             downloadLink.click();
//             document.body.removeChild(downloadLink);
//             console.log('Password applied and PDF ready for download.');
//         };
//         fileReader.readAsArrayBuffer(file);
//     } else {
//         console.log('No file selected or no password provided.');
//     }
// });

// async function addPasswordProtection(pdfBytes, password) {
//     const { PDFDocument } = PDFLib;
//     const pdfDoc = await PDFDocument.load(pdfBytes);

//     pdfDoc.encrypt({
//         userPassword: password,
//         ownerPassword: password,
//         permissions: {
//             printing: 'highResolution',
//             modifying: false,
//             copying: false,
//             annotating: false,
//             fillingForms: false,
//             contentAccessibility: false,
//             documentAssembly: false,
//         },
//     });

//     return await pdfDoc.save();
// }
