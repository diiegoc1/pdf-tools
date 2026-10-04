/* ============================================================
   MOTOR · LECTOR DE PDF (hecho a mano)
   Sabe encontrar el índice de un PDF y describir sus objetos.
   No sabe para qué se lo usa: lo llama el servicio "explorar".
   No es un parser completo; alcanza para explorar y aprender.
   ============================================================ */

/* ---------- Empezar por el final ----------
   Las últimas líneas de todo PDF son:
       startxref
       116524        ← byte donde empieza el índice
       %%EOF
   Leemos solo los últimos 2 KB: nunca hace falta recorrer el archivo entero. */
function buscarStartxref(bytes) {
  const desde = Math.max(0, bytes.length - 2048);
  const cola = bytesATexto(bytes, desde);
  // lastIndexOf y no indexOf: un PDF editado varias veces tiene varios startxref y vale el ÚLTIMO.
  const p = cola.lastIndexOf("startxref");
  if (p === -1) return null;
  const m = /^\s*(\d+)/.exec(cola.slice(p + "startxref".length));
  return m ? Number(m[1]) : null;
}

/* ---------- Diccionarios: << /Clave valor ... >> ----------
   Devuelve el texto del diccionario que empieza en 'desde' y la posición donde termina.
   Hay que contar la profundidad porque un diccionario puede tener otros adentro. */
function leerDiccionario(texto, desde) {
  const inicio = texto.indexOf("<<", desde);
  if (inicio === -1) return null;
  let profundidad = 0;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i],
      siguiente = texto[i + 1];
    if (c === "(") {
      // (un texto) puede contener << o >> sin significado
      i = saltarCadena(texto, i);
    } else if (c === "<" && siguiente === "<") {
      profundidad++;
      i++;
    } else if (c === "<") {
      // <48656c6c6f> es un texto en hexadecimal
      i = texto.indexOf(">", i);
      if (i === -1) return null;
    } else if (c === ">" && siguiente === ">") {
      profundidad--;
      i++;
      if (profundidad === 0)
        return { dic: texto.slice(inicio, i + 1), fin: i + 1 };
    }
  }
  return null;
}

/* Los textos literales van entre paréntesis, pueden anidarse "(a (b) c)" y escapar con \ */
function saltarCadena(texto, i) {
  let nivel = 0;
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "(") nivel++;
    else if (c === ")" && --nivel === 0) return i;
  }
  return texto.length;
}

/* ---------- Leer valores de un diccionario con expresiones regulares ----------
   \b evita confundir /Length con /Length1. Es una lectura "de explorador":
   si la clave aparece también en un diccionario interno, gana la primera. */
function leerNombre(dic, clave) {
  // /Type /Page  → "Page"
  const m = new RegExp("/" + clave + "\\b\\s*/([^\\s/<>\\[\\]()]+)").exec(dic);
  return m ? m[1] : null;
}
function leerNumero(dic, clave) {
  // /Size 30 → 30   (pero /Length 12 0 R es una referencia: null)
  const m = new RegExp(
    "/" + clave + "\\b\\s*(-?\\d+)\\b(?!\\s+\\d+\\s+R)",
  ).exec(dic);
  return m ? Number(m[1]) : null;
}
function leerRef(dic, clave) {
  // /Root 29 0 R → "29 0 R"
  const m = new RegExp("/" + clave + "\\b\\s*(\\d+)\\s+(\\d+)\\s+R").exec(dic);
  return m ? `${m[1]} ${m[2]} R` : null;
}
function leerArray(dic, clave) {
  // /W [1 2 1] → [1, 2, 1]
  const m = new RegExp("/" + clave + "\\b\\s*\\[([^\\]]*)\\]").exec(dic);
  return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : null;
}
function leerFiltros(dic) {
  // /Filter /FlateDecode  o  /Filter [/ASCII85Decode /DCTDecode]
  const m = /\/Filter\b\s*(\[[^\]]*\]|\/[^\s/<>\[\]()]+)/.exec(dic);
  return m ? [...m[1].matchAll(/\/([^\s/<>\[\]()]+)/g)].map((x) => x[1]) : [];
}
function leerParametros(dic) {
  // /DecodeParms << /Predictor 12 /Columns 5 >>
  return [
    {
      Predictor: leerNumero(dic, "Predictor"),
      Columns: leerNumero(dic, "Columns"),
      Colors: leerNumero(dic, "Colors"),
      BitsPerComponent: leerNumero(dic, "BitsPerComponent"),
    },
  ];
}

