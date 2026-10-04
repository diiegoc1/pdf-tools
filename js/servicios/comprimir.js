/* ============================================================
   SERVICIO · COMPRIMIR
   Conviene mirar primero el archivo con "Explorar PDF": el peso
   no siempre está en las imágenes. Este servicio hace cuatro pasadas:
     1. borrar metadatos y datos privados de los programas de diseño   (sin pérdida)
     2. recodificar imágenes a JPEG y achicarlas              (CON pérdida, solo si el nivel lo pide)
     3. quitar relleno y comprimir lo que venía sin comprimir (sin pérdida)
     4. reconstruir el documento desde el árbol de páginas    (sin pérdida)
   ============================================================ */

const NIVELES = {
  ligera: { calidad: null, lado: null }, // no toca ninguna imagen
  recomendada: { calidad: 0.75, lado: 1600 }, // JPEG calidad 75, lado máximo 1600 px
  extrema: { calidad: 0.45, lado: 1000 },
};

// Datos que ningún lector muestra: se pueden borrar sin cambiar cómo se ve el documento.
const CLAVES_DESCARTABLES = [
  "Metadata",
  "PieceInfo",
  "LastModified",
  "StructTreeRoot",
  "MarkInfo",
];

SERVICIOS.comprimir = async function (archivos, opciones, avisar) {
  const { PDFDict, PDFRawStream, PDFName } = PDFLib;
  const archivo = archivos[0];
  const ajustes = NIVELES[opciones.nivel] || NIVELES.recomendada;
  const origen = await abrirPdf(archivo.bytes);
  const objetos = origen.context.enumerateIndirectObjects(); // [[ref, objeto], ...]

  // IMPORTANTE: todo se transforma sobre el documento ORIGINAL, antes de copiar.
  // Ahí cada referencia (por ejemplo, el espacio de color de una imagen) todavía
  // apunta al objeto correcto. Si copiáramos primero, las referencias ya estarían
  // renumeradas y las buscaríamos en el documento equivocado.

  // Pasada 1: metadatos.
  avisar("Borrando metadatos…");
  for (const [, objeto] of objetos) {
    const dic = objeto instanceof PDFDict ? objeto : objeto.dict;
    if (dic instanceof PDFDict) {
      for (const clave of CLAVES_DESCARTABLES) dic.delete(PDFName.of(clave));
    }
  }

  // Pasadas 2 y 3: streams.
  let imagenes = 0,
    recomprimidos = 0;
  for (const [ref, objeto] of objetos) {
    if (!(objeto instanceof PDFRawStream)) continue;
    // Metadatos (ya desenganchados) e índices: no llegan al archivo final, no vale la pena tocarlos.
    if (
      ["Metadata", "XRef", "ObjStm"].includes(
        nombreDe(objeto.dict.lookup(PDFName.of("Type"))),
      )
    )
      continue;
    if (ajustes.calidad !== null && esImagen(objeto)) {
      avisar(`Recodificando imágenes… (${imagenes + 1})`);
      const nueva = await recodificarImagen(objeto, origen, ajustes);
      if (nueva) {
        origen.context.assign(ref, nueva); // el mismo número de objeto pasa a tener el stream nuevo
        imagenes++;
        continue;
      }
      // Si no se pudo (o no convenía) recodificarla, sigue a la pasada sin pérdida.
    }
    const optimizado = await optimizarSinPerdida(objeto, origen);
    if (optimizado) {
      origen.context.assign(ref, optimizado);
      recomprimidos++;
    }
  }

  // Pasada 4: documento nuevo con las mismas páginas. Todo objeto al que ya nadie llega
  // (versiones viejas de un archivo editado, páginas borradas, los metadatos que soltamos)
  // se queda afuera sin necesidad de detectarlo.
  avisar("Reconstruyendo el documento…");
  const destino = await PDFLib.PDFDocument.create();
  await copiarPaginas(destino, origen, origen.getPageIndices());
  const titulo = origen.getTitle();
  if (titulo) destino.setTitle(titulo);
  const bytes = await destino.save({ useObjectStreams: true });

  const antes = archivo.bytes.length,
    despues = bytes.length;
  if (despues >= antes) {
    // Misma regla que con cada stream: si no mejoró, se deja el original.
    return {
      tipo: "descargas",
      mensaje:
        "Este archivo ya estaba optimizado: el resultado no era más chico, así que te devolvemos el original.",
      archivos: [{ nombre: archivo.nombre, bytes: archivo.bytes }],
    };
  }
  let mensaje = `Reducido un ${porcentaje(1 - despues / antes)} · de ${formatearBytes(antes)} a ${formatearBytes(despues)}.`;
  if (imagenes)
    mensaje += ` ${imagenes} ${imagenes === 1 ? "imagen recodificada" : "imágenes recodificadas"}.`;
  if (recomprimidos)
    mensaje += ` ${recomprimidos} ${recomprimidos === 1 ? "stream optimizado" : "streams optimizados"} sin pérdida.`;
  return {
    tipo: "descargas",
    mensaje,
    archivos: [
      { nombre: nombreSinExtension(archivo.nombre) + "-comprimido.pdf", bytes },
    ],
  };
};

