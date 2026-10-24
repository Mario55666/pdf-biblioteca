// Rutas de forceAttribute/forceContent pensadas para la salida de pdf2json.
// Se usa en el servidor, en la CLI y en el navegador.

const ATRIBUTOS_PDF2JSON = {
	Pages: ["Width", "Height"],
	"Pages/HLines": ["x", "y", "w", "l", "oc", "clr", "dsh"],
	"Pages/VLines": ["x", "y", "w", "l", "oc", "clr", "dsh"],
	"Pages/Fills": ["x", "y", "w", "h", "oc", "clr"],
	"Pages/Texts": ["x", "y", "w", "sw", "A", "oc", "clr"],
	"Pages/Texts/R": ["S"],
	"Pages/Fields": ["style", "TI", "AM", "TU", "x", "y", "w", "h", "V", "checked"],
	"Pages/Fields/T": ["Name"],
	"Pages/Fields/id": ["Id", "EN"],
	"Pages/Boxsets/id": ["Id", "EN"],
	"Pages/Boxsets/boxes": ["style", "TI", "AM", "TU", "x", "y", "w", "h", "V", "checked"],
	"Pages/Boxsets/boxes/T": ["Name"],
	"Pages/Boxsets/boxes/id": ["Id", "EN"],
	// Solo en el JSON y el XML de las páginas leídas con OCR.
	OCR: ["motor", "idiomas", "confianza"],
	"OCR/lineas": ["confianza", "x", "y", "w", "h"],
};

/**
 * Preset "compacto": convierte en atributos las coordenadas, medidas y colores de pdf2json,
 * así cada línea, relleno o texto ocupa una sola etiqueta.
 * @param {string} raiz etiqueta raíz con la que se envuelve el JSON
 */
export function presetCompactoPdf2json(raiz = "PDF") {
	const atributos = [];
	for (const [ruta, claves] of Object.entries(ATRIBUTOS_PDF2JSON)) {
		for (const clave of claves) atributos.push(`/${raiz}/${ruta}/${clave}`);
	}
	return { atributos, contenido: [] };
}
