/*
    atlas-porky.jsx · Capa de adaptación entre porky y la Biblioteca PDF / Atlas de la diagramación

    porky (Schreiber & Freunde, MIT) aporta las funciones de maquetación y sincronización:
    setPageSize, addNewPage, addFrame, modifyFrame, readFile/writeFile y syncXMLElement.
    Esta capa adapta porky a los datos del paquete (datos/plan.json y datos/documento.xml):

    - console.log sin servidor: porky intenta abrir un socket en 127.0.0.1:6789 en cada mensaje;
      sin su servidor de Node eso tarda en cada marco, así que aquí se reemplaza por un registro.
    - Lectura en UTF-8: readFile de porky lee con la codificación del sistema y estropea tildes.
    - Unidades y origen: todo en puntos, con el origen en la esquina de cada página.
    - Lo que porky no tiene: colores, capas, estilos de párrafo, líneas, rellenos y el protocolo
      XML de InDesign (importXML + placeXML + validación con DTD).

    Se incluye después de porky:
        //@include "porky/bin/porky.jsx"
        //@include "lib/atlas-porky.jsx"
    Escrito en ExtendScript (ES3): sin let/const, funciones flecha ni métodos de arreglo modernos.
*/

var atlas = {
    version: "1.0",
    registro: []
};

// ---------- Registro (sustituye el console.log de porky) ----------

// Avisos de rutina de porky (uno por marco) que no aportan al informe.
atlas.RUTINA_PORKY = /^(Frame added|String appended|Image appended|Table appended|File read: )/;

console.log = function (mensaje) {
    if (typeof mensaje === "object") {
        mensaje = mensaje.toSource();
    }
    mensaje = String(mensaje);
    if (atlas.RUTINA_PORKY.test(mensaje)) {
        return true;
    }
    atlas.registro.push(mensaje);
    if (atlas.registro.length > 400) {
        atlas.registro.shift();
    }
    $.writeln(mensaje);
    return true;
};

// ---------- Archivos ----------

atlas.leerTexto = function (ruta) {
    var archivo = File(ruta);
    if (!archivo.exists) {
        throw new Error("No existe el archivo " + ruta);
    }
    archivo.encoding = "UTF-8";
    archivo.open("r");
    var contenido = archivo.read();
    archivo.close();
    return contenido;
};

atlas.leerJson = function (ruta) {
    // JSON viene de json2.js, que porky incluye (ExtendScript no lo trae).
    return JSON.parse(atlas.leerTexto(ruta));
};

atlas.escribirJson = function (ruta, datos) {
    // writeFile de porky ya escribe en UTF-8.
    return writeFile(ruta, JSON.stringify(datos, null, 2), "Unix");
};

atlas.carpeta = function (ruta) {
    var carpeta = Folder(ruta);
    if (!carpeta.exists) {
        carpeta.create();
    }
    return carpeta;
};

// ---------- Documento ----------

atlas.crearDocumento = function (plan) {
    var primera = plan.paginas[0];
    var doc = app.documents.add(true);
    doc.documentPreferences.facingPages = false;
    doc.documentPreferences.pagesPerDocument = 1;
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
    doc.zeroPoint = [0, 0];
    // porky: setPageSize trabaja sobre el documento activo y en sus unidades (ya en puntos).
    setPageSize(primera.ancho, primera.alto);
    doc.marginPreferences.properties = { top: 0, bottom: 0, left: 0, right: 0, columnCount: 1 };
    var maestra = doc.masterSpreads[0];
    for (var i = 0; i < maestra.pages.length; i++) {
        maestra.pages[i].marginPreferences.properties = { top: 0, bottom: 0, left: 0, right: 0 };
    }
    doc.metadataPreferences.documentTitle = plan.documento.titulo;
    return doc;
};

atlas.crearCapas = function (doc, nombres) {
    // Las capas nuevas se apilan encima: la primera del plan queda abajo.
    var capas = {};
    var base = doc.layers[0];
    base.name = nombres[0];
    capas[nombres[0]] = base;
    for (var i = 1; i < nombres.length; i++) {
        capas[nombres[i]] = doc.layers.add({ name: nombres[i] });
    }
    return capas;
};

atlas.crearColores = function (doc, lista) {
    var colores = {};
    for (var i = 0; i < lista.length; i++) {
        var hex = lista[i];
        if (hex === "#000000") {
            colores[hex] = doc.swatches.itemByName("Black");
            continue;
        }
        if (hex === "#ffffff") {
            colores[hex] = doc.swatches.itemByName("Paper");
            continue;
        }
        var nombre = "Atlas " + hex.toUpperCase();
        var existente = doc.colors.itemByName(nombre);
        colores[hex] = existente.isValid ? existente : doc.colors.add({
            name: nombre,
            model: ColorModel.PROCESS,
            space: ColorSpace.RGB,
            colorValue: [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)]
        });
    }
    return colores;
};

