// Permite abrir o sistema mesmo sem internet.
// Sempre tenta a versão mais nova primeiro; sem internet, usa a cópia guardada.
const CACHE = 'felipao-v4';
const ARQUIVOS = [
  './', 'index.html', 'css/estilo.css', 'js/app.js', 'js/db.js', 'js/planilha.js', 'js/comum.js', 'js/clientes.js', 'js/fiado.js',
  'manifest.webmanifest', 'icones/icone.svg', 'icones/icone-192.png', 'icones/icone-180.png',
  'dados/catalogo-felipao.csv', 'fotos/indice.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Programa e dados sempre conferidos com o servidor (pega a versão nova logo depois de publicar);
  // fotos podem vir da memória do navegador.
  const ehFoto = /\.(jpg|jpeg|png|svg)$/i.test(new URL(e.request.url).pathname);
  e.respondWith(
    fetch(e.request, ehFoto ? {} : { cache: 'no-cache' })
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
