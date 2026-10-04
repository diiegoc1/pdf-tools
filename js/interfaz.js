// La interfaz llama a cualquier servicio de la misma forma:

/* ---------- 1. Portada: una tarjeta por herramienta del catálogo ---------- */
function dibujarTarjetas() {
  const contenedor = document.getElementById("tarjetas");
  for (const h of HERRAMIENTAS) {
    const tarjeta = crear("a", "tarjeta");
    tarjeta.href = "#" + h.id; // al hacer clic cambia la dirección a index.html#unir
    tarjeta.append(
      crear("span", "icono", h.icono),
      crear("h2", "", h.titulo),
      crear("p", "", h.descripcion),
    );
    contenedor.append(tarjeta);
  }
}

/* ---------- 2. Vistas: la parte de la dirección después de # decide qué se ve ---------- */
const vistaPortada = document.getElementById("portada");
const vistaHerramienta = document.getElementById("herramienta");
const formOpciones = document.getElementById("opciones");
const botonEjecutar = document.getElementById("ejecutar");
const estado = document.getElementById("estado");

let herramienta = null; // la herramienta abierta, o null si estamos en la portada
let archivos = []; // lo que cargó el usuario: { nombre, tamano, bytes, paginas, error }

function mostrarVista() {
  const id = location.hash.slice(1); // "#unir" → "unir"
  herramienta = HERRAMIENTAS.find((h) => h.id === id) || null; // null si el # no es una herramienta

  vistaPortada.hidden = herramienta !== null;
  vistaHerramienta.hidden = herramienta === null;
  limpiarResultado();
  mostrarEstado("");
  window.scrollTo(0, 0);

  if (!herramienta) {
    document.title = "PDF Tools";
    return;
  }
  document.title = herramienta.titulo + " · PDF Tools";
  document.getElementById("h-titulo").textContent = herramienta.titulo;
  document.getElementById("h-descripcion").textContent =
    herramienta.descripcion;
  botonEjecutar.textContent = herramienta.boton;
  dibujarOpciones();

  selector.multiple = herramienta.multiples; // el diálogo de archivos permite elegir varios, o uno
  archivos = [];
  dibujarLista();
}

/* Las opciones también salen del catálogo: la interfaz no sabe qué herramienta es. */
function dibujarOpciones() {
  formOpciones.replaceChildren(); // borra lo que hubiera de la herramienta anterior
  for (const opcion of herramienta.opciones) {
    const grupo = crear("fieldset");
    grupo.append(crear("legend", "", opcion.etiqueta));

    if (opcion.tipo === "texto") {
      const campo = crear("input");
      campo.type = "text";
      campo.name = opcion.nombre;
      campo.placeholder = "Ej: " + opcion.ejemplo;
      campo.autocomplete = "off";
      grupo.append(campo, crear("small", "", opcion.ayuda));
    }

    if (opcion.tipo === "eleccion") {
      for (const v of opcion.valores) {
        const etiqueta = crear("label", "eleccion");
        const radio = crear("input");
        radio.type = "radio";
        radio.name = opcion.nombre;
        radio.value = v.valor;
        radio.checked = Boolean(v.elegido);
        etiqueta.append(radio, " " + v.etiqueta); // un string en append() se agrega como texto, nunca como HTML
        grupo.append(etiqueta);
      }
    }
    formOpciones.append(grupo);
  }
}

/* FormData lee todos los campos del formulario de una vez: { rangos: "1-3,7" } o { nivel: "ligera" } */
function leerOpciones() {
  return Object.fromEntries(new FormData(formOpciones));
}

function mostrarEstado(texto, tipo = "") {
  estado.textContent = texto;
  estado.className = "estado " + tipo;
}

/* ---------- 3. Zona de arrastre y selector de archivos ---------- */
const zona = document.getElementById("zona");
const selector = document.getElementById("selector");

// Sin preventDefault en dragover, el navegador entiende que queremos ABRIR el archivo:
// muestra el PDF en la pestaña y la aplicación se cierra.
zona.addEventListener("dragover", (evento) => {
  evento.preventDefault();
  zona.classList.add("encima");
});
zona.addEventListener("dragleave", () => zona.classList.remove("encima"));
zona.addEventListener("drop", (evento) => {
  evento.preventDefault();
  zona.classList.remove("encima");
  agregarArchivos(evento.dataTransfer.files);
});
// Lo mismo si el archivo se suelta FUERA de la zona, por error.
window.addEventListener("dragover", (evento) => evento.preventDefault());
window.addEventListener("drop", (evento) => evento.preventDefault());

