import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from './firebaseConfig.js';
import {
    CAPA_PADRAO, mensagemErro, cadastrar, lerPerfil, escutarBiblioteca, alternarCurtida,
    salvarMusica, excluirMusica, buscarItunes, importarItunes, carregarAudio
} from './CRUD.js';

// --- ESTADO E UTILITÁRIOS ---
// Mantém em um único estado da interface o perfil conectado, o catálogo, as curtidas, a fila e a edição atual.
const estado = { uid: null, perfil: null, musicas: [], curtidas: new Set(), fila: [], indice: -1, editando: null, parar: null };
let registrando = false;
// Atalhos usados pela interface para localizar elementos e consultar a função e a faixa atuais.
// document.getElementById encontra um elemento pelo ID único definido no HTML.
const $ = (id) => document.getElementById(id);
const ehCriador = () => estado.perfil?.role === 'creator';
const musicaAtual = () => estado.musicas.find(s => s.id === estado.fila[estado.indice]);

// Cria elementos pelo DOM (textContent) para nunca injetar dados de usuários como HTML
function el(tag, props = {}, ...filhos) {
    // createElement cria o elemento; Object.assign define suas propriedades e append insere os elementos filhos.
    const no = Object.assign(document.createElement(tag), props);
    no.append(...filhos);
    return no;
}

function aviso(msg, erro = false) {
    $('toast').textContent = msg;
    $('toast').className = `toast show${erro ? ' error' : ''}`;
    clearTimeout(aviso.timer);
    aviso.timer = setTimeout(() => $('toast').classList.remove('show'), 4500);
}

// Executa uma ação bloqueando o botão (evita cliques repetidos) e mostra erros em português
async function executar(btn, fn, fixo = false) {
    // Executa uma ação assíncrona, bloqueia cliques repetidos e apresenta os erros em uma mensagem compreensível.
    btn.disabled = true;
    btn.classList.add('loading');
    const ok = await fn().then(() => true, (err) => { aviso(mensagemErro(err), true); return false; });
    btn.classList.remove('loading');
    btn.disabled = fixo && ok;
    return ok;
}

const aoEnviar = (formId, fn) => {
    // O evento submit ocorre ao enviar o formulário; preventDefault impede que a página seja recarregada.
    // Encaminha o envio ao mesmo tratamento de espera e erros usado pelas demais ações.
    $(formId).onsubmit = (e) => { e.preventDefault(); executar(e.target.querySelector('[type=submit]'), fn); };
};

// --- LOGIN, CADASTRO E LOGOUT ---
// Alterna entre os formulários de autenticação sem sair da página atual.
function mostrarAuth(registro) {
    $('login-form').classList.toggle('hidden', registro);
    $('register-form').classList.toggle('hidden', !registro);
    $('auth-modal-title').textContent = registro ? 'Criar conta no Spotigab' : 'Entrar no Spotigab';
}
$('link-show-register').onclick = (e) => { e.preventDefault(); mostrarAuth(true); };
$('link-show-login').onclick = (e) => { e.preventDefault(); mostrarAuth(false); };
$('btn-logout').onclick = () => signOut(auth).catch(err => aviso(mensagemErro(err), true));

// O Firebase Authentication valida as credenciais; o observador de sessão abaixo conclui a entrada na interface.
aoEnviar('login-form', () => signInWithEmailAndPassword(auth, $('login-email').value.trim(), $('login-password').value));

aoEnviar('register-form', async () => {
    const role = document.querySelector('input[name="account-role"]:checked').value;
    registrando = true; // evita ler o perfil antes de ele ser gravado
    try {
        await cadastrar($('reg-name').value.trim(), $('reg-email').value.trim(), $('reg-password').value, role);
        aviso('Conta criada com sucesso!');
    } finally {
        registrando = false;
        if (auth.currentUser) await entrar(auth.currentUser);
    }
});

async function entrar(user) {
    // Carrega o perfil do app, ignora respostas assíncronas antigas e acompanha as mudanças do banco.
    estado.uid = user.uid;
    estado.perfil = await lerPerfil(user);
    if (auth.currentUser?.uid !== user.uid) return; // saiu enquanto carregava
    $('user-display-name').textContent = estado.perfil.name;
    $('user-role-tag').textContent = ehCriador() ? 'Criador' : 'Ouvinte';
    $('creator-form').classList.toggle('hidden', !ehCriador());
    $('auth-modal').classList.remove('active');
    estado.parar?.();
    estado.parar = escutarBiblioteca(user.uid, ({ musicas, curtidas }, erro) => {
        Object.assign(estado, { musicas, curtidas });
        if (erro) aviso(mensagemErro(erro), true);
        renderizarTudo();
    });
    mostrarView('nav-home');
}