/* ---------- La tabla clásica ----------
       xref
       0 30                       ← subsección: desde el objeto 0, 30 entradas
       0000000000 65535 f         ← cada entrada: 20 bytes exactos
       0000000015 00000 n         ← el objeto 1 empieza en el byte 15
       ...
       trailer
       << /Size 30 /Root 29 0 R >>
   Usamos expresiones "pegajosas" (flag y): solo coinciden EXACTAMENTE en lastIndex,
   como un cursor que avanza por el texto. */
function leerTablaClasica(texto, posicion) {
  const inicio = /\s*xref/y;
  inicio.lastIndex = posicion;
  if (!inicio.test(texto)) return null; // en esa posición no hay una tabla clásica
  let cursor = inicio.lastIndex;

  const subseccion = /\s*(\d+)\s+(\d+)/y;
  const entrada = /\s*(\d{10})\s+(\d{5})\s+([nf])/y;
  const entradas = new Map(); // número de objeto → dónde está

  while (true) {
    subseccion.lastIndex = cursor;
    const s = subseccion.exec(texto);
    if (!s) break; // no hay más subsecciones: sigue la palabra trailer
    const primero = Number(s[1]),
      cantidad = Number(s[2]);
    cursor = subseccion.lastIndex;
    for (let i = 0; i < cantidad; i++) {
      entrada.lastIndex = cursor;
      const e = entrada.exec(texto);
      if (!e)
        throw new Error(
          `La entrada del objeto ${primero + i} de la tabla xref es ilegible.`,
        );
      cursor = entrada.lastIndex;
      entradas.set(
        primero + i,
        e[3] === "n"
          ? { tipo: 1, posicion: Number(e[1]), generacion: Number(e[2]) } // n: en uso
          : { tipo: 0 },
      ); // f: libre (free)
    }
  }
  const t = texto.indexOf("trailer", cursor);
  const trailer = t === -1 ? null : leerDiccionario(texto, t);
  return {
    tipo: "clásica",
    posicion,
    entradas,
    trailer: trailer ? trailer.dic : "",
  };
}

/* ---------- El índice completo: la cadena de ediciones ----------
   Cada vez que se edita un PDF "incrementalmente" se agrega al final una sección
   nueva que apunta a la anterior con /Prev. Vamos de la más nueva a la más vieja
   y la PRIMERA versión que aparece de cada objeto es la que vale. */
async function leerIndice(bytes, texto) {
  const secciones = [];
  const entradas = new Map();
  const visitadas = new Set(); // por si un /Prev apunta en círculo
  let posicion = buscarStartxref(bytes);
  if (posicion === null)
    throw new Error('No se encontró "startxref" al final del archivo.');

  while (posicion !== null && !visitadas.has(posicion)) {
    visitadas.add(posicion);
    const seccion =
      leerTablaClasica(texto, posicion) ||
      (await leerTablaComprimida(bytes, texto, posicion));
    if (!seccion)
      throw new Error(
        `En el byte ${posicion} no hay ninguna tabla de referencias.`,
      );
    secciones.push(seccion);

    // Archivos "híbridos": tabla clásica + una comprimida escondida en /XRefStm.
    const escondida =
      seccion.tipo === "clásica"
        ? leerNumero(seccion.trailer, "XRefStm")
        : null;
    if (escondida !== null) {
      const extra = await leerTablaComprimida(bytes, texto, escondida);
      if (extra) {
        secciones.push(extra);
        for (const [n, e] of extra.entradas)
          if (!entradas.has(n) && e.tipo !== 0) entradas.set(n, e);
      }
    }
    for (const [n, e] of seccion.entradas) {
      if (!entradas.has(n)) entradas.set(n, e);
    }
    posicion = leerNumero(seccion.trailer, "Prev");
  }
  return { secciones, entradas, trailer: secciones[0].trailer };
}

/* ---------- Verificar cada salto ----------
   Un archivo cortado o mal reparado tiene un índice que apunta a lugares equivocados.
   Vamos a cada posición y comprobamos que ahí empiece "N G obj" con el número esperado. */
function contarEntradasMalas(texto, entradas) {
  let malas = 0;
  const cabecera = /\s*(\d+)\s+(\d+)\s+obj\b/y;
  for (const [n, e] of entradas) {
    if (e.tipo !== 1) continue;
    cabecera.lastIndex = e.posicion;
    const m = cabecera.exec(texto);
    if (!m || Number(m[1]) !== n) malas++;
  }
  return malas;
}