selector.addEventListener("change", () => {
  agregarArchivos(selector.files);
  selector.value = ""; // así se puede volver a elegir el mismo archivo
});

async function agregarArchivos(lista) {
  // Copiamos la lista YA, antes del primer await: el FileList del selector está "vivo"
  // y se vacía cuando hacemos selector.value = ''. Sin esta copia solo se lee el primer archivo.
  const elegidos = [...lista];
  mostrarEstado("Leyendo archivos…");
  const nuevos = [];
  for (const archivo of elegidos) {
    nuevos.push(await prepararArchivo(archivo)); // uno por uno, en orden
  }
  archivos = herramienta.multiples
    ? archivos.concat(nuevos)
    : nuevos.slice(0, 1);
  mostrarEstado("");
  dibujarLista();
}

/* Lee el archivo completo y verifica que sea un PDF.
   El nombre y el tipo que informa el navegador los elige quien tiene el archivo:
   se cambian con solo renombrar. Lo que vale es el contenido: tiene que empezar con %PDF-. */
async function prepararArchivo(archivo) {
  const item = { nombre: archivo.name, tamano: archivo.size };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!esPdf(bytes)) {
    item.error = "No es un PDF (no empieza con %PDF-).";
    return item;
  }
  item.bytes = bytes;
  try {
    item.paginas = await contarPaginas(bytes);
  } catch (error) {
    item.error = error.message;
  }
  return item;
}

/* ---------- 4. Lista de archivos cargados ---------- */
function dibujarLista() {
  const ul = document.getElementById("lista");
  ul.replaceChildren();
  archivos.forEach((archivo, i) => {
    const li = crear("li", archivo.error ? "archivo con-error" : "archivo");
    li.append(crear("span", "nombre", archivo.nombre)); // textContent: el nombre lo eligió el usuario

    const partes = [];
    if (archivo.paginas)
      partes.push(
        archivo.paginas + (archivo.paginas === 1 ? " pág." : " págs."),
      );
    partes.push(formatearBytes(archivo.tamano));
    li.append(crear("span", "detalle", archivo.error || partes.join(" · ")));

    if (herramienta.multiples) {
      li.append(
        botonChico("↑", "Subir", () => mover(i, -1), i === 0),
        botonChico("↓", "Bajar", () => mover(i, +1), i === archivos.length - 1),
      );
    }
    li.append(botonChico("×", "Quitar", () => quitar(i)));
    ul.append(li);
  });
  actualizarControles();
}

function botonChico(texto, titulo, alHacerClic, desactivado = false) {
  const boton = crear("button", "chico", texto);
  boton.type = "button";
  boton.title = titulo;
  boton.setAttribute("aria-label", titulo);
  boton.disabled = desactivado;
  boton.addEventListener("click", alHacerClic);
  return boton;
}

function mover(i, paso) {
  const j = i + paso;
  [archivos[i], archivos[j]] = [archivos[j], archivos[i]]; // intercambio por desestructuración
  dibujarLista();
}

function quitar(i) {
  archivos.splice(i, 1);
  dibujarLista();
}

/* Opciones y botón aparecen recién cuando hay algún archivo. */
function actualizarControles() {
  const hayArchivos = archivos.length > 0;
  const validos = archivos.filter((a) => !a.error).length;

  formOpciones.hidden = !hayArchivos || herramienta.opciones.length === 0;
  botonEjecutar.hidden = !hayArchivos;
  botonEjecutar.disabled = validos < herramienta.minimo;
  document.getElementById("ayuda-orden").hidden =
    !herramienta.multiples || archivos.length < 2;

  if (hayArchivos && validos < herramienta.minimo) {
    mostrarEstado(
      `Hacen falta al menos ${herramienta.minimo} archivos PDF válidos.`,
    );
  } else {
    mostrarEstado("");
  }
}