// Fuentes instaladas por nombre PostScript (el que trae el PDF), también en forma simplificada
// ("Minion-Regular" ~ "minionregular") para tolerar diferencias de guiones y mayúsculas.
atlas.fuentesInstaladas = function () {
    var porNombre = {};
    var nombres = app.fonts.everyItem().postscriptName;
    for (var i = 0; i < nombres.length; i++) {
        if (nombres[i]) {
            porNombre[nombres[i]] = i;
            porNombre[atlas.simplificar(nombres[i])] = i;
        }
    }
    return porNombre;
};

atlas.simplificar = function (nombre) {
    return String(nombre).toLowerCase().replace(/[^a-z0-9]/g, "");
};

atlas.fuenteOriginal = function (instaladas, nombrePS) {
    var indice = instaladas[nombrePS];
    if (indice === undefined) {
        indice = instaladas[atlas.simplificar(nombrePS)];
    }
    return indice === undefined ? null : app.fonts[indice];
};

atlas.crearEstilos = function (doc, lista) {
    var estilos = {};
    var instaladas = atlas.fuentesInstaladas();
    atlas.fuentesOriginales = { usadas: [], noInstaladas: [] };
    for (var i = 0; i < lista.length; i++) {
        var def = lista[i];
        var estilo = doc.paragraphStyles.itemByName(def.nombre);
        if (!estilo.isValid) {
            estilo = doc.paragraphStyles.add({ name: def.nombre });
        }
        estilo.properties = { pointSize: def.cuerpo, leading: def.interlineado, hyphenation: false, tracking: 0 };
        // Primero la fuente original del PDF, si está instalada; si no, la familia de respaldo.
        var original = def.fuentePS ? atlas.fuenteOriginal(instaladas, def.fuentePS) : null;
        try {
            if (original) {
                estilo.appliedFont = original;
                atlas.anotar(atlas.fuentesOriginales.usadas, def.fuentePS);
            } else {
                estilo.appliedFont = def.fuente;
                estilo.fontStyle = def.estilo;
                if (def.fuentePS) {
                    atlas.anotar(atlas.fuentesOriginales.noInstaladas, def.fuentePS);
                }
            }
        } catch (error) {
            console.log("Fuente no disponible: " + def.fuente + " " + def.estilo);
        }
        estilos[def.nombre] = estilo;
    }
    return estilos;
};

atlas.anotar = function (lista, valor) {
    for (var i = 0; i < lista.length; i++) {
        if (lista[i] === valor) {
            return;
        }
    }
    lista.push(valor);
};

atlas.prepararPagina = function (doc, indice, def) {
    // porky: addNewPage añade la página al final y la deja activa.
    var pagina = indice === 0 ? doc.pages[0] : addNewPage();
    app.activeWindow.activePage = pagina;
    pagina.marginPreferences.properties = { top: 0, bottom: 0, left: 0, right: 0 };
    var bounds = pagina.bounds;
    if (Math.abs(bounds[3] - bounds[1] - def.ancho) > 0.5 || Math.abs(bounds[2] - bounds[0] - def.alto) > 0.5) {
        try {
            pagina.resize(CoordinateSpaces.INNER_COORDINATES, AnchorPoint.TOP_LEFT_ANCHOR, ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH, [def.ancho, def.alto]);
        } catch (error) {
            console.log("No se pudo cambiar el tamaño de la página " + def.numero + ": " + error);
        }
    }
    return pagina;
};

// ---------- Protocolo XML de InDesign ----------

atlas.importarXml = function (doc, rutaXml) {
    var prefs = doc.xmlImportPreferences;
    prefs.importStyle = XMLImportStyles.MERGE_IMPORT;
    prefs.createLinkToXML = false;
    prefs.repeatTextElements = false;
    prefs.ignoreWhitespace = true;
    prefs.removeUnmatchedExisting = false;
    prefs.ignoreUnmatchedIncoming = false;
    prefs.importToSelected = false;
    prefs.allowTransform = false;
    prefs.importCALSTables = false;
    prefs.importTextIntoTables = false;
    doc.importXML(File(rutaXml));
    var indice = {};
    atlas.indexarXml(doc.xmlElements[0], indice);
    return indice;
};