function limparSessao() {
    // Encerra as escutas vinculadas ao usuário e redefine a interface e o player após sair da conta.
    estado.parar?.();
    Object.assign(estado, { uid: null, perfil: null, musicas: [], curtidas: new Set(), parar: null });
    pararPlayer();
    document.querySelectorAll('form').forEach(f => f.reset());
    resetarFormulario();
    $('itunes-modal').classList.remove('active');
    $('user-display-name').textContent = $('user-role-tag').textContent = '-';
    mostrarAuth(false);
    $('auth-modal').classList.add('active');
    mostrarView('nav-home');
    renderizarTudo();
}

onAuthStateChanged(auth, (user) => {
    // O Firebase chama esta função ao iniciar e após entrar/sair; user identifica o UID conectado.
    if (!user) limparSessao();
    else if (!registrando) entrar(user);
});

// --- NAVEGAÇÃO ---
const VIEWS = { 'nav-home': 'view-home', 'nav-mine': 'view-mine', 'nav-liked': 'view-liked' };
// Relaciona os controles de navegação aos painéis; apenas um painel fica visível por vez.
function mostrarView(navId) {
    Object.entries(VIEWS).forEach(([nav, view]) => {
        $(nav).classList.toggle('active', nav === navId);
        $(view).classList.toggle('hidden', nav !== navId);
    });
}
// O clique em cada link cancela a navegação do endereço e mostra a seção correspondente.
Object.keys(VIEWS).forEach(nav => { $(nav).onclick = (e) => { e.preventDefault(); mostrarView(nav); }; });

// --- LISTAS DE MÚSICAS ---
// Substitui a lista em uma operação do DOM e mostra um texto alternativo quando ela está vazia.
const preencher = (cont, itens, vazio) =>
    cont.replaceChildren(...(itens.length ? itens : [el('p', { className: 'empty-msg', textContent: vazio })]));

// Qualquer imagem que falhar ao carregar passa a mostrar a capa padrão
document.addEventListener('error', (e) => {
    // Captura falhas das imagens dos cards e troca o endereço pela capa padrão.
    if (e.target.tagName === 'IMG' && e.target.src !== CAPA_PADRAO) e.target.src = CAPA_PADRAO;
}, true);
const capa = (src, alt) => el('img', { src: src || CAPA_PADRAO, alt });

const botao = (classe, icone, titulo, fn) => el('button', {
    type: 'button', className: classe, title: titulo, onclick: (e) => { e.stopPropagation(); fn(); }
}, el('i', { className: icone }));

const curtir = (id) => alternarCurtida(estado.uid, id, estado.curtidas.has(id)).catch(err => aviso(mensagemErro(err), true));

function cartao(song, ids, comAcoes = false) {
    // Monta o card com texto seguro e ações de reprodução, curtida e gerenciamento da faixa.
    const tocarEsta = () => tocar(ids, ids.indexOf(song.id));
    const ativa = estado.curtidas.has(song.id);
    const img = el('div', { className: 'card-img-wrapper' }, capa(song.cover, song.title), botao('btn-play-card', 'fa-solid fa-play', 'Tocar', tocarEsta),
        botao(`btn-like-card${ativa ? ' active' : ''}`, `${ativa ? 'fa-solid' : 'fa-regular'} fa-heart`, ativa ? 'Descurtir' : 'Curtir', () => curtir(song.id)));
    const card = el('div', { className: 'music-card', onclick: tocarEsta }, img, el('h4', { textContent: song.title }), el('p', { textContent: song.artist }));
    if (song.preview) card.append(el('span', { className: 'preview-badge', textContent: 'Prévia de 30 s' }));
    if (comAcoes) card.append(el('div', { className: 'card-actions' },
        ...(ehCriador() ? [botao('', 'fa-solid fa-pen', 'Editar', () => iniciarEdicao(song))] : []),
        botao('', 'fa-solid fa-trash', 'Excluir', () => excluir(song))));
    return card;
}