/* ---------- Ayudantes para leer objetos de pdf-lib ---------- */
function nombreDe(objeto) {
  // PDFName "/FlateDecode" → "FlateDecode"
  return objeto instanceof PDFLib.PDFName ? objeto.asString().slice(1) : null;
}
function listaDeFiltros(dic) {
  // /Filter puede ser un nombre o un array de nombres
  const f = dic.lookup(PDFLib.PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFLib.PDFArray)
    return f.asArray().map((x) => nombreDe(dic.context.lookup(x)));
  return [nombreDe(f)];
}
function listaDeParametros(dic, cantidad) {
  // /DecodeParms: un diccionario, o un array con uno por filtro
  const p = dic.lookup(PDFLib.PDFName.of("DecodeParms"));
  const convertir = (d) => {
    if (!(d instanceof PDFLib.PDFDict)) return {};
    const salida = {};
    for (const [clave, valor] of d.entries()) {
      if (valor instanceof PDFLib.PDFNumber)
        salida[nombreDe(clave)] = valor.asNumber();
    }
    return salida;
  };
  if (p instanceof PDFLib.PDFArray)
    return p.asArray().map((x) => convertir(dic.context.lookup(x)));
  const unico = convertir(p);
  return Array.from({ length: cantidad }, (_, i) =>
    i === cantidad - 1 ? unico : {},
  );
}
function numeroDe(dic, clave) {
  const v = dic.lookup(PDFLib.PDFName.of(clave));
  return v instanceof PDFLib.PDFNumber ? v.asNumber() : null;
}

function esImagen(stream) {
  return nombreDe(stream.dict.lookup(PDFLib.PDFName.of("Subtype"))) === "Image";
}

/* ¿Cuántos canales de color tiene la imagen? 1 (gris), 3 (RGB) o null si no la sabemos convertir. */
function canalesDe(dic) {
  const cs = dic.lookup(PDFLib.PDFName.of("ColorSpace")); // lookup sigue las referencias "12 0 R"
  const nombre = nombreDe(cs);
  if (nombre === "DeviceRGB") return 3;
  if (nombre === "DeviceGray") return 1;
  // [/ICCBased 12 0 R]: un perfil de color; su /N dice cuántos canales tiene.
  if (cs instanceof PDFLib.PDFArray && nombreDe(cs.lookup(0)) === "ICCBased") {
    const n = numeroDe(cs.lookup(1).dict, "N");
    return n === 3 || n === 1 ? n : null;
  }
  return null; // CMYK, paletas (Indexed), etc.: quedan afuera
}

/* ---------- Pasada 2: recodificar una imagen con <canvas> ----------
   Los píxeles van a un ImageData (o, si ya era JPEG, el navegador lo abre directo),
   se dibujan en un canvas del tamaño nuevo y el canvas se exporta como JPEG
   con la calidad que queramos. */