/* ---------- 5. Ejecutar: le pasa los datos al servicio y muestra lo que devuelve ---------- */
async function ejecutar() {
  const servicio = SERVICIOS[herramienta.id];
  if (!servicio) {
    mostrarEstado(
      `Todavía no hay un servicio registrado para «${herramienta.id}»: se programa en una etapa posterior.`,
      "error",
    );
    return;
  }

  botonEjecutar.disabled = true;
  limpiarResultado();
  mostrarEstado("Procesando…");
  try {
    const validos = archivos.filter((a) => !a.error);
    // avisar: una función que el servicio llama para contar en qué anda.
    const avisar = (texto) => mostrarEstado(texto);
    const resultado = await servicio(validos, leerOpciones(), avisar);
    mostrarEstado("");
    dibujarResultado(resultado);
  } catch (error) {
    console.error(error); // el detalle técnico, para la consola (F12)
    mostrarEstado(error.message, "error"); // el mensaje, para el usuario
  } finally {
    botonEjecutar.disabled = false; // se ejecuta haya salido bien o mal
  }
}

botonEjecutar.addEventListener("click", ejecutar);
// Enter dentro de un campo de opciones "envía" el formulario: lo convertimos en ejecutar.
formOpciones.addEventListener("submit", (evento) => {
  evento.preventDefault();
  if (!botonEjecutar.disabled) ejecutar();
});

/* ---------- 6. Resultado ---------- */
const cajaResultado = document.getElementById("resultado");
let urlsCreadas = []; // cada URL.createObjectURL ocupa memoria hasta que se libera

function limpiarResultado() {
  urlsCreadas.forEach((url) => URL.revokeObjectURL(url));
  urlsCreadas = [];
  cajaResultado.replaceChildren();
  cajaResultado.hidden = true;
}

