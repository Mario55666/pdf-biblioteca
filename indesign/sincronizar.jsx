/*
    sincronizar.jsx · Actualiza un documento ya reconstruido con el contenido de datos/documento.xml

    Usa el protocolo de sincronización de porky: cada elemento Texto y OCR del XML lleva los
    atributos syncScript="sync/texto.jsx" y syncIdentifier="<id>". porky recorre la estructura,
    ejecuta ese script por elemento y sustituye su contenido por lo que devuelve.

    Sirve, por ejemplo, para corregir errores del OCR en el XML y llevarlos al documento sin
    volver a reconstruirlo: la posición, el estilo y el resto del diseño se conservan.

    Uso: con el documento reconstruido abierto y activo, doble clic en el panel Scripts.
*/

//@include "porky/bin/porky.jsx"
//@include "lib/atlas-porky.jsx"

(function () {
    if (!app.documents.length) {
        alert("Abre primero el documento reconstruido.");
        return;
    }
    var doc = app.activeDocument;
    var carpeta = File($.fileName).parent.fsName;

    // Textos del XML corregido, por id. El XML se lee con E4X (sin la declaración ni la DOCTYPE).
    var fuente = atlas.leerTexto(carpeta + "/datos/documento.xml")
        .replace(/<\?xml[^>]*\?>/, "")
        .replace(/<!DOCTYPE[^>]*>/, "");
    var xml = new XML(fuente);
    $.global.ATLAS_TEXTOS = {};
    var elementos = xml..*;
    for (var i = 0; i < elementos.length(); i++) {
        var elemento = elementos[i];
        var nombre = elemento.localName();
        if ((nombre === "Texto" || nombre === "OCR") && elemento.@id.length()) {
            $.global.ATLAS_TEXTOS[String(elemento.@id)] = String(elemento.text());
        }
    }

    // Cuenta lo que cambia antes de sincronizar, para el aviso final.
    var cambios = contarCambios(doc.xmlElements[0], $.global.ATLAS_TEXTOS);

    // porky: settings.sync.scriptFolder es la carpeta desde la que se resuelven los syncScript.
    settings.sync.scriptFolder = carpeta + "/";
    app.doScript(function () {
        recursiveSyncXMLElement(doc.xmlElements[0]);
    }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "Sincronizar con el XML");

    alert("Sincronización terminada: " + cambios + " elementos cambiaron de contenido.");
})();

function contarCambios(elemento, textos) {
    var cambios = 0;
    var id = elemento.xmlAttributes.itemByName("syncIdentifier");
    if (id.isValid && textos.hasOwnProperty(id.value) && textos[id.value] !== elemento.contents) {
        cambios++;
    }
    for (var i = 0; i < elemento.xmlElements.length; i++) {
        cambios += contarCambios(elemento.xmlElements[i], textos);
    }
    return cambios;
}