/* ---------- Reconstruir el índice ----------
   Último recurso: recorrer TODO el archivo buscando "N G obj".
   Lleva más tiempo, por eso solo se usa si el índice falla. */
function reconstruirIndice(texto) {
  const entradas = new Map();
  for (const m of texto.matchAll(/(?<!\d)(\d+)\s+(\d+)\s+obj\b/g)) {
    // Gana la última aparición: es la versión más reciente del objeto.
    entradas.set(Number(m[1]), {
      tipo: 1,
      posicion: m.index,
      generacion: Number(m[2]),
    });
  }
  const t = texto.lastIndexOf("trailer");
  const trailer = t === -1 ? null : leerDiccionario(texto, t);
  return { secciones: [], entradas, trailer: trailer ? trailer.dic : "" };
}

/* ---------- Los bytes de un stream ----------
   12 0 obj << /Length 350 /Filter /FlateDecode >> stream
   ...350 bytes...
   endstream endobj                                                                   */
function datosDeStream(bytes, texto, diccionario) {
  let inicio = texto.indexOf("stream", diccionario.fin) + "stream".length;
  if (texto[inicio] === "\r") inicio++; // después de 'stream' viene \r\n o \n
  if (texto[inicio] === "\n") inicio++;
  let largo = leerNumero(diccionario.dic, "Length");
  // Si /Length es una referencia (12 0 R) o está mal, medimos hasta 'endstream'.
  if (
    largo === null ||
    !texto.slice(inicio + largo, inicio + largo + 12).includes("endstream")
  ) {
    largo = texto.indexOf("endstream", inicio) - inicio;
  }
  return bytes.subarray(inicio, inicio + largo);
}

/* ---------- La tabla comprimida (PDF 1.5+) ----------
   El índice es un objeto más: << /Type /XRef /W [1 2 1] /Filter /FlateDecode >> stream.
   Descomprimido, es binario: cada entrada ocupa 1+2+1 bytes (lo que diga /W).
     tipo 0: libre · tipo 1: objeto suelto en un byte · tipo 2: objeto EMPAQUETADO dentro de otro */
async function leerTablaComprimida(bytes, texto, posicion) {
  const cabecera = /\s*\d+\s+\d+\s+obj/y;
  cabecera.lastIndex = posicion;
  if (!cabecera.test(texto)) return null;
  const diccionario = leerDiccionario(texto, cabecera.lastIndex);
  if (!diccionario || leerNombre(diccionario.dic, "Type") !== "XRef")
    return null;

  const { datos } = await decodificar(
    datosDeStream(bytes, texto, diccionario),
    leerFiltros(diccionario.dic),
    leerParametros(diccionario.dic),
  );
  const anchos = leerArray(diccionario.dic, "W");
  const indice = leerArray(diccionario.dic, "Index") || [
    0,
    leerNumero(diccionario.dic, "Size"),
  ];

  const entradas = new Map();
  let q = 0;
  for (let k = 0; k < indice.length; k += 2) {
    for (let n = indice[k]; n < indice[k] + indice[k + 1]; n++) {
      const campos = anchos.map((cantidadBytes) => {
        if (cantidadBytes === 0) return null;
        let valor = 0;
        // Cada campo es un número "big-endian": el primer byte es el más significativo.
        // Usamos *256 y no << 8 porque en JS los operadores de bits trabajan con 32 bits con signo.
        for (let b = 0; b < cantidadBytes; b++)
          valor = valor * 256 + datos[q++];
        return valor;
      });
      // Un ancho de cero significa que el campo no está escrito y vale su valor por omisión:
      // tipo 1 para el primero, cero para los otros dos. Usamos ?? y no ||: con || un tipo 0 (libre) valdría 1.
      const tipo = campos[0] ?? 1,
        segundo = campos[1] ?? 0,
        tercero = campos[2] ?? 0;
      if (tipo === 1)
        entradas.set(n, { tipo: 1, posicion: segundo, generacion: tercero });
      else if (tipo === 2)
        entradas.set(n, { tipo: 2, contenedor: segundo, lugar: tercero });
      else entradas.set(n, { tipo: 0 });
    }
  }
  return { tipo: "comprimida", posicion, entradas, trailer: diccionario.dic };
}

