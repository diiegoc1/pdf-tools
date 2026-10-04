/* ============================================================
   CATÁLOGO DE HERRAMIENTAS
   Es la ÚNICA lista de herramientas del proyecto. La portada, la
   vista de cada herramienta y sus opciones se arman a partir de acá.
   Sumar una herramienta nueva = sumar una entrada en esta lista
   + un servicio en js/servicios/. La interfaz no se toca.
   ============================================================ */
const HERRAMIENTAS = [
  {
    id: "unir", // va en la dirección: index.html#unir
    titulo: "Unir PDF",
    descripcion:
      "Combina varios documentos en uno solo, en el orden que elijas.",
    icono: "⊕",
    multiples: true, // ¿acepta varios archivos?
    minimo: 2, // cuántos archivos hacen falta para ejecutar
    boton: "Unir PDF",
    opciones: [],
  },
  {
    id: "dividir",
    titulo: "Dividir PDF",
    descripcion: "Separa páginas o rangos en archivos independientes.",
    icono: "⊟",
    multiples: false,
    minimo: 1,
    boton: "Dividir PDF",
    opciones: [
      {
        tipo: "texto",
        nombre: "rangos",
        etiqueta: "Páginas a separar",
        ejemplo: "1-3,7,10-",
        ayuda:
          "Cada grupo separado por coma termina en un archivo distinto. Vacío: una página por archivo.",
      },
    ],
  },
  {
    id: "comprimir",
    titulo: "Comprimir PDF",
    descripcion: "Reduce el peso del archivo conservando las páginas.",
    icono: "⊙",
    multiples: false,
    minimo: 1,
    boton: "Comprimir PDF",
    opciones: [
      {
        tipo: "eleccion",
        nombre: "nivel",
        etiqueta: "Nivel de compresión",
        valores: [
          { valor: "ligera", etiqueta: "Ligera · sin pérdida de calidad" },
          { valor: "recomendada", etiqueta: "Recomendada", elegido: true },
          { valor: "extrema", etiqueta: "Extrema · máxima reducción" },
        ],
      },
    ],
  },
  {
    id: "explorar",
    titulo: "Explorar PDF",
    descripcion:
      "Mirá cómo está armado un PDF por dentro: su índice, sus objetos y de qué está hecho el peso.",
    icono: "⌕",
    multiples: false,
    minimo: 1,
    boton: "Explorar PDF",
    opciones: [],
  },
];

/* Registro de servicios: cada archivo de js/servicios/ se anota acá.
   Ejemplo:  SERVICIOS.unir = async function (archivos, opciones, avisar) { ... }
   Un servicio NO toca la página: recibe datos y devuelve datos. */
const SERVICIOS = {};
