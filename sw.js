// Permite abrir o sistema mesmo sem internet.
// Sempre tenta a versão mais nova primeiro; sem internet, usa a cópia guardada.
const CACHE = 'felipao-v10';
const ARQUIVOS = [
  './', 'index.html', 'css/estilo.css', 'js/app.js', 'js/db.js', 'js/planilha.js', 'js/comum.js', 'js/clientes.js', 'js/fiado.js', 'js/vendas.js', 'js/venda-calc.js', 'js/nuvem.js', 'js/lembrete.js', 'js/config-nuvem.js', 'js/vendor/firebase.js',
  'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-180.png', 'icones/favicon-64.png', 'icones/logo.png',
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

// Lembrete de cobrança: devolve o evento como arquivo de calendário de verdade
// (o iPhone com o sistema na tela de início só abre o calendário assim).
function eventoIcs(url) {
  const bin = atob(url.searchParams.get('d').replace(/-/g, '+').replace(/_/g, '/'));
  const ics = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  return new Response(ics, { headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="lembrete-cobranca.ics"',
  } });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('/evento.ics') && url.searchParams.has('d')) {
    e.respondWith(eventoIcs(url));
    return;
  }
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