atlas.indexarXml = function (elemento, indice) {
    var id = elemento.xmlAttributes.itemByName("id");
    if (id.isValid) {
        indice[id.value] = elemento;
    }
    for (var i = 0; i < elemento.xmlElements.length; i++) {
        atlas.indexarXml(elemento.xmlElements[i], indice);
    }
};

atlas.validarXml = function (doc, rutaDtd) {
    try {
        if (doc.dtds.length === 0) {
            doc.importDtd(File(rutaDtd));
        }
        var errores = doc.xmlElements[0].validate(20);
        var mensajes = [];
        for (var i = 0; i < errores.length; i++) {
            mensajes.push(String(errores[i].errorMessage || errores[i]));
        }
        return { validado: true, errores: errores.length, mensajes: mensajes };
    } catch (error) {
        return { validado: false, errores: null, mensajes: [String(error)] };
    }
};

// Asocia un marco gráfico (rectángulo, línea) con su elemento del XML.
atlas.etiquetar = function (objeto, elemento) {
    if (elemento) {
        objeto.markup(elemento);
    }
    return objeto;
};

// ---------- Marcos ----------

atlas.colocarOriginal = function (doc, pagina, def, archivoPdf, elemento) {
    app.pdfPlacePreferences.pageNumber = def.original.pagina;
    app.pdfPlacePreferences.pdfCrop = PDFCrop.CROP_PDF;
    app.pdfPlacePreferences.transparentBackground = true;
    // porky: addFrame con un archivo crea el marco y coloca el PDF en la página activa.
    var marco = addFrame(0, 0, def.ancho, def.alto, archivoPdf);
    if (marco && marco.isValid) {
        marco.fit(FitOptions.CENTER_CONTENT);
        marco.strokeWeight = 0;
        atlas.etiquetar(marco, elemento);
    }
    return marco;
};

atlas.rellenos = function (pagina, lista, capa, colores, indice) {
    for (var i = 0; i < lista.length; i++) {
        var r = lista[i];
        var marco = pagina.rectangles.add({
            itemLayer: capa,
            geometricBounds: [r.y, r.x, r.y + r.alto, r.x + r.ancho],
            fillColor: colores[r.color],
            strokeWeight: 0
        });
        atlas.etiquetar(marco, indice[r.id]);
    }
    return lista.length;
};

atlas.lineas = function (doc, pagina, lista, capa, colores, indice) {
    for (var i = 0; i < lista.length; i++) {
        var l = lista[i];
        var linea = pagina.graphicLines.add({ itemLayer: capa });
        linea.geometricBounds = [l.y1, l.x1, l.y2, l.x2];
        linea.strokeWeight = l.grosor;
        linea.strokeColor = colores[l.color];
        if (l.discontinua) {
            try {
                linea.strokeType = doc.strokeStyles.itemByName("$ID/Dashed");
            } catch (error) {
                console.log("Sin estilo de trazo discontinuo: " + error);
            }
        }
        atlas.etiquetar(linea, indice[l.id]);
    }
    return lista.length;
};

atlas.campos = function (doc, pagina, lista, capa, indice) {
    var gris = doc.swatches.itemByName("Black");
    for (var i = 0; i < lista.length; i++) {
        var c = lista[i];
        var marco = pagina.rectangles.add({
            itemLayer: capa,
            geometricBounds: [c.y, c.x, c.y + c.alto, c.x + c.ancho],
            strokeWeight: 0.5,
            strokeColor: gris,
            strokeTint: 40
        });
        atlas.etiquetar(marco, indice[c.id]);
    }
    return lista.length;
};

// Marco de texto anclado a la línea base que midió pdf2json. El primer renglón se coloca a una
// distancia fija del borde superior (FIXED_HEIGHT), así la línea base cae justo en su sitio.
atlas.marcoTexto = function (doc, capa, x, lineaBase, cuerpo, elemento) {
    doc.activeLayer = capa;
    var ascenso = cuerpo * 0.8;
    // porky: addFrame crea el marco en la página activa (x, y, ancho, alto, contenido).
    var marco = addFrame(x, lineaBase - ascenso, Math.max(cuerpo * 2, 4), cuerpo * 1.3, "");
    var prefs = marco.textFramePreferences;
    prefs.insetSpacing = [0, 0, 0, 0];
    prefs.firstBaselineOffset = FirstBaseline.FIXED_HEIGHT;
    prefs.minimumFirstBaselineOffset = ascenso;
    if (elemento) {
        // Protocolo XML: el contenido del elemento entra en el marco con su aid:pstyle.
        elemento.placeXML(marco);
    }
    // El ancho real depende de la fuente: el marco se ajusta al texto en una sola línea.
    prefs.useNoLineBreaksForAutoSizing = true;
    prefs.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_LEFT_POINT;
    prefs.autoSizingType = AutoSizingTypeEnum.WIDTH_ONLY;
    return marco;
};

