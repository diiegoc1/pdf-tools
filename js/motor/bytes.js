/* ============================================================
   MOTOR · BYTES
   Un PDF es una secuencia de bytes. Para buscar palabras clave
   (startxref, obj, trailer) lo convertimos a texto con 'latin1':
   cada byte se convierte en EXACTAMENTE un carácter, así que la
   posición de un carácter en el texto es la misma que la del byte
   en el archivo. Con UTF-8 eso no pasa: los bytes de una imagen
   se agrupan de a 2, 3 o 4 y las posiciones se corren.
   ============================================================ */
const decodificadorLatin1 = new TextDecoder("latin1");

/* Los bytes [desde, hasta) como texto. subarray NO copia: es una "ventana" sobre los mismos bytes. */
function bytesATexto(bytes, desde = 0, hasta = bytes.length) {
  return decodificadorLatin1.decode(bytes.subarray(desde, hasta));
}

/* La cabecera %PDF- tiene que estar en el primer kilobyte. */
function esPdf(bytes) {
  return bytesATexto(bytes, 0, Math.min(1024, bytes.length)).includes("%PDF-");
}

function versionPdf(bytes) {
  const m = /%PDF-(\d\.\d)/.exec(
    bytesATexto(bytes, 0, Math.min(1024, bytes.length)),
  );
  return m ? m[1] : "?";
}

/* Volcado hexadecimal, como el de cualquier editor hexa:
   00000000  25 50 44 46 2d 31 2e 37 0a 25 e2 e3 cf d3 0a 31   %PDF-1.7.%.....1 */
function volcado(bytes, desde, cantidad) {
  const lineas = [];
  const hasta = Math.min(bytes.length, desde + cantidad);
  for (let i = desde; i < hasta; i += 16) {
    const fila = bytes.subarray(i, Math.min(i + 16, hasta));
    const hexa = [...fila]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    // Solo los caracteres imprimibles (32 a 126) se muestran; el resto, como punto.
    const texto = [...fila]
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    lineas.push(
      i.toString().padStart(8, "0") + "  " + hexa.padEnd(47) + "   " + texto,
    );
  }
  return lineas.join("\n");
}
