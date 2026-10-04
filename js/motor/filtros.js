/* ============================================================
   MOTOR · FILTROS
   Los streams de un PDF casi siempre vienen codificados. La clave
   /Filter dice cómo: /FlateDecode es zlib (lo mismo que un .zip).
   El navegador ya trae un descompresor: DecompressionStream.
   ============================================================ */

/* Descomprime datos zlib ('deflate'). Es asíncrono: devuelve una promesa. */
async function inflar(bytes) {
  const lector = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const partes = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      partes.push(value);
      total += value.length;
    }
  } catch (error) {
    // Muchos PDF traen un par de bytes de más después de los datos comprimidos
    // (un salto de línea antes de 'endstream'). El descompresor se queja al final,
    // pero para entonces ya entregó todo: nos quedamos con lo que salió.
    if (total === 0) throw new Error("No se pudo descomprimir el stream.");
  }
  return unirPartes(partes, total);
}

function unirPartes(partes, total) {
  const salida = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    salida.set(parte, posicion);
    posicion += parte.length;
  }
  return salida;
}

/* Predictores PNG (/Predictor 10 a 15). Antes de comprimir, cada fila se guardó
   como DIFERENCIA con sus vecinos, porque las diferencias comprimen mejor.
   Cada fila empieza con un byte que dice qué vecino se usó; acá deshacemos eso. */
function deshacerPredictorPng(datos, columnas, colores = 1, bits = 8) {
  const bpp = Math.max(1, Math.ceil((colores * bits) / 8)); // bytes por píxel
  const ancho = Math.ceil((columnas * colores * bits) / 8); // bytes por fila (sin el byte de tipo)
  const filas = Math.floor(datos.length / (ancho + 1));
  const salida = new Uint8Array(filas * ancho);

  for (let f = 0; f < filas; f++) {
    const tipo = datos[f * (ancho + 1)];
    const origen = f * (ancho + 1) + 1;
    const destino = f * ancho;
    for (let i = 0; i < ancho; i++) {
      const crudo = datos[origen + i];
      const izquierda = i >= bpp ? salida[destino + i - bpp] : 0;
      const arriba = f > 0 ? salida[destino - ancho + i] : 0;
      const diagonal =
        f > 0 && i >= bpp ? salida[destino - ancho + i - bpp] : 0;
      let valor;
      switch (tipo) {
        case 0:
          valor = crudo;
          break; // None
        case 1:
          valor = crudo + izquierda;
          break; // Sub
        case 2:
          valor = crudo + arriba;
          break; // Up (el más común en índices)
        case 3:
          valor = crudo + ((izquierda + arriba) >> 1);
          break; // Average
        case 4:
          valor = crudo + paeth(izquierda, arriba, diagonal);
          break;
        default:
          throw new Error("Fila con un predictor PNG desconocido: " + tipo);
      }
      salida[destino + i] = valor; // un Uint8Array guarda solo 8 bits: 300 se guarda como 44 (la suma "da la vuelta")
    }
  }
  return salida;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ASCII85: cada 5 caracteres imprimibles guardan 4 bytes. Es de la época en que los
   PDF viajaban por canales que solo aceptaban texto; hoy solo agrega un 25 % de peso. */
function deshacerAscii85(datos) {
  const salida = new Uint8Array(Math.ceil((datos.length * 4) / 5) + 4);
  let largo = 0,
    grupo = 0,
    cantidad = 0;
  for (let i = 0; i < datos.length; i++) {
    const c = datos[i];
    if (c === 0x7e) break; // '~' de la marca de cierre '~>'
    if (c <= 0x20) continue; // espacios y saltos de línea se ignoran
    if (c === 0x7a && cantidad === 0) {
      // 'z' abrevia cuatro bytes en cero
      largo += 4;
      continue;
    }
    grupo = grupo * 85 + (c - 33);
    if (++cantidad === 5) {
      salida[largo++] = grupo >>> 24;
      salida[largo++] = (grupo >>> 16) & 255;
      salida[largo++] = (grupo >>> 8) & 255;
      salida[largo++] = grupo & 255;
      grupo = 0;
      cantidad = 0;
    }
  }
  if (cantidad > 0) {
    // grupo final incompleto: se rellena con 'u'
    for (let k = cantidad; k < 5; k++) grupo = grupo * 85 + 84;
    const ultimos = [
      grupo >>> 24,
      (grupo >>> 16) & 255,
      (grupo >>> 8) & 255,
      grupo & 255,
    ];
    for (let k = 0; k < cantidad - 1; k++) salida[largo++] = ultimos[k];
  }
  return salida.subarray(0, largo);
}

/* ASCIIHex: cada byte escrito como dos dígitos hexadecimales, "48656c6c6f>". */
function deshacerAsciiHex(datos) {
  const digitos = bytesATexto(datos)
    .replace(/>.*$/s, "")
    .replace(/[^0-9a-fA-F]/g, "");
  const salida = new Uint8Array(Math.ceil(digitos.length / 2));
  for (let i = 0; i < salida.length; i++) {
    salida[i] = parseInt((digitos.substr(i * 2, 2) + "0").slice(0, 2), 16);
  }
  return salida;
}

/* Aplica una cadena de filtros: /Filter [/ASCII85Decode /FlateDecode].
   Se detiene en el primero que no conoce (por ejemplo /DCTDecode, que ya es un JPEG)
   y devuelve los datos junto con los filtros que quedaron pendientes. */
async function decodificar(datos, filtros, parametros = []) {
  for (let i = 0; i < filtros.length; i++) {
    const p = parametros[i] || {};
    switch (filtros[i]) {
      case "FlateDecode": {
        datos = await inflar(datos);
        const predictor = p.Predictor || 1;
        if (predictor >= 10) {
          datos = deshacerPredictorPng(
            datos,
            p.Columns || 1,
            p.Colors || 1,
            p.BitsPerComponent || 8,
          );
        } else if (predictor !== 1) {
          throw new Error("Predictor TIFF (2): no soportado.");
        }
        break;
      }
      case "ASCII85Decode":
        datos = deshacerAscii85(datos);
        break;
      case "ASCIIHexDecode":
        datos = deshacerAsciiHex(datos);
        break;
      default:
        return { datos, pendientes: filtros.slice(i) };
    }
  }
  return { datos, pendientes: [] };
}
