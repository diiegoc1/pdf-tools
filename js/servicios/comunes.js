/* ============================================================
   SERVICIOS · COMUNES
   Desde acá usamos pdf-lib (vendor/pdf-lib.min.js), que deja
   disponible un objeto global llamado PDFLib.
   Ya sabemos lo que hace por dentro: es lo que programamos a mano
   en las etapas 5 a 7, más la parte de escribir.
   ============================================================ */

/* Abre un PDF y traduce los errores de la librería a mensajes para el usuario. */
async function abrirPdf(bytes) {
  try {
    return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (/encrypt/i.test(error.message)) {
      throw new Error(
        "El PDF está protegido con contraseña: hay que quitarle la protección antes.",
      );
    }
    throw new Error("No se pudo leer el PDF: " + error.message);
  }
}

/* Si no tiene páginas legibles, no sirve para ninguna herramienta. */
async function contarPaginas(bytes) {
  const doc = await abrirPdf(bytes);
  const paginas = doc.getPageCount();
  if (paginas < 1) throw new Error("El PDF no tiene páginas legibles.");
  return paginas;
}

/* Arma un documento NUEVO con algunas páginas de otro. Es la pieza que comparten
   unir, dividir y comprimir: el archivo de salida se crea vacío y se le traen páginas.
   copyPages renumera cada objeto que viaja con la página,
   hereda /Resources y /MediaBox y corta /Parent. */
async function copiarPaginas(destino, origen, indices) {
  const copiadas = await destino.copyPages(origen, indices);
  copiadas.forEach((pagina) => destino.addPage(pagina));
}
