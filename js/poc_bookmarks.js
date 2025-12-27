
async function checkBookmarks(pdfDoc) {
    const outline = await pdfDoc.getOutline();
    if (outline) {
        console.log('Bookmarks found:', outline);
        return outline;
    } else {
        console.log('No bookmarks found.');
        return null;
    }
}
// This snippet is for internal analysis, I will add it to main.js temporarily to test.
