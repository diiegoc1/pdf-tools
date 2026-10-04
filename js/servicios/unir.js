/* ============================================================
   SERVICIO · UNIR
   Unir NO es pegar un archivo detrás del otro: los dos numeran
   sus objetos desde el 1. Hay que traer las páginas de cada uno
   a un documento nuevo, renumerándolas. copyPages lo hace.
   ============================================================ */
SERVICIOS.unir = async function (archivos, opciones, avisar) {
  const destino = await PDFLib.PDFDocument.create();

  for (let i = 0; i < archivos.length; i++) {
    avisar(
      `Copiando «${archivos[i].nombre}» (${i + 1} de ${archivos.length})…`,
    );
    const origen = await abrirPdf(archivos[i].bytes);
    await copiarPaginas(destino, origen, origen.getPageIndices()); // [0, 1, 2, ...]: todas
  }

  avisar("Escribiendo el archivo…");
  // useObjectStreams: empaqueta los diccionarios chicos en streams comprimidos (PDF 1.5).
  const bytes = await destino.save({ useObjectStreams: true });

  return {
    tipo: "descargas",
    mensaje: `Se unieron ${archivos.length} documentos: ${destino.getPageCount()} páginas en total.`,
    archivos: [{ nombre: "unido.pdf", bytes }],
  };
};
