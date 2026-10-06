// O prefixo identifica apenas os caches do Spotigab neste domínio.
const PREFIXO_CACHE = 'spotigab-shell-';
const VERSAO_CACHE = `${PREFIXO_CACHE}v1`;

// Lista somente arquivos locais necessários para abrir a interface; APIs e áudios remotos não entram no cache.
const ARQUIVOS_ESTATICOS = [
    './', './index.html', './CSS/style.css', './JS/script.js', './JS/CRUD.js',
    './JS/firebaseConfig.js', './JS/pwa.js', './manifest.webmanifest',
    './assets/icons/icon.svg', './assets/icons/favicon-32.png',
    './assets/icons/icon-192.png', './assets/icons/icon-512.png',
    './assets/icons/icon-512-maskable.png', './assets/icons/apple-touch-icon.png'
];

// Resolva os caminhos em relação ao escopo registrado para manter o subdiretório do GitHub Pages.
const urlsEstaticas = new Set(ARQUIVOS_ESTATICOS.map(caminho => new URL(caminho, self.registration.scope).href));

// install baixa o app shell. O novo worker só fica pronto depois de todos os arquivos essenciais existirem.
self.addEventListener('install', evento => {
    evento.waitUntil((async () => {
        const cache = await caches.open(VERSAO_CACHE);
        await cache.addAll(ARQUIVOS_ESTATICOS.map(caminho => new URL(caminho, self.registration.scope).href));
        // Após o cache completo, ativa a versão nova sem descartar a versão antiga antes da hora.
        await self.skipWaiting();
    })());
});

// activate remove somente caches antigos do próprio app e assume as abas já abertas.
self.addEventListener('activate', evento => {
    evento.waitUntil((async () => {
        const nomes = await caches.keys();
        await Promise.all(nomes
            .filter(nome => nome.startsWith(PREFIXO_CACHE) && nome !== VERSAO_CACHE)
            .map(nome => caches.delete(nome)));
        await self.clients.claim();
    })());
});

// fetch usa rede primeiro para páginas e cache com atualização em paralelo para arquivos estáticos.
self.addEventListener('fetch', evento => {
    const requisicao = evento.request;
    const endereco = new URL(requisicao.url);
    const base = new URL(self.registration.scope);

    // Não intercepta escritas, outros domínios nem pedidos de intervalos usados por reprodutores de mídia.
    if (requisicao.method !== 'GET' || endereco.origin !== self.location.origin || requisicao.headers.has('range')) return;
    if (!endereco.href.startsWith(base.href)) return;

    if (requisicao.mode === 'navigate') {
        // Online, entrega a versão publicada atual; offline, abre o app shell salvo no cache.
        evento.respondWith((async () => {
            try {
                const resposta = await fetch(requisicao);
                if (resposta.ok) {
                    const cache = await caches.open(VERSAO_CACHE);
                    await cache.put(requisicao, resposta.clone());
                }
                return resposta;
            } catch {
                const cache = await caches.open(VERSAO_CACHE);
                return await cache.match(requisicao)
                    || await cache.match(new URL('./', base).href)
                    || await cache.match(new URL('./index.html', base).href)
                    || Response.error();
            }
        })());
        return;
    }

    if (urlsEstaticas.has(endereco.href)) {
        // A atualização em rede ocorre em paralelo e substitui a cópia estática para a próxima abertura.
        const atualizacao = fetch(requisicao).then(async resposta => {
            if (resposta.ok) {
                const cache = await caches.open(VERSAO_CACHE);
                await cache.put(requisicao, resposta.clone());
            }
            return resposta;
        });
        evento.waitUntil(atualizacao.then(() => undefined).catch(() => undefined));
        evento.respondWith((async () => {
            const cache = await caches.open(VERSAO_CACHE);
            return await cache.match(requisicao) || atualizacao;
        })());
    }
});