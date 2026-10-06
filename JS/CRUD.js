import {
    auth, db, ref, push, onValue, remove, set, get, update,
    createUserWithEmailAndPassword
} from './firebaseConfig.js';

// Este módulo reúne leituras e gravações no banco, validação de arquivos, partes de áudio e importações do iTunes.

// Capa usada quando nenhuma imagem foi informada ou quando uma imagem falha.
export const CAPA_PADRAO = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=500&q=80';

// Limites definidos pelo formulário do projeto.
const LIMITE_AUDIO = 15 * 1024 * 1024;
const LIMITE_CAPA = 5 * 1024 * 1024;
const TIPOS_CAPA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ============================================================================
// MENSAGENS DE ERRO
// ============================================================================
const ERROS = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'PERMISSION_DENIED': 'Sem permissão. Verifique as regras do Firebase.'
};

export function mensagemErro(err) {
    // Prioriza códigos de erro conhecidos do Firebase e preserva mensagens úteis dos demais erros.
    const chave = err?.code || Object.keys(ERROS).find(c => String(err?.message).includes(c));
    return ERROS[chave] || err?.message || 'Ocorreu um erro inesperado.';
}

// ============================================================================
// PERFIL E CURTIDAS
// ============================================================================
// Cada usuário possui seu perfil em users/{uid}.
// ref(db, path) aponta para users/{uid}; set grava/substitui o perfil nesse caminho.
export const salvarPerfil = (uid, perfil) => set(ref(db, `users/${uid}`), perfil);

// Authentication cria a conta; o Realtime Database guarda os dados extras do perfil.
export async function cadastrar(nome, email, senha, role) {
    // O Authentication guarda as credenciais; o perfil no RTDB guarda o nome e a função no app.
    if (!nome) throw new Error('Informe seu nome de exibição.');
    // Authentication cria a identidade e devolve cred.user.uid para relacionar os dados.
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await salvarPerfil(cred.user.uid, { name: nome, role, email });
}

// Lê o perfil salvo no Realtime Database.
export async function lerPerfil(user) {
    // Lê o perfil uma vez; se ele não existir ou estiver indisponível, usa os dados padrão de ouvinte.
    try {
        // get() faz uma leitura pontual; snap.exists()/val() verificam e extraem o resultado.
        const snap = await get(ref(db, `users/${user.uid}`));
        if (snap.exists()) return snap.val();
    } catch { /* usa o perfil padrão */ }
    return { name: user.email, role: 'listener' };
}

// A curtida é apenas um booleano dentro de likes/{uid}/{songId}.
// remove() apaga a curtida existente; set() cria o valor true no caminho desta música.
export const alternarCurtida = (uid, songId, curtida) =>
    curtida ? remove(ref(db, `likes/${uid}/${songId}`)) : set(ref(db, `likes/${uid}/${songId}`), true);