function dibujarResultado(resultado) {
  limpiarResultado();
  if (resultado.mensaje)
    cajaResultado.append(crear("p", "exito", "✓ " + resultado.mensaje));
  if (resultado.tipo === "descargas") dibujarDescargas(resultado.archivos);
  if (resultado.tipo === "informe") dibujarInforme(resultado.informe);
  cajaResultado.hidden = false;
  // Sin esta línea el resultado aparece debajo del borde de la pantalla:
  // el usuario aprieta el botón y "no pasa nada". Ninguna prueba automática lo detecta.
  cajaResultado.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Un Blob es un "archivo en memoria"; createObjectURL le da una dirección para el enlace. */
function dibujarDescargas(lista) {
  const enlaces = lista.map((archivo) => {
    const url = URL.createObjectURL(
      new Blob([archivo.bytes], { type: "application/pdf" }),
    );
    urlsCreadas.push(url);
    const enlace = crear(
      "a",
      lista.length === 1 ? "boton" : "boton secundario",
      lista.length === 1 ? "Descargar" : archivo.nombre,
    );
    enlace.href = url;
    enlace.download = archivo.nombre; // el atributo download pide descargar en vez de abrir
    return enlace;
  });

  if (enlaces.length === 1) {
    cajaResultado.append(enlaces[0]);
    return;
  }
  const ul = crear("ul", "descargas");
  enlaces.forEach((enlace) => {
    const li = crear("li");
    li.append(enlace);
    ul.append(li);
  });
  const todos = crear("button", "boton", `Descargar los ${enlaces.length}`);
  todos.type = "button";
  // De a uno, con una pausa: algunos navegadores bloquean muchas descargas simultáneas.
  todos.addEventListener("click", () =>
    enlaces.forEach((e, i) => setTimeout(() => e.click(), i * 400)),
  );
  cajaResultado.append(ul, todos);
}

/* ---------- Arranque ---------- */
dibujarTarjetas();
window.addEventListener("hashchange", mostrarVista); // cada vez que cambia el # de la dirección
mostrarVista(); // y una vez al cargar (por si se entró con #unir)

/* ---------- 7. Informe del explorador ---------- */
function dibujarInforme(inf) {
  const caja = crear("div", "informe");
  cajaResultado.append(caja);

  caja.append(crear("h3", "", "Ficha"));
  const datos = [
    ["Archivo", inf.nombre],
    [
      "Tamaño",
      formatearBytes(inf.tamano) +
        ` (${inf.tamano.toLocaleString("es-AR")} bytes)`,
    ],
    ["Versión", "PDF " + inf.version],
  ];
  if (inf.indice) {
    datos.push([
      "startxref",
      inf.startxref === null
        ? "no encontrado"
        : `byte ${inf.startxref.toLocaleString("es-AR")}`,
    ]);
    datos.push(["Índice", inf.indice.descripcion]);
    datos.push(["Catálogo (/Root)", inf.indice.raiz || "—"]);
  }
  if (inf.objetos) {
    datos.push(["Objetos", inf.objetos.length.toLocaleString("es-AR")]);
    datos.push(["Páginas", String(inf.paginas)]);
  }
  caja.append(ficha(datos));

  caja.append(crear("h3", "", "Primeros bytes: la cabecera"));
  caja.append(crear("pre", "volcado", inf.inicio));
  caja.append(crear("h3", "", "Últimos bytes: acá empieza la lectura"));
  caja.append(crear("pre", "volcado", inf.final));

  for (const aviso of inf.avisos || []) caja.append(crear("p", "aviso", aviso));

  if (inf.indice) {
    caja.append(
      crear("h3", "", "Secciones del índice (de la más nueva a la más vieja)"),
    );
    caja.append(
      tabla(
        ["Tipo", "Empieza en el byte", "Entradas"],
        inf.indice.secciones.map((s) => [
          s.tipo,
          s.posicion.toLocaleString("es-AR"),
          s.cantidad,
        ]),
      ),
    );
    caja.append(crear("h3", "", "Tráiler"));
    caja.append(crear("pre", "volcado", inf.indice.trailer || "(sin tráiler)"));
  }

  if (inf.categorias) {
    caja.append(crear("h3", "", "De qué está hecho el peso"));
    caja.append(barras(inf.categorias, inf.tamano));
  }

  if (inf.objetos) {
    caja.append(
      crear(
        "h3",
        "",
        "Objetos (hacé clic en una fila para ver su diccionario)",
      ),
    );
    const detalle = crear("pre", "volcado", "Elegí un objeto de la tabla.");
    const filas = inf.objetos.map((o) => [
      o.numero,
      o.donde,
      o.tipo,
      o.categoria,
      o.tamano === null ? "—" : formatearBytes(o.tamano),
    ]);
    const caja2 = tabla(
      ["N°", "Dónde está", "/Type", "Categoría", "Tamaño"],
      filas,
    );
    caja2.querySelectorAll("tbody tr").forEach((tr, i) => {
      tr.addEventListener("click", () => {
        caja2.querySelector(".elegida")?.classList.remove("elegida");
        tr.classList.add("elegida");
        detalle.textContent = `${inf.objetos[i].numero} ${inf.objetos[i].generacion} obj\n${inf.objetos[i].vista}`;
      });
    });
    caja.append(caja2, crear("h3", "", "Objeto elegido"), detalle);
  }
}

/* Una lista de definiciones <dl>: [['Tamaño', '2 MB'], ...] */
function ficha(pares) {
  const dl = crear("dl", "ficha");
  for (const [clave, valor] of pares) {
    const div = crear("div");
    div.append(crear("dt", "", clave), crear("dd", "", String(valor)));
    dl.append(div);
  }
  return dl;
}

function tabla(encabezados, filas) {
  const caja = crear("div", "tabla-caja");
  const t = crear("table", "tabla");
  const filaTitulos = crear("tr");
  encabezados.forEach((e) => filaTitulos.append(crear("th", "", e)));
  t.append(crear("thead"));
  t.tHead.append(filaTitulos);
  const cuerpo = crear("tbody");
  for (const fila of filas) {
    const tr = crear("tr");
    fila.forEach((celda) =>
      tr.append(
        crear("td", typeof celda === "number" ? "num" : "", String(celda)),
      ),
    );
    cuerpo.append(tr);
  }
  t.append(cuerpo);
  caja.append(t);
  return caja;
}

function barras(categorias, total) {
  const caja = crear("div", "barras");
  const mayor = Math.max(...categorias.map((c) => c.bytes));
  for (const c of categorias) {
    const fila = crear("div", "barra-fila");
    const fondo = crear("div", "barra-fondo");
    const relleno = crear("div", "barra-relleno");
    relleno.style.width = (100 * c.bytes) / mayor + "%";
    fondo.append(relleno);
    fila.append(
      crear("span", "", c.nombre),
      fondo,
      crear("span", "valor", porcentaje(c.bytes / total)),
    );
    fila.title = formatearBytes(c.bytes);
    caja.append(fila);
  }
  return caja;
}