atlas.textos = function (doc, lista, capa, colores, estilos, indice) {
    for (var i = 0; i < lista.length; i++) {
        var t = lista[i];
        var marco = atlas.marcoTexto(doc, capa, t.x, t.lineaBase, t.cuerpo, indice[t.id]);
        var historia = marco.parentStory;
        if (estilos[t.estilo] && historia.paragraphs.length) {
            historia.paragraphs.everyItem().appliedParagraphStyle = estilos[t.estilo];
        }
        if (t.color !== "#000000" && colores[t.color]) {
            historia.texts[0].fillColor = colores[t.color];
        }
        atlas.ajustarAncho(marco, t.ancho);
        if (t.rotacion) {
            marco.absoluteRotationAngle = -t.rotacion;
        }
    }
    return lista.length;
};

atlas.ocr = function (doc, lista, capa, estilos, indice) {
    for (var i = 0; i < lista.length; i++) {
        var o = lista[i];
        // La caja del OCR va de ascendentes a descendentes; la línea base queda cerca del 80 %.
        var marco = atlas.marcoTexto(doc, capa, o.x, o.y + o.alto * 0.8, o.cuerpo, indice[o.id]);
        var historia = marco.parentStory;
        if (estilos.OCR && historia.paragraphs.length) {
            historia.paragraphs.everyItem().appliedParagraphStyle = estilos.OCR;
        }
        historia.texts[0].pointSize = o.cuerpo;
        historia.texts[0].leading = o.cuerpo * 1.2;
        atlas.ajustarAncho(marco, o.ancho);
    }
    return lista.length;
};

// Con una fuente distinta de la original el texto ocupa otro ancho: la escala horizontal lo
// devuelve al ancho medido en el PDF (o en la caja del OCR), entre 50 % y 200 %.
atlas.ajustarAncho = function (marco, ancho) {
    var historia = marco.parentStory;
    if (!ancho || !historia.characters.length) {
        return;
    }
    var limites = marco.geometricBounds;
    var natural = limites[3] - limites[1];
    if (natural > 0) {
        var escala = Math.max(50, Math.min(200, ancho / natural * 100));
        if (Math.abs(escala - 100) > 1.5) {
            historia.texts[0].horizontalScale = escala;
        }
    }
};

// ---------- Informe ----------

atlas.fuentesFaltantes = function (doc) {
    var faltantes = [];
    for (var i = 0; i < doc.fonts.length; i++) {
        var fuente = doc.fonts[i];
        if (fuente.status !== FontStatus.INSTALLED) {
            faltantes.push(fuente.name);
        }
    }
    return faltantes;
};

atlas.contarDesbordes = function (doc) {
    var desbordes = 0;
    var marcos = doc.textFrames.everyItem().getElements();
    for (var i = 0; i < marcos.length; i++) {
        if (marcos[i].overflows) {
            desbordes++;
        }
    }
    return desbordes;
};

atlas.exportarVistas = function (doc, carpeta, capaOriginal, maximo) {
    var archivos = [];
    var visible = capaOriginal.visible;
    capaOriginal.visible = false;
    app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
    app.jpegExportPreferences.exportResolution = 96;
    app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.HIGH;
    for (var i = 0; i < doc.pages.length && i < maximo; i++) {
        var nombre = "vista-reconstruida-" + atlas.tresCifras(i + 1) + ".jpg";
        app.jpegExportPreferences.pageString = doc.pages[i].name;
        doc.exportFile(ExportFormat.JPG, File(carpeta + "/" + nombre), false);
        archivos.push(nombre);
    }
    capaOriginal.visible = visible;
    return archivos;
};

atlas.tresCifras = function (numero) {
    var texto = String(numero);
    while (texto.length < 3) {
        texto = "0" + texto;
    }
    return texto;
};

// ---------- Progreso ----------

atlas.progreso = function (titulo, total) {
    if (app.scriptPreferences.userInteractionLevel === UserInteractionLevels.NEVER_INTERACT) {
        return { avanzar: function () {}, cerrar: function () {} };
    }
    var ventana = new Window("palette", titulo);
    var texto = ventana.add("statictext", undefined, "Preparando…");
    texto.preferredSize = [320, 20];
    var barra = ventana.add("progressbar", undefined, 0, total);
    barra.preferredSize = [320, 12];
    ventana.show();
    return {
        avanzar: function (valor, mensaje) {
            barra.value = valor;
            texto.text = mensaje;
            ventana.update();
        },
        cerrar: function () {
            ventana.close();
        }
    };
};