// ============================================================================
// BIBLIOTECA DE MÚSICAS
// ============================================================================
// onValue mantém a tela sincronizada com o banco em tempo real.
export function escutarBiblioteca(uid, aoMudar) {
    // Assina separadamente as mudanças do catálogo compartilhado e das curtidas deste usuário.
    const estado = { musicas: [], curtidas: new Set() };
    const avisar = (erro) => aoMudar({ ...estado }, erro);

    // onValue() executa na primeira leitura e sempre que songs mudar no banco.
    const p1 = onValue(ref(db, 'songs'), snap => {
        const dados = snap.val() || {};
        estado.musicas = Object.keys(dados)
            .map(id => ({ id, ...dados[id] }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        avisar();
    }, avisar);

    // A segunda assinatura limita curtidas ao UID conectado; ambas devolvem canceladores.
    const p2 = onValue(ref(db, `likes/${uid}`), snap => {
        estado.curtidas = new Set(Object.keys(snap.val() || {}));
        avisar();
    }, avisar);

    // A função retornada permite parar as duas escutas quando o usuário sai.
    return () => { p1(); p2(); };
}

// ============================================================================
// VALIDA??O DOS ARQUIVOS
// ============================================================================
export async function validarAudio(file) {
    // Retorna null se o arquivo for válido; caso contrário, retorna o motivo exato da recusa.
    if (!file) return 'Selecione um arquivo de áudio .mp3 ou .mp4.';

    const nome = String(file.name || '').toLowerCase();
    const mime = typeof file.type === 'string' ? file.type.toLowerCase().split(';')[0].trim() : '';
    const extensao = nome.includes('.') ? nome.slice(nome.lastIndexOf('.')) : '';
    const diagnostico = { name: file.name, type: mime || '(vazio)', size: file.size, extension: extensao || '(sem extensão)' };
    console.info('[validarAudio] arquivo selecionado', diagnostico);
    const rejeitar = motivo => {
        console.warn('[validarAudio] arquivo recusado', { ...diagnostico, motivo });
        return motivo;
    };
    const ehMp3 = nome.endsWith('.mp3');
    const ehMp4 = nome.endsWith('.mp4');
    if (!ehMp3 && !ehMp4) return rejeitar('O arquivo precisa terminar em .mp3 ou .mp4.');

    // MIME é apenas uma indicação do navegador; aliases e tipos genéricos variam.
    // Registramos divergências, mas a extensão e a assinatura binária decidem.
    const tiposMp3 = ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg', 'audio/x-mp3', 'audio/mpeg3', 'audio/x-mpeg-3'];
    const tiposMp4 = ['audio/mp4', 'video/mp4', 'application/mp4', 'audio/x-m4a', 'video/x-m4v'];
    const tiposValidos = ehMp3 ? tiposMp3 : tiposMp4;
    if (mime && mime !== 'application/octet-stream' && !tiposValidos.includes(mime)) {
        console.warn('[validarAudio] MIME incomum; será conferida a estrutura do arquivo', diagnostico);
    }
    if (!Number.isFinite(file.size) || file.size === 0) return rejeitar('O arquivo está vazio ou tem tamanho inválido.');
    if (file.size > LIMITE_AUDIO) return rejeitar('O arquivo excede o limite de 50 MB.');

    // MP3: verifica a assinatura ID3 ou o início de um frame MPEG.
    if (ehMp3) {
        const inicio = new Uint8Array(await file.slice(0, 10).arrayBuffer());
        let offset = 0;
        if (inicio[0] === 0x49 && inicio[1] === 0x44 && inicio[2] === 0x33) {
            if (inicio.length < 10 || inicio.slice(6, 10).some(byte => byte & 0x80)) return rejeitar('O cabeçalho ID3 do MP3 está inválido.');
            const tamanhoTag = (inicio[6] << 21) | (inicio[7] << 14) | (inicio[8] << 7) | inicio[9];
            offset = 10 + tamanhoTag + ((inicio[5] & 0x10) ? 10 : 0);
        }
        const janela = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 64 * 1024)).arrayBuffer());
        const temFrame = janela.some((byte, i) => byte === 0xFF && (janela[i + 1] & 0xE0) === 0xE0 && ((janela[i + 1] >> 3) & 3) !== 1 && ((janela[i + 1] >> 1) & 3) !== 0 && ((janela[i + 2] >> 4) & 15) !== 0 && ((janela[i + 2] >> 4) & 15) !== 15 && ((janela[i + 2] >> 2) & 3) !== 3);
        if (!temFrame) return rejeitar('Não foi encontrado um frame de áudio MP3 válido.');
    }

    // MP4: verifica o identificador "ftyp" do container MP4.
    if (ehMp4) {
        const b = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let offset = 0;
        let ehContainerMp4 = false;
        while (offset + 8 <= b.length) {
            const tamanhoBox = view.getUint32(offset);
            const tipo = String.fromCharCode(...b.subarray(offset + 4, offset + 8));
            if (tipo === 'ftyp') { ehContainerMp4 = tamanhoBox >= 16 && offset + tamanhoBox <= file.size; break; }
            if (tamanhoBox < 8 || tamanhoBox === 0 || offset + tamanhoBox > b.length) break;
            offset += tamanhoBox;
        }
        // Alguns codificadores colocam uma caixa livre antes do ftyp; procure-a no cabeçalho lido.
        if (!ehContainerMp4) {
            for (let pos = 4; pos + 4 <= b.length; pos++) {
                if (String.fromCharCode(...b.subarray(pos, pos + 4)) !== 'ftyp') continue;
                const inicioBox = pos - 4;
                const tamanhoBox = view.getUint32(inicioBox);
                if (tamanhoBox >= 16 && inicioBox + tamanhoBox <= file.size) { ehContainerMp4 = true; break; }
            }
        }
        if (!ehContainerMp4) return rejeitar('Não foi encontrada uma caixa ftyp válida de MP4.');
    }

    console.info('[validarAudio] arquivo aceito', diagnostico);
    return null;
}