function renderizarTudo() {
    // Atualiza as três listas com a versão mais recente das músicas e curtidas recebidas do banco.
    const curtidas = estado.musicas.filter(s => estado.curtidas.has(s.id));
    const minhas = estado.musicas.filter(s => s.ownerId === estado.uid);
    const ids = (lista) => lista.map(s => s.id);
    preencher($('songs-grid'), estado.musicas.map(s => cartao(s, ids(estado.musicas))), 'Nenhuma música encontrada.');
    preencher($('liked-songs-grid'), curtidas.map(s => cartao(s, ids(curtidas))), 'Você ainda não curtiu nenhuma música.');
    preencher($('creator-published-list'), minhas.map(s => cartao(s, ids(minhas), true)), 'Você ainda não cadastrou nem importou músicas.');
    $('published-count-badge').textContent = minhas.length;
    const idAtual = estado.fila[estado.indice];
    if (idAtual && !musicaAtual()) return pararPlayer(); // a faixa tocando foi excluída
    estado.fila = estado.fila.filter(id => estado.musicas.some(s => s.id === id));
    estado.indice = estado.fila.indexOf(idAtual);
    atualizarPlayer();
}

function excluir(song) {
    // Confirma a remoção no banco e limpa o formulário caso ele estivesse editando esta faixa.
    if (!confirm(`Excluir "${song.title}"?`)) return;
    excluirMusica(estado.uid, song).then(() => {
        if (estado.editando?.id === song.id) resetarFormulario();
        aviso('Música excluída.');
    }).catch(err => aviso(mensagemErro(err), true));
}

// --- FORMULÁRIO DE CADASTRO E EDIÇÃO (Criadores) ---
function resetarFormulario() {
    // Prepara o formulário de criador para uma nova música e descarta a faixa em edição.
    $('creator-form').reset();
    estado.editando = null;
    $('btn-submit-song').textContent = 'Cadastrar música';
    $('btn-cancel-edit').classList.add('hidden');
}

function iniciarEdicao(song) {
    // Somente o proprietário pode editar; preenche os campos e muda o botão para salvar as alterações.
    if (!ehCriador() || song.ownerId !== estado.uid) return aviso('Você só pode editar as suas próprias músicas.', true);
    resetarFormulario();
    Object.assign(estado, { editando: song });
    [$('song-title').value, $('song-artist').value, $('song-cover-url').value] = [song.title, song.artist, song.coverPath ? '' : song.cover];
    $('btn-submit-song').textContent = 'Salvar alterações';
    $('btn-cancel-edit').classList.remove('hidden');
    $('creator-form').scrollIntoView({ behavior: 'smooth' });
}
$('btn-cancel-edit').onclick = resetarFormulario;

aoEnviar('creator-form', async () => {
    // Lê os campos e arquivos selecionados e delega a validação e a gravação ao módulo CRUD.
    const dados = { title: $('song-title').value.trim(), artist: $('song-artist').value.trim(), capaUrl: $('song-cover-url').value.trim() };
    const edicao = !!estado.editando;
    aviso('Salvando, aguarde...');
    await salvarMusica(estado.uid, estado.perfil, estado.editando, dados, $('song-audio-file').files[0], $('song-cover-file').files[0]);
    aviso(edicao ? 'Música atualizada.' : 'Música cadastrada com sucesso.');
    resetarFormulario();
});

// --- POP-UP DO ITUNES ---
$('btn-import-itunes').onclick = () => {
    // Limpa resultados antigos e coloca o foco no campo após a exibição do modal.
    $('itunes-results-list').replaceChildren();
    $('itunes-search-input').value = '';
    $('itunes-modal').classList.add('active');
    // Espera o navegador aplicar a camada do modal antes de transferir o foco ao campo.
    // Esta função de seta roda após o próximo desenho; focus() deixa o campo pronto para digitar.
    requestAnimationFrame(() => $('itunes-search-input').focus());
};
$('btn-close-itunes-modal').onclick = () => $('itunes-modal').classList.remove('active');
$('itunes-modal').onclick = e => { if (e.target === $('itunes-modal')) $('itunes-modal').classList.remove('active'); };
// O evento keydown ocorre ao pressionar uma tecla. Não retorne false para as demais teclas:
// em um manipulador onkeydown, false cancela a ação padrão e bloqueia texto/Backspace.
// Enter chama a mesma busca do botão, sem enviar formulário nem recarregar a página.
$('itunes-search-input').onkeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        buscar();
    }
};
$('btn-itunes-search-exec').onclick = buscar;
document.addEventListener('keydown', e => {
    // O observador no documento detecta Escape mesmo que outro controle do modal esteja focado.
    if (e.key === 'Escape' && $('itunes-modal').classList.contains('active')) $('itunes-modal').classList.remove('active');
});

