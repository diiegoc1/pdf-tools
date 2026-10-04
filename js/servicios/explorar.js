/* ============================================================
   SERVICIO · EXPLORAR
   Usa el motor hecho a mano para contar cómo está armado un PDF.
   Recibe datos y devuelve datos: no toca la página.
   ============================================================ */
SERVICIOS.explorar = async function (archivos, opciones, avisar) {
  const { nombre, bytes } = archivos[0];
  const informe = {
    nombre,
    tamano: bytes.length,
    version: versionPdf(bytes),
    inicio: volcado(bytes, 0, 64),
    final: volcado(bytes, Math.max(0, bytes.length - 160), 160),
    avisos: [],
  };

  avisar("Buscando el índice…");
  // El archivo entero como texto (latin1): así podemos usar indexOf y expresiones regulares.
  const texto = bytesATexto(bytes);
  informe.startxref = buscarStartxref(bytes);

  // 1) Intentamos leer el índice. 2) Verificamos cada salto. 3) Si no sirve, lo reconstruimos.
  let indice = null;
  try {
    indice = await leerIndice(bytes, texto);
    const malas = contarEntradasMalas(texto, indice.entradas);
    if (malas > 0) {
      informe.avisos.push(
        `${malas} entradas del índice apuntan a un lugar equivocado.`,
      );
      indice = null;
    }
  } catch (error) {
    informe.avisos.push(error.message);
  }
  if (!indice) {
    avisar("El índice no sirve: reconstruyéndolo…");
    indice = reconstruirIndice(texto);
    informe.avisos.push(
      'Se descartó el índice y se reconstruyó uno nuevo recorriendo todo el archivo en busca de "N G obj". ' +
        "El contenido estaba bien: el problema era solo el índice.",
    );
  }
  informe.indice = resumirIndice(
    indice.secciones,
    indice.entradas,
    indice.trailer,
  );

  avisar("Describiendo los objetos…");
  informe.objetos = await listarObjetos(bytes, texto, indice.entradas);
  informe.paginas = informe.objetos.filter((o) => o.tipo === "Page").length;

  // Suma de bytes por categoría. Lo que no es ningún objeto (cabecera, índice, tráiler) va aparte.
  const suma = new Map();
  let contados = 0;
  for (const o of informe.objetos) {
    if (o.tamano === null) continue;
    suma.set(o.categoria, (suma.get(o.categoria) || 0) + o.tamano);
    contados += o.tamano;
  }
  suma.set("Índice, tráiler y cabecera", Math.max(0, bytes.length - contados));
  informe.categorias = [...suma]
    .map(([nombre, total]) => ({ nombre, bytes: total }))
    .filter((c) => c.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return { tipo: "informe", informe };
};

/* Prepara el índice para mostrarlo: la interfaz no necesita el Map completo. */
function resumirIndice(secciones, entradas, trailer) {
  const resumen = {
    descripcion:
      secciones.length === 0
        ? "reconstruido"
        : secciones.map((s) => s.tipo).join(" + ") +
          (secciones.length > 1 ? ` (${secciones.length} secciones)` : ""),
    raiz: leerRef(trailer, "Root"),
    trailer,
    secciones: secciones.map((s) => ({
      tipo: s.tipo,
      posicion: s.posicion,
      cantidad: s.entradas.size,
    })),
  };
  return resumen;
}
