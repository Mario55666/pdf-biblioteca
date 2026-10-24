/*
    reconstruir.jsx · Reconstruye en InDesign un documento de la Biblioteca PDF

    Lee los dos instrumentos del paquete:
      datos/plan.json      (JSON) geometría y formato: páginas, capas, colores, estilos y marcos en puntos
      datos/documento.xml  (XML)  contenido y estructura: un elemento por marco, con aid:pstyle
    y construye el documento:
      1. Crea el documento, las capas, los colores y los estilos de párrafo (JSON).
      2. Importa el XML a la estructura de InDesign y lo valida con datos/atlas-indesign.dtd.
      3. Por cada página: coloca el PDF original en su capa y crea rellenos, líneas, campos,
         textos y líneas de OCR en su posición (JSON); cada marco recibe su elemento del XML.
      4. Guarda en salida/ el .indd, el .idml, el XML exportado, vistas JPG e informe.json.

    Uso: panel Scripts de InDesign > doble clic. Requiere InDesign CS6 o posterior.
*/

//@include "porky/bin/porky.jsx"
//@include "lib/atlas-porky.jsx"

var CONFIG = {
    colocarOriginal: true,      // capa "Original PDF" con la página original debajo de la reconstrucción
    bloquearOriginal: true,
    guardarIndd: true,
    exportarIdml: true,
    exportarXml: true,          // XML de la estructura, exportado desde InDesign (ida y vuelta)
    vistas: 5,                  // páginas que se exportan en JPG sin la capa original (0 = ninguna)
    cerrarAlTerminar: false
};

// Al ejecutar desde otro programa (app.doScript con argumentos) se pueden cambiar opciones.
if (typeof arguments !== "undefined" && arguments.length && arguments[0]) {
    var cambios = JSON.parse(arguments[0]);
    for (var clave in cambios) {
        CONFIG[clave] = cambios[clave];
    }
}

(function () {
    var carpeta = File($.fileName).parent.fsName;
    var inicio = new Date().getTime();
    var plan = atlas.leerJson(carpeta + "/datos/plan.json");
    var informe = null;

    app.scriptPreferences.enableRedraw = false;
    app.doScript(function () {
        informe = reconstruir(carpeta, plan);
    }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "Reconstruir " + plan.documento.titulo);
    app.scriptPreferences.enableRedraw = true;

    informe.tiempoSegundos = Math.round((new Date().getTime() - inicio) / 100) / 10;
    informe.registro = atlas.registro.slice(-60);
    atlas.escribirJson(carpeta + "/salida/informe.json", informe);

    if (app.scriptPreferences.userInteractionLevel !== UserInteractionLevels.NEVER_INTERACT) {
        alert("Reconstrucción terminada en " + informe.tiempoSegundos + " s.\n\n"
            + informe.paginas.length + " páginas · " + informe.marcos.textos + " textos · "
            + informe.marcos.ocr + " líneas de OCR\n"
            + "Fuentes faltantes: " + (informe.fuentesFaltantes.length ? informe.fuentesFaltantes.join(", ") : "ninguna") + "\n"
            + "Validación DTD: " + (informe.validacion.validado ? informe.validacion.errores + " errores" : "no disponible") + "\n\n"
            + "Archivos en: " + carpeta + "/salida");
    }
})();

function reconstruir(carpeta, plan) {
    var salida = atlas.carpeta(carpeta + "/salida").fsName;
    var archivoPdf = File(carpeta + "/datos/" + plan.documento.archivoPdf);
    var progreso = atlas.progreso("Reconstrucción · " + plan.documento.titulo, plan.paginas.length + 2);

    // 1. Documento, capas, colores y estilos (JSON).
    progreso.avanzar(0, "Creando documento, capas y estilos…");
    var doc = atlas.crearDocumento(plan);
    var capas = atlas.crearCapas(doc, plan.capas);
    var colores = atlas.crearColores(doc, plan.colores);
    var estilos = atlas.crearEstilos(doc, plan.estilos);

    // 2. Estructura (XML) y validación con la DTD.
    progreso.avanzar(1, "Importando el XML…");
    var indice = atlas.importarXml(doc, carpeta + "/datos/" + plan.documento.archivoXml);
    var validacion = atlas.validarXml(doc, carpeta + "/datos/atlas-indesign.dtd");

    // 3. Páginas y marcos.
    var marcos = { originales: 0, rellenos: 0, lineas: 0, campos: 0, textos: 0, ocr: 0 };
    for (var i = 0; i < plan.paginas.length; i++) {
        var def = plan.paginas[i];
        progreso.avanzar(i + 2, "Página " + def.numero + " (" + (i + 1) + " de " + plan.paginas.length + ")");
        var pagina = atlas.prepararPagina(doc, i, def);

        if (CONFIG.colocarOriginal && archivoPdf.exists) {
            doc.activeLayer = capas["Original PDF"];
            if (atlas.colocarOriginal(doc, pagina, def, archivoPdf, indice["p" + def.numero + "-original"])) {
                marcos.originales++;
            }
        }
        marcos.rellenos += atlas.rellenos(pagina, def.rellenos, capas["Rellenos"], colores, indice);
        marcos.lineas += atlas.lineas(doc, pagina, def.lineas, capas["Líneas"], colores, indice);
        marcos.campos += atlas.campos(doc, pagina, def.campos, capas["Campos"], indice);
        marcos.textos += atlas.textos(doc, def.textos, capas["Texto"], colores, estilos, indice);
        marcos.ocr += atlas.ocr(doc, def.ocr, capas["OCR"], estilos, indice);
    }
    if (CONFIG.bloquearOriginal) {
        capas["Original PDF"].locked = true;
    }
    doc.activeLayer = capas["Texto"];

    // 4. Archivos de salida.
    progreso.avanzar(plan.paginas.length + 2, "Guardando…");
    var base = salida + "/" + (plan.documento.id || "reconstruccion");
    var archivos = {};
    if (CONFIG.guardarIndd) {
        doc.save(File(base + ".indd"));
        archivos.indd = File(base + ".indd").name;
    }
    if (CONFIG.exportarIdml) {
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, File(base + ".idml"), false);
        archivos.idml = File(base + ".idml").name;
    }
    if (CONFIG.exportarXml) {
        doc.exportFile(ExportFormat.XML, File(base + "-estructura.xml"), false);
        archivos.xml = File(base + "-estructura.xml").name;
    }
    if (CONFIG.vistas > 0) {
        archivos.vistas = atlas.exportarVistas(doc, salida, capas["Original PDF"], CONFIG.vistas);
    }

    var informe = {
        formato: "atlas-indesign-informe",
        version: "1.0",
        generado: new Date().toUTCString(),
        indesign: app.version,
        documento: plan.documento,
        paginas: plan.documento.paginas,
        marcos: marcos,
        estilos: plan.estilos.length,
        colores: plan.colores.length,
        fuentesFaltantes: atlas.fuentesFaltantes(doc),
        fuentesOriginales: atlas.fuentesOriginales,
        desbordes: atlas.contarDesbordes(doc),
        validacion: validacion,
        elementosXml: (function () { var n = 0; for (var k in indice) { n++; } return n; })(),
        archivos: archivos
    };
    progreso.cerrar();
    if (CONFIG.cerrarAlTerminar) {
        doc.close(SaveOptions.NO);
    }
    return informe;
}