/* ---------- Describir un objeto suelto ---------- */
function describirObjeto(bytes, texto, posicion) {
  const cabecera = /\s*\d+\s+\d+\s+obj\s*/y;
  cabecera.lastIndex = posicion;
  cabecera.exec(texto);
  const inicio = cabecera.lastIndex;

  const diccionario = texto.startsWith("<<", inicio)
    ? leerDiccionario(texto, inicio)
    : null;
  const esStream =
    diccionario !== null &&
    /^\s*stream/.test(texto.slice(diccionario.fin, diccionario.fin + 20));
  const desdeFin = esStream
    ? texto.indexOf("endstream", diccionario.fin)
    : inicio;
  const fin = texto.indexOf("endobj", desdeFin);

  let vista = diccionario
    ? diccionario.dic
    : texto.slice(inicio, fin === -1 ? inicio + 200 : fin).trim();
  if (esStream) vista += "\nstream\n… (datos binarios) …\nendstream";
  const dic = diccionario ? diccionario.dic : "";
  return {
    tamano: fin === -1 ? null : fin + "endobj".length - posicion,
    tipo: leerNombre(dic, "Type") || (esStream ? "(stream)" : "—"),
    categoria: clasificar(dic, esStream),
    vista: vista.length > 3000 ? vista.slice(0, 3000) + " …" : vista,
    esStream,
    diccionario,
  };
}

/* Categorías para el gráfico "De qué está hecho el peso". */
function clasificar(dic, esStream) {
  if (!esStream) return "Diccionarios y estructura";
  const tipo = leerNombre(dic, "Type"),
    subtipo = leerNombre(dic, "Subtype");
  if (subtipo === "Image")
    return leerFiltros(dic).includes("DCTDecode")
      ? "Imágenes JPEG"
      : "Imágenes sin pérdida";
  if (tipo === "Metadata") return "Metadatos";
  if (
    /\/Length[123]\b/.test(dic) ||
    ["Type1C", "CIDFontType0C", "OpenType"].includes(subtipo)
  )
    return "Tipografías";
  if (subtipo === "Form") return "Dibujos vectoriales";
  if (tipo === "XRef" || tipo === "ObjStm") return "Diccionarios y estructura";
  return "Contenido de las páginas y otros";
}

/* ---------- Listar todos los objetos ----------
   Los sueltos (tipo 1) se describen yendo a su posición. Los empaquetados (tipo 2)
   viven dentro de un stream /Type /ObjStm: hay que descomprimirlo y ubicarlos. */
async function listarObjetos(bytes, texto, entradas) {
  const objetos = [];
  for (const [numero, e] of entradas) {
    if (e.tipo !== 1) continue;
    const info = describirObjeto(bytes, texto, e.posicion);
    objetos.push({
      numero,
      generacion: e.generacion,
      donde: `byte ${e.posicion.toLocaleString("es-AR")}`,
      ...info,
    });
  }

  for (const contenedor of objetos.filter((o) => o.tipo === "ObjStm")) {
    const dic = contenedor.diccionario.dic;
    let datos;
    try {
      ({ datos } = await decodificar(
        datosDeStream(bytes, texto, contenedor.diccionario),
        leerFiltros(dic),
        leerParametros(dic),
      ));
    } catch {
      continue; // si no se puede abrir, lo salteamos
    }
    const contenido = bytesATexto(datos);
    const primero = leerNumero(dic, "First"); // dónde termina la cabecera "num pos num pos ..."
    const cantidad = leerNumero(dic, "N");
    const pares = contenido.slice(0, primero).trim().split(/\s+/).map(Number);
    for (let k = 0; k < cantidad; k++) {
      const numero = pares[2 * k],
        desde = pares[2 * k + 1];
      const hasta =
        k + 1 < cantidad ? pares[2 * k + 3] : contenido.length - primero;
      // Si el índice dice que la versión vigente del objeto está en otro lado, no lo contamos.
      const entrada = entradas.get(numero);
      if (
        entrada &&
        !(entrada.tipo === 2 && entrada.contenedor === contenedor.numero)
      )
        continue;
      const cuerpo = contenido.slice(primero + desde, primero + hasta).trim();
      objetos.push({
        numero,
        generacion: 0,
        donde: `dentro del objeto ${contenedor.numero}`,
        tamano: null, // su peso ya está contado en el contenedor
        tipo: leerNombre(cuerpo, "Type") || "—",
        categoria: "Diccionarios y estructura (empaquetado)",
        vista: cuerpo.length > 3000 ? cuerpo.slice(0, 3000) + " …" : cuerpo,
      });
    }
  }
  return objetos.sort((a, b) => a.numero - b.numero);
}