async function buscar() {
    // Consulta o iTunes pelo módulo CRUD e mostra as faixas com prévia retornadas pela API.
    const termo = $('itunes-search-input').value.trim();
    if (!termo) return aviso('Digite o nome de uma música ou artista.', true);
    preencher($('itunes-results-list'), [], 'Buscando...');
    // Aguarda a resposta da API enquanto o botão permanece no estado de carregamento.
    const ok = await executar($('btn-itunes-search-exec'), async () => {
        const itens = await buscarItunes(termo);
        preencher($('itunes-results-list'), itens.map(linhaItunes), `Nenhum resultado com prévia para "${termo}".`);
    });
    if (!ok) preencher($('itunes-results-list'), [], 'Não foi possível buscar. Tente novamente.');
}

function linhaItunes(item) {
    // Cada resultado grava os metadados da prévia ao importar e mostra o andamento daquela faixa.
    const btn = el('button', { type: 'button', className: 'btn-import-single', textContent: 'Importar' });
    btn.onclick = async () => {
        btn.textContent = 'Importando...';
        const ok = await executar(btn, async () => {
            const r = await importarItunes(estado.uid, item);
            btn.textContent = r === 'existente' ? 'Já importada' : 'Importada';
            aviso(r === 'existente' ? 'Esta música já está na sua biblioteca.' : `"${item.trackName}" importada (apenas prévia de 30 s).`);
        }, true);
        if (!ok) btn.textContent = 'Importar';
    };
    const info = el('div', { className: 'itunes-item-info' }, el('h4', { textContent: item.trackName }), el('p', { textContent: item.artistName }));
    return el('div', { className: 'itunes-item' }, capa(item.artworkUrl100?.replace('100x100bb', '200x200bb'), 'Capa'), info, btn);
}

// --- PLAYER ---
// O elemento HTML de áudio reproduz tanto os arquivos enviados quanto as prévias do iTunes.
const audio = $('audio-player');
const barraProgresso = $('progress-control');
let pedidoDeFaixa = 0;

// Exibe minutos e segundos inteiros, inclusive em faixas com mais de uma hora.
function formatarTempo(segundos) {
    if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
    const minutos = Math.floor(segundos / 60);
    const resto = Math.floor(segundos % 60);
    return `${minutos}:${String(resto).padStart(2, '0')}`;
}

// audio.currentTime informa o ponto atual; audio.duration informa o total.
// O evento timeupdate chama esta função enquanto a reprodução avança ou busca.
function atualizarProgresso() {
    const duracao = audio.duration;
    const atual = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('current-time').textContent = formatarTempo(atual);
    if (!Number.isFinite(duracao) || duracao <= 0) return;
    // Divide o tempo atual pela duração total para obter o percentual de 0 a 100 da barra.
    barraProgresso.value = String((atual / duracao) * 100);
}

// Ao escolher outra faixa, apaga a duração antiga enquanto seus metadados carregam.
function limparProgresso() {
    $('current-time').textContent = '0:00';
    $('duration-time').textContent = '';
    barraProgresso.value = '0';
    barraProgresso.disabled = true;
}

// loadedmetadata acontece quando o navegador já conhece a duração do áudio.
audio.onloadedmetadata = () => {
    const duracao = audio.duration;
    if (!Number.isFinite(duracao) || duracao <= 0) return;
    $('duration-time').textContent = formatarTempo(duracao);
    barraProgresso.disabled = false;
    atualizarProgresso();

    // Usa a duracao real dos metadados; mostra o aviso somente abaixo de 40 segundos.
    if (duracao < 40) {
        aviso('Esta música possui menos de 40 segundos. A prévia será reproduzida por até 30 segundos.');
    }
};