export function validarCapa(file, url) {
    // Confere formato e tamanho da imagem selecionada ou valida o endereço opcional da capa.
    if (file) {
        if (!TIPOS_CAPA.includes(file.type)) return 'A capa precisa ser uma imagem JPG, PNG, WEBP ou GIF.';
        if (file.size > LIMITE_CAPA) return 'A imagem da capa excede o limite de 5 MB.';
    } else if (url) {
        try {
            if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
        } catch {
            return 'A URL da capa precisa começar com http:// ou https://.';
        }
    }
    return null;
}

// ============================================================================
// ARQUIVOS NO REALTIME DATABASE
// ============================================================================
// O arquivo vira Base64 e fica dividido em blocos no Realtime Database.
// O navegador consegue usar essa string diretamente no <audio> e no <img>.
function arquivoComoDataURL(file) {
    // Envolve os eventos do FileReader em uma Promise para permitir aguardar com async/await.
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result);
        leitor.onerror = () => reject(new Error('Falha ao ler o arquivo selecionado.'));
        leitor.readAsDataURL(file);
    });
}

// 50 MiB de áudio ocupam cerca de 66,7 MiB em Base64; blocos mantêm cada gravação abaixo do limite.
// Seis MiB de arquivo viram no máximo oito MiB em Base64, abaixo do limite
// de 10 MiB por texto e de 16 MiB por gravação do SDK do Realtime Database.
const TAMANHO_BLOCO = 6 * 1024 * 1024;
const mimeDoAudio = file => file.name.toLowerCase().endsWith('.mp4')
    ? (['audio/mp4', 'video/mp4'].includes(file.type.toLowerCase()) ? file.type.toLowerCase() : 'audio/mp4')
    : 'audio/mpeg';

function bytesParaBase64(bytes) {
    // Converte trechos limitados de bytes em grupos menores para evitar limites de argumentos.
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binario);
}

async function gravarAudio(caminho, file) {
    // Grava os blocos em sequência para manter cada texto Base64 e operação do RTDB em tamanho prático.
    const total = Math.ceil(file.size / TAMANHO_BLOCO);
    console.info('[gravarAudio] iniciando gravação', { name: file.name, type: mimeDoAudio(file), size: file.size, chunks: total });
    try {
        for (let i = 0; i < total; i++) {
            const inicio = i * TAMANHO_BLOCO;
            const bytes = new Uint8Array(await file.slice(inicio, Math.min(file.size, inicio + TAMANHO_BLOCO)).arrayBuffer());
            await set(ref(db, `${caminho}/${i}`), bytesParaBase64(bytes));
        }
    } catch (err) {
        console.error('[gravarAudio] falha ao salvar no Realtime Database', { path: caminho, chunks: total, code: err?.code, message: err?.message });
        await remove(ref(db, caminho));
        throw err;
    }
    return { audioRef: caminho, audioMime: mimeDoAudio(file), audioChunks: total, audioSize: file.size };
}

// Recupera os blocos e monta uma Data URL utilizável diretamente pelo <audio>.
export async function carregarAudio(song) {
    // Busca os blocos, confere se estão completos e retorna uma Data URL que o elemento de áudio reproduz.
    if (song.audioData) return song.audioData; // Compatibilidade com cadastros anteriores.
    if (!song.audioRef || !song.audioChunks || !song.audioMime) return song.url || '';
    const snap = await get(ref(db, song.audioRef));
    const blocos = snap.val();
    if (!blocos) throw new Error('Os dados de ?udio n?o foram encontrados no banco.');
    const partes = [];
    for (let i = 0; i < song.audioChunks; i++) {
        if (typeof blocos[i] !== 'string') throw new Error('Audio incompleto no Realtime Database.');
        partes.push(blocos[i]);
    }
    const base64 = partes.join('');
    const tamanhoEsperado = song.audioSize ? 4 * Math.ceil(song.audioSize / 3) : null;
    if (tamanhoEsperado && base64.length !== tamanhoEsperado) throw new Error('O áudio salvo no banco está incompleto ou foi alterado.');
    return `data:${song.audioMime};base64,${base64}`;
}

