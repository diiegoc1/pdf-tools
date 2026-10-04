/* ============================================================
   SERVICIO · DIVIDIR
   La operación inversa de unir: se arma un documento nuevo por
   cada grupo de páginas que pidió el usuario.
   ============================================================ */

/* Entiende lo que escribe el usuario, como en cualquier diálogo de impresión:
     "1-3,7,10-"  → [ {desde:1,hasta:3}, {desde:7,hasta:7}, {desde:10,hasta:total} ]
   Los extremos pueden faltar ("-3" = desde el principio, "10-" = hasta el final)
   y los valores fuera de rango se recortan en lugar de dar error. */
function interpretarRangos(texto, total) {
  const grupos = [];
  for (const parte of texto.split(",")) {
    const limpio = parte.trim();
    if (limpio === "") continue; // "1-3,,7" o una coma final
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(limpio);
    if (!m || (m[1] === "" && m[2] === "")) {
      throw new Error(`No entiendo «${limpio}». Escribilo como 1-3,7,10-`);
    }
    let desde, hasta;
    if (m[2] === "") {
      // sin guion: una sola página, "7"
      desde = hasta = Number(m[1]);
    } else {
      desde = m[1] === "" ? 1 : Number(m[1]); // extremos opcionales
      hasta = m[3] === "" ? total : Number(m[3]);
    }
    desde = Math.max(1, Math.min(desde, total)); // fuera de rango: se recorta
    hasta = Math.max(1, Math.min(hasta, total));
    if (desde > hasta) [desde, hasta] = [hasta, desde]; // "7-3" se lee al revés
    grupos.push({ desde, hasta });
  }
  if (grupos.length === 0)
    throw new Error("Escribí al menos un rango de páginas.");
  return grupos;
}

SERVICIOS.dividir = async function (archivos, opciones, avisar) {
  const archivo = archivos[0];
  const origen = await abrirPdf(archivo.bytes);
  const total = origen.getPageCount();

  // Sin rangos: cada página por separado.
  const grupos = opciones.rangos
    ? interpretarRangos(opciones.rangos, total)
    : Array.from({ length: total }, (_, i) => ({ desde: i + 1, hasta: i + 1 }));

  const base = nombreSinExtension(archivo.nombre);
  const salida = [];
  for (const [i, grupo] of grupos.entries()) {
    avisar(`Armando el archivo ${i + 1} de ${grupos.length}…`);
    const destino = await PDFLib.PDFDocument.create();
    // Las páginas se numeran desde 1 para el usuario y desde 0 para la librería.
    const indices = [];
    for (let p = grupo.desde; p <= grupo.hasta; p++) indices.push(p - 1);
    await copiarPaginas(destino, origen, indices);
    const rango =
      grupo.desde === grupo.hasta
        ? `p${grupo.desde}`
        : `p${grupo.desde}-${grupo.hasta}`;
    salida.push({
      nombre: `${base}-${rango}.pdf`,
      bytes: await destino.save({ useObjectStreams: true }),
    });
  }

  return {
    tipo: "descargas",
    mensaje:
      salida.length > 1
        ? `Listo: ${salida.length} archivos.`
        : grupos[0].desde === grupos[0].hasta
          ? `Listo: 1 archivo con la página ${grupos[0].desde}.`
          : `Listo: 1 archivo con las páginas ${grupos[0].desde} a ${grupos[0].hasta}.`,
    archivos: salida,
  };
};
