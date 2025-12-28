document.addEventListener('DOMContentLoaded', function () {
    const currentYear = new Date().getFullYear();
    const copyrightText = `© ${currentYear} PDF Ninja Pro. All rights reserved.`;
    document.getElementById('copyright').innerHTML = copyrightText;
});
