/* ============================================================
   UTILIDADES
   Funciones chicas que usan varias partes del proyecto.
   ============================================================ */

/* Crea un elemento con una clase y un texto.
   El texto se pone SIEMPRE con textContent y nunca con innerHTML:
   si viene del usuario (por ejemplo, un nombre de archivo) puede
   contener cualquier cosa, incluso algo como <img onerror=...>. */
function crear(etiqueta, clase = "", texto = "") {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== "") elemento.textContent = texto;
  return elemento;
}

/* 1536 → "1,5 KB" ; 1800000 → "1,7 MB" */
function formatearBytes(n) {
  const decimal = (x) =>
    x.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return decimal(n / 1024) + " KB";
  return decimal(n / (1024 * 1024)) + " MB";
}

/* 0.751 → "75,1 %" */
function porcentaje(fraccion) {
  return (
    (fraccion * 100).toLocaleString("es-AR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " %"
  );
}

/* "contrato.pdf" → "contrato" */
function nombreSinExtension(nombre) {
  return nombre.replace(/\.pdf$/i, "");
}
