import { jsonAXml } from "/lib/jsonAXml.js";
import { presetCompactoPdf2json } from "/lib/presets.js";

// Las vistas previas muestran solo el inicio de archivos grandes; la descarga siempre es completa.
const LIMITE_VISTA = 512 * 1024;

const $ = (selector) => document.querySelector(selector);
// pagina: "todo" para el documento completo, o el número de página que se ve en JSON y XML.
const estado = { documentos: [], ficha: null, pestana: "resumen", pagina: "todo", cargadas: new Set() };

// ---------- Utilidades ----------

function escapar(texto) {
	return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tamano(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fecha(iso, conHora = false) {
	return new Date(iso).toLocaleString("es-PE", conHora ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

let temporizadorAviso;
function avisar(mensaje, esError = false) {
	const aviso = $("#aviso");
	aviso.textContent = mensaje;
	aviso.classList.toggle("error", esError);
	aviso.hidden = false;
	clearTimeout(temporizadorAviso);
	temporizadorAviso = setTimeout(() => (aviso.hidden = true), esError ? 6000 : 3000);
}

async function api(ruta, opciones) {
	const respuesta = await fetch(ruta, opciones);
	const datos = await respuesta.json().catch(() => ({}));
	if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
	return datos;
}

function leerPreferencia(clave) {
	try {
		return localStorage.getItem(clave);
	} catch {
		return null;
	}
}

function guardarPreferencia(clave, valor) {
	try {
		localStorage.setItem(clave, valor);
	} catch {
		// Sin almacenamiento local (modo privado): no pasa nada.
	}
}

// ---------- Resaltado de sintaxis ----------

function resaltarJson(texto) {
	return escapar(texto).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (todo, cadena, dosPuntos, literal) => {
		if (cadena) return dosPuntos ? `<span class="s-clave">${cadena}</span>${dosPuntos}` : `<span class="s-cadena">${cadena}</span>`;
		if (literal) return `<span class="s-literal">${literal}</span>`;
		return `<span class="s-numero">${todo}</span>`;
	});
}

function resaltarXml(texto) {
	return escapar(texto)
		.replace(/&lt;\?.*?\?&gt;/g, (declaracion) => `<span class="s-suave">${declaracion}</span>`)
		.replace(/(&lt;\/?)([\p{L}\p{N}_.:-]+)((?:\s+[\p{L}\p{N}_.:-]+="[^"]*")*)(\s*\/?&gt;)/gu, (todo, abre, nombre, atributos, cierra) => {
			const conAtributos = atributos.replace(/([\p{L}\p{N}_.:-]+)=("[^"]*")/gu, '<span class="s-atributo">$1</span>=<span class="s-cadena">$2</span>');
			return `<span class="s-suave">${abre}</span><span class="s-etiqueta">${nombre}</span>${conAtributos}<span class="s-suave">${cierra}</span>`;
		});
}

// ---------- Vistas principales ----------

function mostrarVista(nombre) {
	for (const boton of document.querySelectorAll("[data-vista]")) boton.setAttribute("aria-selected", String(boton.dataset.vista === nombre));
	$("#vista-biblioteca").hidden = nombre !== "biblioteca";
	$("#vista-conversor").hidden = nombre !== "conversor";
	if (nombre === "conversor") convertir();
}

for (const boton of document.querySelectorAll("[data-vista]")) {
	boton.addEventListener("click", () => mostrarVista(boton.dataset.vista));
}

// ---------- Carga de PDF ----------

const zonaCarga = $("#zona-carga");
zonaCarga.addEventListener("dragover", (evento) => {
	evento.preventDefault();
	zonaCarga.classList.add("encima");
});
zonaCarga.addEventListener("dragleave", () => zonaCarga.classList.remove("encima"));
zonaCarga.addEventListener("drop", (evento) => {
	evento.preventDefault();
	zonaCarga.classList.remove("encima");
	subir([...evento.dataTransfer.files]);
});
$("#selector-pdf").addEventListener("change", (evento) => {
	subir([...evento.target.files]);
	evento.target.value = "";
});

async function subir(archivos) {
	const pdfs = archivos.filter((archivo) => archivo.type === "application/pdf" || archivo.name.toLowerCase().endsWith(".pdf"));
	if (pdfs.length < archivos.length) avisar("Solo se aceptan archivos PDF", true);
	let ultimo = null;
	for (const archivo of pdfs) {
		const fila = document.createElement("li");
		fila.innerHTML = `<span></span><span class="estado">Extrayendo JSON…</span>`;
		fila.firstElementChild.textContent = archivo.name;
		$("#cola").prepend(fila);
		try {
			const ficha = await api("/api/documentos", {
				method: "POST",
				headers: { "Content-Type": "application/pdf", "X-Nombre-Archivo": encodeURIComponent(archivo.name) },
				body: archivo,
			});
			fila.classList.add("ok");
			fila.lastElementChild.textContent = ficha.duplicado
				? "Ya estaba en la biblioteca"
				: `${ficha.paginas} págs. · guardado${ficha.ocr?.estado === "pendiente" ? " · OCR en cola" : ""}`;
			ultimo = ficha.id;
		} catch (error) {
			fila.classList.add("error");
			fila.lastElementChild.textContent = "No se pudo leer";
			fila.title = error.message;
			avisar(`${archivo.name}: ${error.message}`, true);
		}
		setTimeout(() => fila.remove(), 8000);
	}
	if (ultimo) {
		$("#busqueda").value = "";
		await cargarLista();
		seleccionar(ultimo);
	}
}

// ---------- Lista de la biblioteca ----------

let temporizadorBusqueda;
$("#busqueda").addEventListener("input", () => {
	clearTimeout(temporizadorBusqueda);
	temporizadorBusqueda = setTimeout(cargarLista, 250);
});

async function cargarLista() {
	const busqueda = $("#busqueda").value.trim();
	try {
		estado.documentos = await api(`/api/documentos?q=${encodeURIComponent(busqueda)}`);
	} catch (error) {
		avisar(error.message, true);
		return;
	}
	const total = estado.documentos.length;
	$("#contador").textContent = busqueda
		? `${total} ${total === 1 ? "resultado" : "resultados"} para «${busqueda}»`
		: `${total} ${total === 1 ? "documento" : "documentos"}`;
	const palabras = busqueda.split(/\s+/).filter(Boolean);
	$("#lista").replaceChildren(
		...estado.documentos.map((ficha) => {
			const elemento = document.createElement("li");
			const boton = document.createElement("button");
			boton.type = "button";
			boton.dataset.id = ficha.id;
			boton.setAttribute("aria-current", String(ficha.id === estado.ficha?.id));
			boton.innerHTML = `
				<span class="nombre"></span>
				<span class="datos">${ficha.paginas} ${ficha.paginas === 1 ? "pág." : "págs."} · ${fecha(ficha.agregado)} · ${tamano(ficha.bytes.pdf)}</span>
				${ficha.fragmento ? `<span class="fragmento">${marcar(ficha.fragmento, palabras)}</span>` : ""}`;
			boton.querySelector(".nombre").textContent = ficha.titulo || ficha.nombre;
			boton.title = ficha.nombre;
			boton.addEventListener("click", async () => {
				await seleccionar(ficha.id);
				// En pantallas angostas el detalle queda debajo de la lista.
				if (matchMedia("(max-width: 860px)").matches) $("#detalle").scrollIntoView({ behavior: "smooth" });
			});
			elemento.append(boton);
			return elemento;
		}),
	);
	if (!total && !busqueda) mostrarVacio();
}

function marcar(texto, palabras) {
	let html = escapar(texto);
	for (const palabra of palabras) {
		const patron = new RegExp(escapar(palabra).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		html = html.replace(patron, (coincidencia) => `<mark>${coincidencia}</mark>`);
	}
	return html;
}

// ---------- Documento seleccionado ----------

function mostrarVacio() {
	estado.ficha = null;
	$("#documento").hidden = true;
	$("#vacio").hidden = false;
	history.replaceState(null, "", location.pathname);
}

async function seleccionar(id) {
	let ficha;
	try {
		ficha = await api(`/api/documentos/${encodeURIComponent(id)}`);
	} catch (error) {
		avisar(error.message, true);
		mostrarVacio();
		return;
	}
	estado.ficha = ficha;
	estado.pagina = "todo";
	estado.cargadas.clear();
	clearTimeout(estado.temporizadorOcr);
	history.replaceState(null, "", `#doc=${encodeURIComponent(id)}`);
	for (const boton of document.querySelectorAll("#lista button")) boton.setAttribute("aria-current", String(boton.dataset.id === id));

	$("#vacio").hidden = true;
	$("#documento").hidden = false;
	$("#doc-titulo").textContent = ficha.titulo || ficha.nombre;
	$("#doc-sub").textContent = `${ficha.titulo ? `${ficha.nombre} · ` : ""}${ficha.paginas} ${ficha.paginas === 1 ? "página" : "páginas"} · agregado el ${fecha(ficha.agregado, true)}`;
	for (const tipo of ["json", "xml", "texto", "pdf"]) {
		$(`#descargar-${tipo}`).href = `/api/documentos/${encodeURIComponent(id)}/${tipo}?descargar=1`;
	}
	for (const enlace of document.querySelectorAll("[data-zip]")) {
		enlace.href = `/api/documentos/${encodeURIComponent(id)}/paginas/zip?tipo=${enlace.dataset.zip}`;
	}
	pintarFicha(ficha);
	llenarSelectoresPagina(ficha);
	rellenarOpcionesXml($("#opciones-xml"), ficha.opcionesXml);
	$("#visor-pdf").removeAttribute("src");
	mostrarPestana(estado.pestana);
	vigilarOcr();
}

// ---------- OCR ----------

const OCR_EN_CURSO = ["pendiente", "procesando"];

function paginasConOcr(ficha) {
	return new Set(ficha.ocr?.estado === "listo" ? ficha.ocr.conTexto : []);
}

/** Contenido de la fila "OCR" del resumen: estado y, si corresponde, el botón para aplicarlo. */
function pintarOcr(dd, ficha) {
	const { ocr } = ficha;
	const lista = (paginas) => (paginas.length === 1 ? `pág. ${paginas[0]}` : `págs. ${paginas.join(", ")}`);
	let texto;
	let boton = null;
	if (!ocr) {
		const sinTexto = ficha.paginasSinTexto;
		if (sinTexto && !sinTexto.length) texto = "No hace falta: todas las páginas tienen texto.";
		else {
			texto = sinTexto ? `Sin aplicar. ${sinTexto.length} ${sinTexto.length === 1 ? "página no tiene" : "páginas no tienen"} texto (${lista(sinTexto)}).` : "Sin aplicar.";
			boton = "Aplicar OCR";
		}
	} else if (ocr.estado === "pendiente") {
		texto = `En cola: ${ocr.paginas.length} ${ocr.paginas.length === 1 ? "página sin texto" : "páginas sin texto"}…`;
	} else if (ocr.estado === "procesando") {
		texto = `Leyendo con OCR: ${ocr.hechas} de ${ocr.paginas.length} páginas…`;
	} else if (ocr.estado === "listo") {
		texto = ocr.conTexto.length
			? `${ocr.conTexto.length} de ${ocr.paginas.length} páginas sin texto tenían texto en la imagen (${lista(ocr.conTexto)}) · confianza media ${ocr.confianza} % · ${ocr.idiomas}`
			: `Ninguna de las ${ocr.paginas.length} páginas sin texto tenía texto legible en la imagen.`;
		boton = "Repetir OCR";
	} else if (ocr.estado === "no-necesario") {
		texto = "No hace falta: todas las páginas tienen texto.";
	} else {
		texto = `Falló: ${ocr.error}`;
		boton = "Reintentar OCR";
	}
	dd.textContent = texto;
	if (ocr?.estado === "listo" && ocr.conTexto.length) {
		const enlace = document.createElement("a");
		enlace.href = `/api/documentos/${encodeURIComponent(ficha.id)}/ocr?descargar=1`;
		enlace.download = "";
		enlace.textContent = "ocr.json";
		dd.append(" · ", enlace);
	}
	if (boton) {
		const elemento = document.createElement("button");
		elemento.type = "button";
		elemento.className = "boton secundario boton-ocr";
		elemento.textContent = boton;
		elemento.addEventListener("click", () => pedirOcr(elemento));
		dd.append(" ", elemento);
	}
}

async function pedirOcr(boton) {
	boton.disabled = true;
	try {
		estado.ficha = await api(`/api/documentos/${encodeURIComponent(estado.ficha.id)}/ocr`, { method: "POST" });
		pintarFicha(estado.ficha);
		vigilarOcr();
	} catch (error) {
		avisar(error.message, true);
		boton.disabled = false;
	}
}

// Mientras el OCR está en cola o en curso, se consulta la ficha cada 2 s para mostrar el avance.
function vigilarOcr() {
	clearTimeout(estado.temporizadorOcr);
	if (!OCR_EN_CURSO.includes(estado.ficha?.ocr?.estado)) return;
	const id = estado.ficha.id;
	estado.temporizadorOcr = setTimeout(async () => {
		const ficha = await api(`/api/documentos/${encodeURIComponent(id)}`).catch(() => null);
		if (!ficha || estado.ficha?.id !== id) return;
		estado.ficha = ficha;
		pintarFicha(ficha);
		if (OCR_EN_CURSO.includes(ficha.ocr?.estado)) return vigilarOcr();
		if (ficha.ocr?.estado === "listo") {
			avisar(`OCR terminado: ${ficha.ocr.conTexto.length} de ${ficha.ocr.paginas.length} páginas con texto`);
			// El JSON y el XML de esas páginas, y el texto, ahora incluyen el OCR.
			for (const tipo of ["json", "xml", "texto"]) estado.cargadas.delete(tipo);
			llenarSelectoresPagina(ficha);
			mostrarPestana(estado.pestana);
		} else if (ficha.ocr?.estado === "error") {
			avisar(`El OCR falló: ${ficha.ocr.error}`, true);
		}
	}, 2000);
}

// ---------- Páginas ----------

/** URL del JSON o XML que se está viendo: el documento completo o la página elegida. */
function urlArchivo(tipo, parametros = {}) {
	const id = encodeURIComponent(estado.ficha.id);
	const porPagina = estado.pagina !== "todo" && (tipo === "json" || tipo === "xml");
	const ruta = porPagina ? `/api/documentos/${id}/paginas/${estado.pagina}/${tipo}` : `/api/documentos/${id}/${tipo}`;
	const consulta = new URLSearchParams(parametros).toString();
	return consulta ? `${ruta}?${consulta}` : ruta;
}

function llenarSelectoresPagina(ficha) {
	const conOcr = paginasConOcr(ficha);
	for (const selector of document.querySelectorAll(".selector-pagina")) {
		const opciones = [new Option("Documento completo", "todo")];
		for (let pagina = 1; pagina <= ficha.paginas; pagina++) {
			opciones.push(new Option(`Página ${pagina} de ${ficha.paginas}${conOcr.has(pagina) ? " · con OCR" : ""}`, String(pagina)));
		}
		selector.replaceChildren(...opciones);
		selector.value = estado.pagina;
	}
	actualizarDescargasPagina();
}

function actualizarDescargasPagina() {
	for (const enlace of document.querySelectorAll("[data-descargar]")) enlace.href = urlArchivo(enlace.dataset.descargar, { descargar: 1 });
	// El paquete InDesign sigue la misma elección: una página o el documento completo.
	const indesign = $("#descargar-indesign");
	indesign.href = `/api/documentos/${encodeURIComponent(estado.ficha.id)}/indesign${estado.pagina === "todo" ? "" : `?paginas=${estado.pagina}`}`;
	indesign.textContent = estado.pagina === "todo" ? "InDesign (.zip)" : `InDesign pág. ${estado.pagina} (.zip)`;
}

// JSON y XML comparten la página elegida, así se puede comparar la misma página en los dos formatos.
for (const selector of document.querySelectorAll(".selector-pagina")) {
	selector.addEventListener("change", () => {
		estado.pagina = selector.value;
		for (const otro of document.querySelectorAll(".selector-pagina")) otro.value = estado.pagina;
		estado.cargadas.delete("json");
		estado.cargadas.delete("xml");
		actualizarDescargasPagina();
		mostrarPestana(estado.pestana);
	});
}

function pintarFicha(ficha) {
	const filas = [
		["Archivo", ficha.nombre],
		["Título", ficha.titulo],
		["Autor", ficha.autor],
		["Asunto", ficha.asunto],
		["Creado con", ficha.creador],
		["Productor", ficha.productor],
		["Versión PDF", ficha.versionPdf],
		["Páginas", ficha.paginas],
		["Formulario", ficha.esFormulario ? `Sí, ${ficha.campos} ${ficha.campos === 1 ? "campo" : "campos"}` : "No"],
		["Texto extraído", `${ficha.caracteres.toLocaleString("es-PE")} caracteres`],
		["Tamaños", `PDF ${tamano(ficha.bytes.pdf)} · JSON ${tamano(ficha.bytes.json)} · XML ${tamano(ficha.bytes.xml)}`],
		["Por página", ficha.paginas ? `${ficha.paginas} JSON y ${ficha.paginas} XML en biblioteca/${ficha.id}/paginas/` : ""],
		["OCR", "-"],
		["XML", describirOpciones(ficha.opcionesXml)],
		["Extraído con", ficha.transcoder],
		["Agregado", fecha(ficha.agregado, true)],
		["Carpeta", `biblioteca/${ficha.id}/`],
		["SHA-256", ficha.hash],
	];
	$("#ficha").replaceChildren(
		...filas
			.filter(([, valor]) => valor !== "" && valor !== undefined)
			.flatMap(([etiqueta, valor]) => {
				const dt = document.createElement("dt");
				const dd = document.createElement("dd");
				dt.textContent = etiqueta;
				if (etiqueta === "SHA-256" || etiqueta === "Carpeta") {
					const codigo = document.createElement("code");
					codigo.textContent = valor;
					dd.append(codigo);
				} else {
					dd.textContent = valor;
				}
				if (etiqueta === "OCR") pintarOcr(dd, ficha);
				if (etiqueta === "Por página") {
					const enlace = document.createElement("a");
					enlace.href = `/api/documentos/${encodeURIComponent(ficha.id)}/paginas/zip?tipo=todo`;
					enlace.download = "";
					enlace.textContent = "Descargar todas (.zip)";
					dd.append(" · ", enlace);
				}
				return [dt, dd];
			}),
	);
}

function describirOpciones({ raiz, sangria, atributos, contenido }) {
	const partes = [`raíz <${raiz}>`, sangria === null ? "una línea" : `sangría ${sangria}`];
	if (atributos.length) partes.push(`${atributos.length} ${atributos.length === 1 ? "ruta" : "rutas"} como atributo`);
	if (contenido.length) partes.push(`${contenido.length} ${contenido.length === 1 ? "ruta" : "rutas"} como contenido`);
	return partes.join(" · ");
}

// ---------- Pestañas del documento ----------

for (const boton of document.querySelectorAll("[data-pestana]")) {
	boton.addEventListener("click", () => mostrarPestana(boton.dataset.pestana));
}

function mostrarPestana(nombre) {
	estado.pestana = nombre;
	for (const boton of document.querySelectorAll("[data-pestana]")) boton.setAttribute("aria-selected", String(boton.dataset.pestana === nombre));
	for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== nombre;
	if (!estado.ficha || estado.cargadas.has(nombre)) return;
	estado.cargadas.add(nombre);
	if (nombre === "pdf") $("#visor-pdf").src = `/api/documentos/${encodeURIComponent(estado.ficha.id)}/pdf`;
	if (["json", "xml", "texto"].includes(nombre)) pintarArchivo(nombre);
}

async function pintarArchivo(tipo) {
	const id = estado.ficha.id;
	const pagina = estado.pagina;
	const destino = $(`#codigo-${tipo}`);
	const nota = $(`#nota-${tipo}`);
	destino.textContent = "Cargando…";
	nota.textContent = "";
	// En la pestaña Texto se añade al final lo leído con OCR en las páginas que eran imagen.
	const conOcr = tipo === "texto" && paginasConOcr(estado.ficha).size > 0;
	try {
		const [respuesta, ocr] = await Promise.all([
			fetch(urlArchivo(tipo, { limite: LIMITE_VISTA })),
			conOcr ? api(`/api/documentos/${encodeURIComponent(id)}/ocr`).catch(() => null) : null,
		]);
		if (!respuesta.ok) throw new Error((await respuesta.json()).error);
		const total = Number(respuesta.headers.get("X-Tamano-Total"));
		const texto = await respuesta.text();
		// Si mientras tanto se eligió otro documento u otra página, esta respuesta ya no sirve.
		if (estado.ficha?.id !== id || (tipo !== "texto" && estado.pagina !== pagina)) return;
		if (tipo === "json") destino.innerHTML = resaltarJson(texto);
		else if (tipo === "xml") destino.innerHTML = resaltarXml(texto);
		else destino.textContent = (texto || "(El PDF no tiene texto extraíble; puede ser una imagen escaneada.)") + textoOcr(ocr);
		destino.scrollTop = 0;
		nota.textContent = total > LIMITE_VISTA ? `Vista previa: primeros ${tamano(LIMITE_VISTA)} de ${tamano(total)}. Descarga el archivo para verlo completo.` : tamano(total);
		if (ocr) nota.textContent += " · al final, el texto leído con OCR";
	} catch (error) {
		destino.textContent = `No se pudo cargar: ${error.message}`;
	}
}

function textoOcr(ocr) {
	if (!ocr) return "";
	return Object.entries(ocr.paginas)
		.filter(([, pagina]) => pagina.texto)
		.map(([numero, pagina]) => `\n\n──── Página ${numero} · leída con OCR (confianza ${pagina.confianza} %) ────\n\n${pagina.texto}`)
		.join("");
}

$("#eliminar").addEventListener("click", async () => {
	const ficha = estado.ficha;
	if (!ficha || !confirm(`¿Eliminar «${ficha.nombre}» de la biblioteca?\nSe borran el PDF, el texto y el JSON y el XML guardados (completos y por página).`)) return;
	try {
		await api(`/api/documentos/${encodeURIComponent(ficha.id)}`, { method: "DELETE" });
		avisar("Documento eliminado");
		mostrarVacio();
		await cargarLista();
	} catch (error) {
		avisar(error.message, true);
	}
});

// ---------- Copiar ----------

for (const boton of document.querySelectorAll("[data-copiar]")) {
	boton.addEventListener("click", async () => {
		const tipo = boton.dataset.copiar;
		try {
			let texto;
			if (tipo === "conversor") {
				texto = estado.xmlConvertido ?? "";
			} else {
				const respuesta = await fetch(urlArchivo(tipo));
				texto = await respuesta.text();
			}
			await navigator.clipboard.writeText(texto);
			avisar("Copiado al portapapeles");
		} catch (error) {
			avisar(`No se pudo copiar: ${error.message}`, true);
		}
	});
}

// ---------- Opciones del XML ----------

function rellenarOpcionesXml(formulario, opciones) {
	formulario.raiz.value = opciones.raiz;
	formulario.sangria.value = String(opciones.sangria);
	formulario.atributos.value = opciones.atributos.join("\n");
	formulario.contenido.value = opciones.contenido.join("\n");
}

function leerOpcionesXml(formulario) {
	const lineas = (texto) => texto.split("\n").map((linea) => linea.trim()).filter(Boolean);
	return {
		raiz: formulario.raiz.value.trim() || "documento",
		sangria: formulario.sangria.value === "null" ? null : Number(formulario.sangria.value),
		atributos: lineas(formulario.atributos.value),
		contenido: lineas(formulario.contenido.value),
	};
}

$("#preset-compacto").addEventListener("click", () => {
	const formulario = $("#opciones-xml");
	formulario.atributos.value = presetCompactoPdf2json(formulario.raiz.value.trim() || "PDF").atributos.join("\n");
});

$("#preset-limpiar").addEventListener("click", () => {
	const formulario = $("#opciones-xml");
	formulario.atributos.value = "";
	formulario.contenido.value = "";
});

$("#opciones-xml").addEventListener("submit", async (evento) => {
	evento.preventDefault();
	const boton = evento.submitter;
	boton.disabled = true;
	try {
		const ficha = await api(`/api/documentos/${encodeURIComponent(estado.ficha.id)}/xml`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(leerOpcionesXml(evento.target)),
		});
		estado.ficha = ficha;
		pintarFicha(ficha);
		await pintarArchivo("xml");
		avisar(`XML regenerado (${tamano(ficha.bytes.xml)})`);
	} catch (error) {
		avisar(error.message, true);
	} finally {
		boton.disabled = false;
	}
});

// ---------- Conversor JSON → XML (corre en el navegador) ----------

const EJEMPLO = { owner: { id: 124, name: "John Doe" } };
const entrada = $("#entrada-json");
const formularioConversor = $("#opciones-conversor");

let temporizadorConversor;
function convertirPronto() {
	clearTimeout(temporizadorConversor);
	temporizadorConversor = setTimeout(convertir, 200);
}

function convertir() {
	const texto = entrada.value.trim();
	const estadoConversor = $("#estado-conversor");
	const salida = $("#salida-xml");
	if (texto.length < 200 * 1024) guardarPreferencia("conversor-json", entrada.value);
	if (!texto) {
		estado.xmlConvertido = null;
		salida.textContent = "";
		estadoConversor.textContent = "Pega un JSON o abre un archivo";
		estadoConversor.classList.remove("error");
		entrada.classList.remove("invalido");
		return;
	}
	try {
		const xml = jsonAXml(texto, leerOpcionesXml(formularioConversor));
		estado.xmlConvertido = xml;
		salida.innerHTML = resaltarXml(xml.length > LIMITE_VISTA ? xml.slice(0, LIMITE_VISTA) : xml);
		estadoConversor.textContent = xml.length > LIMITE_VISTA ? `Vista previa de ${tamano(xml.length)}; usa Descargar para el completo` : tamano(new Blob([xml]).size);
		estadoConversor.classList.remove("error");
		entrada.classList.remove("invalido");
	} catch (error) {
		estado.xmlConvertido = null;
		estadoConversor.textContent = `JSON no válido: ${error.message}`;
		estadoConversor.classList.add("error");
		entrada.classList.add("invalido");
	}
}

entrada.addEventListener("input", convertirPronto);
formularioConversor.addEventListener("input", convertirPronto);
formularioConversor.addEventListener("submit", (evento) => evento.preventDefault());

$("#ejemplo-json").addEventListener("click", () => {
	entrada.value = JSON.stringify(EJEMPLO, null, 2);
	formularioConversor.atributos.value = "/owner/id";
	formularioConversor.contenido.value = "/owner/name";
	convertir();
});

$("#abrir-json").addEventListener("change", async (evento) => {
	const [archivo] = evento.target.files;
	if (!archivo) return;
	entrada.value = await archivo.text();
	evento.target.value = "";
	convertir();
});

$("#descargar-conversor").addEventListener("click", () => {
	if (!estado.xmlConvertido) return avisar("No hay XML que descargar", true);
	const enlace = document.createElement("a");
	enlace.href = URL.createObjectURL(new Blob([estado.xmlConvertido], { type: "application/xml" }));
	enlace.download = "convertido.xml";
	enlace.click();
	setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
});

// ---------- Inicio ----------

function idEnUrl() {
	return decodeURIComponent(location.hash.match(/^#doc=(.+)$/)?.[1] ?? "");
}

window.addEventListener("hashchange", () => {
	if (idEnUrl() && idEnUrl() !== estado.ficha?.id) seleccionar(idEnUrl());
});

entrada.value = leerPreferencia("conversor-json") ?? "";
await cargarLista();
if (idEnUrl()) seleccionar(idEnUrl());
else if (estado.documentos.length) seleccionar(estado.documentos[0].id);