// ============================================================================
// CRIAR, EDITAR E EXCLUIR
// ============================================================================
export async function criarMusica(uid, { title, artist, capaUrl }, audioFile, capaFile) {
    // Reserva uma chave para a música, salva o áudio nela e depois grava os metadados que apontam aos blocos.
    // push() reserva uma chave nova em songs sem sobrescrever registros existentes.
    const registroRef = push(ref(db, 'songs'));
    const caminhoAudio = `songAudio/${registroRef.key}`;
    const midias = await gravarAudio(caminhoAudio, audioFile);
    try {
    const coverData = capaFile ? await arquivoComoDataURL(capaFile) : null;
    const registro = {
        title,
        artist,
        ownerId: uid,
        source: 'upload',
        preview: false,
        createdAt: Date.now(),
        ...midias,
        cover: coverData || capaUrl || CAPA_PADRAO
    };
    // set() publica metadados depois que áudio e capa estão preparados.
    await set(registroRef, registro);
    } catch (err) { await remove(ref(db, caminhoAudio)); throw err; }
}

export async function atualizarMusica(uid, song, { title, artist, capaUrl }, audioFile, capaFile) {
    // Confere a propriedade da faixa e prepara o novo áudio antes de atualizar o registro.
    if (song.ownerId !== uid) throw new Error('Você só pode editar as suas próprias músicas.');

    const mudancas = { title, artist };
    const coverData = capaFile ? await arquivoComoDataURL(capaFile) : null;

    // Só substituímos o áudio se o usuário realmente escolher outro arquivo.
    if (audioFile) {
        const caminho = `songAudio/${song.id}_${Date.now()}`;
        Object.assign(mudancas, await gravarAudio(caminho, audioFile));
    }
    if (coverData) mudancas.cover = coverData;
    else if (capaUrl) mudancas.cover = capaUrl;

    // update() altera apenas os campos enviados, preservando os demais dados do registro.
    try { await update(ref(db, `songs/${song.id}`), mudancas); }
    catch (err) { if (audioFile) await remove(ref(db, mudancas.audioRef)); throw err; }
    if (audioFile && song.audioRef) await remove(ref(db, song.audioRef));
}

export async function excluirMusica(uid, song) {
    // Remove os metadados e os blocos de áudio somente se a faixa pertencer a este usuário.
    if (song.ownerId !== uid) throw new Error('Você só pode excluir as suas próprias músicas.');
    // Apaga o registro e, em seguida, as partes de áudio guardadas no caminho separado.
    await remove(ref(db, `songs/${song.id}`));
    if (song.audioRef) await remove(ref(db, song.audioRef));
}

// ============================================================================
// ITUNES
// ============================================================================
// A API pública do iTunes fornece somente prévias com aproximadamente 30 segundos.
export async function buscarItunes(termo) {
    // Codifica o termo para a URL e mantém apenas resultados que tenham uma prévia reproduzível.
    // encodeURIComponent protege espaços/símbolos; fetch aguarda a resposta HTTP da API.
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(termo)}&media=music&entity=song&limit=15`);
    if (!res.ok) throw new Error('O iTunes não respondeu. Tente novamente.');
    // json() converte o corpo; filter percorre os resultados e remove itens sem prévia.
    const dados = await res.json();
    return (dados.results || []).filter(i => i.trackId && i.previewUrl);
}

// A importação do iTunes não baixa o arquivo: apenas salva a URL da prévia.
export async function importarItunes(uid, item) {
    // A chave fixa por usuário e faixa evita duplicatas; são salvos somente os metadados da prévia.
    const caminho = ref(db, `songs/itunes_${uid}_${item.trackId}`);
    if ((await get(caminho)).exists()) return 'existente';

    await set(caminho, {
        title: item.trackName,
        artist: item.artistName,
        ownerId: uid,
        source: 'itunes',
        preview: true,
        createdAt: Date.now(),
        url: item.previewUrl,
        cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : CAPA_PADRAO
    });
    return 'importada';
}

// Função principal usada pelo formulário de cadastro/edição.
export async function salvarMusica(uid, perfil, editando, dados, audioFile, capaFile) {
    // Centraliza a verificação da função de criador, dos campos obrigatórios e dos arquivos antes de criar ou editar.
    if (perfil?.role !== 'creator') throw new Error('Apenas Criadores podem cadastrar músicas.');
    if (!dados.title || !dados.artist) throw new Error('Preencha o título e o artista.');

    const erro = (audioFile || !editando ? await validarAudio(audioFile) : null) || validarCapa(capaFile, dados.capaUrl);
    if (erro) throw new Error(erro);

    if (editando) await atualizarMusica(uid, editando, dados, audioFile, capaFile);
    else await criarMusica(uid, dados, audioFile, capaFile);
}