// timeupdate acompanha a reproducao e limita a 30 segundos somente faixas menores que 40.
audio.ontimeupdate = () => {
    atualizarProgresso();
    if (audio.duration < 40 && audio.currentTime >= 30) {
        // Fixa a posicao no limite da previa para impedir que passe dos 30 segundos.
        audio.currentTime = 30;
        audio.pause();
    }
};

// A posição do range é percentual; convertê-la para segundos move o áudio.
barraProgresso.oninput = e => {
    // O evento input ocorre ao mover a barra; converte o percentual escolhido novamente em segundos.
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(e.target.value) / 100) * audio.duration;
        atualizarProgresso();
    }
};

// O evento input atualiza audio.volume na escala de 0 a 1; o volume começa no máximo.
$('volume-control').oninput = e => audio.volume = Number(e.target.value); audio.volume = 1;

const setIcone = (tocando) => {
    $('play-icon').className = `fa-solid ${tocando ? 'fa-pause' : 'fa-play'}`;
};

function atualizarPlayer() {
    // Mantém sincronizados os textos, a capa, a curtida e a disponibilidade dos botões do player.
    const s = musicaAtual();
    const curtida = !!s && estado.curtidas.has(s.id);
    $('player-title').textContent = s ? s.title : 'Selecione uma música';
    $('player-artist').textContent = s ? s.artist : '-';
    $('player-cover').src = s?.cover || CAPA_PADRAO;
    $('player-preview').classList.toggle('hidden', !s?.preview);
    ['btn-prev', 'btn-play', 'btn-next', 'btn-like-player'].forEach(id => { $(id).disabled = !s; });
    $('btn-like-player').classList.toggle('active', curtida);
    $('btn-like-player').firstElementChild.className = `${curtida ? 'fa-solid' : 'fa-regular'} fa-heart`;
}

function pararPlayer() {
    // Pausa o áudio e limpa sua origem para impedir que a faixa anterior continue tocando.
    audio.pause(); audio.removeAttribute('src'); audio.load();
    limparProgresso();
    Object.assign(estado, { fila: [], indice: -1 });
    setIcone(false);
    atualizarPlayer();
}

const tocarAtual = () => audio.play().catch(err => err.name !== 'AbortError' && aviso('Não foi possível reproduzir esta faixa.', true));

async function tocar(ids, indice) {
    // Um contador impede que uma leitura lenta do banco substitua uma seleção de faixa mais recente.
    if (!ids[indice]) return;
    const pedido = ++pedidoDeFaixa;
    Object.assign(estado, { fila: ids, indice });
    atualizarPlayer();
    audio.pause(); audio.removeAttribute('src'); audio.load();
    limparProgresso();
    // Faixas enviadas são remontadas do banco; prévias do iTunes usam url.
    try {
        const src = await carregarAudio(musicaAtual());
        if (pedido !== pedidoDeFaixa) return;
        audio.src = src;
        tocarAtual();
    } catch (err) {
        if (pedido !== pedidoDeFaixa) return;
        aviso(mensagemErro(err), true);
        setIcone(false);
    }
}

const mover = (passo) => estado.fila.length && tocar(estado.fila, (estado.indice + passo + estado.fila.length) % estado.fila.length);

// Liga os controles fixos do player às ações de fila, reprodução e curtida.
 $('btn-play').onclick = () => { if (audio.paused) tocarAtual(); else audio.pause(); };
$('btn-next').onclick = () => mover(1); $('btn-prev').onclick = () => { if (audio.currentTime > 3) audio.currentTime = 0; else mover(-1); };
$('btn-like-player').onclick = () => musicaAtual() && curtir(musicaAtual().id);
// Os eventos playing e pause atualizam o ícone quando o navegador inicia ou pausa o áudio.
audio.onplaying = () => setIcone(true); audio.onpause = () => setIcone(false);
audio.onerror = () => { if (audio.getAttribute('src')) { setIcone(false); aviso('Não foi possível carregar o áudio desta faixa.', true); } };
// ended ocorre no fim natural. Previas curtas param aqui sem iniciar a proxima faixa,
// mantendo uma previa do iTunes de 30 segundos parada no limite.
audio.onended = () => {
    setIcone(false);
    if (Number.isFinite(audio.duration) && audio.duration < 40) return;
    if (estado.indice < estado.fila.length - 1) mover(1);
};