async function recodificarImagen(stream, origen, ajustes) {
  const dic = stream.dict;
  const N = PDFLib.PDFName.of;
  // Casos que no tocamos: máscaras, transparencias por color, decodificación invertida.
  if (dic.get(N("ImageMask")) || dic.get(N("Mask")) || dic.get(N("Decode")))
    return null;
  const canales = canalesDe(dic);
  const ancho = numeroDe(dic, "Width"),
    alto = numeroDe(dic, "Height");
  if (!canales || !ancho || !alto) return null;

  let imagen; // algo que se pueda dibujar en un canvas
  try {
    const filtros = listaDeFiltros(dic);
    const { datos, pendientes } = await decodificar(
      stream.contents,
      filtros,
      listaDeParametros(dic, filtros.length),
    );
    if (pendientes.length === 1 && pendientes[0] === "DCTDecode") {
      // Ya era un JPEG: el navegador lo sabe abrir directamente.
      imagen = await createImageBitmap(
        new Blob([datos], { type: "image/jpeg" }),
      );
    } else if (
      pendientes.length === 0 &&
      numeroDe(dic, "BitsPerComponent") === 8
    ) {
      // Muestras crudas, un byte por canal: las pasamos a RGBA (4 bytes por píxel).
      if (datos.length < ancho * alto * canales) return null;
      const pixeles = new ImageData(ancho, alto);
      for (let i = 0, j = 0; i < ancho * alto; i++, j += canales) {
        pixeles.data[i * 4] = datos[j];
        pixeles.data[i * 4 + 1] = datos[j + (canales === 3 ? 1 : 0)];
        pixeles.data[i * 4 + 2] = datos[j + (canales === 3 ? 2 : 0)];
        pixeles.data[i * 4 + 3] = 255; // opaco
      }
      imagen = await createImageBitmap(pixeles);
    } else {
      return null; // JPEG 2000, CCITT, 1 bit por canal...: no los tocamos
    }
  } catch (error) {
    console.warn("Imagen salteada:", error.message);
    return null;
  }

  // Achicar si hace falta, conservando la proporción.
  const escala = Math.min(1, ajustes.lado / Math.max(ancho, alto));
  const nuevoAncho = Math.max(1, Math.round(ancho * escala));
  const nuevoAlto = Math.max(1, Math.round(alto * escala));
  const lienzo = new OffscreenCanvas(nuevoAncho, nuevoAlto); // un canvas que no está en la página
  lienzo.getContext("2d").drawImage(imagen, 0, 0, nuevoAncho, nuevoAlto);
  const blob = await lienzo.convertToBlob({
    type: "image/jpeg",
    quality: ajustes.calidad,
  });
  const jpeg = new Uint8Array(await blob.arrayBuffer());

  if (jpeg.length >= stream.contents.length) return null; // no mejoró: se deja la original

  const nuevoDic = origen.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: nuevoAncho,
    Height: nuevoAlto,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "DCTDecode",
  });
  // La transparencia va en otro objeto (/SMask): se conserva tal cual.
  for (const clave of ["SMask", "Interpolate", "Intent"]) {
    if (dic.get(N(clave))) nuevoDic.set(N(clave), dic.get(N(clave)));
  }
  return PDFLib.PDFRawStream.of(nuevoDic, jpeg);
}

/* ---------- Pasada 3: optimizar sin pérdida ----------
   CompressionStream no deja elegir el nivel de compresión, así que hacemos dos cosas seguras:
     a) quitar las capas de texto (ASCII85, ASCIIHex): son relleno, agregan 25 % a 100 %;
     b) comprimir con deflate lo que quedó sin ningún filtro.
   Regla de oro: si el resultado no es más chico, se deja el original. */
const CAPAS_DE_TEXTO = ["ASCII85Decode", "ASCIIHexDecode"];

async function optimizarSinPerdida(stream, origen) {
  const N = PDFLib.PDFName.of;
  const dic = stream.dict;
  let filtros = listaDeFiltros(dic);
  let datos = stream.contents;
  const parametros = dic.lookup(N("DecodeParms"));

  // a) Capas de texto al principio de la cadena.
  let capas = 0;
  while (CAPAS_DE_TEXTO.includes(filtros[capas])) capas++;
  if (capas > 0) {
    // Si /DecodeParms es un solo diccionario para varios filtros, no sabemos a cuál corresponde: no tocamos.
    if (
      parametros &&
      !(parametros instanceof PDFLib.PDFArray) &&
      filtros.length > 1
    )
      return null;
    ({ datos } = await decodificar(datos, filtros.slice(0, capas)));
    filtros = filtros.slice(capas);
  }

  // b) Sin ningún filtro: deflate.
  if (filtros.length === 0 && datos.length >= 64) {
    const salida = new Blob([datos])
      .stream()
      .pipeThrough(new CompressionStream("deflate"));
    const comprimido = new Uint8Array(await new Response(salida).arrayBuffer());
    if (comprimido.length < datos.length) {
      datos = comprimido;
      filtros = ["FlateDecode"];
    }
  }

  if (datos.length >= stream.contents.length) return null; // no mejoró

  const nuevoDic = dic.clone(origen.context);
  if (filtros.length === 0) nuevoDic.delete(N("Filter"));
  else
    nuevoDic.set(
      N("Filter"),
      filtros.length === 1 ? N(filtros[0]) : origen.context.obj(filtros),
    );
  if (capas > 0 && parametros instanceof PDFLib.PDFArray) {
    const resto = parametros.asArray().slice(capas); // los parámetros de las capas quitadas se van con ellas
    nuevoDic.set(
      N("DecodeParms"),
      resto.length === 1 ? resto[0] : origen.context.obj(resto),
    );
  }
  return PDFLib.PDFRawStream.of(nuevoDic, datos);
}
