// Este módulo registra a PWA sem interferir nos módulos do Firebase e da reprodução.
// O endereço é calculado a partir deste arquivo para funcionar também em /Spotigab/ no GitHub Pages.
if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', async () => {
        const caminhoWorker = new URL('../service-worker.js', import.meta.url);
        const escopoApp = new URL('../', import.meta.url).pathname;

        try {
            // register() instala o worker no diretório do app; updateViaCache evita validar versões pelo cache HTTP.
            const registro = await navigator.serviceWorker.register(caminhoWorker.href, {
                scope: escopoApp,
                updateViaCache: 'none'
            });

            // Confere se há uma publicação nova ao abrir, sem recarregar a página em uso.
            await registro.update();
        } catch (erro) {
            // Se o navegador não oferecer suporte, o site continua funcionando como página normal.
            console.warn('Não foi possível registrar a versão instalável do Spotigab.', erro);
        }
    }, { once: true });
}