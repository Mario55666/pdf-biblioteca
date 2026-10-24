/*
    sync/texto.jsx · Script de sincronización de porky

    porky lo ejecuta con $.evalFile para cada elemento con syncScript="sync/texto.jsx" y usa
    el valor de la última expresión como nuevo contenido. settings.sync.identifier trae el id
    del elemento; sincronizar.jsx deja los textos del XML en $.global.ATLAS_TEXTOS.
    Si el id no está, se lanza un error: porky lo registra y deja el contenido como estaba.
*/
(function (id) {
    if (!$.global.ATLAS_TEXTOS || !$.global.ATLAS_TEXTOS.hasOwnProperty(id)) {
        throw new Error("Sin texto para " + id);
    }
    return $.global.ATLAS_TEXTOS[id];
})(settings.sync.identifier);
