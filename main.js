(function(){

// var SUSPEITOS = ["Baronesa Ametista","Coronel Pimenta","Dr. Alcaçuz","Madame Corvo","Capitão Ferro","Srta. Marfim"];
// var ARMAS = ["Candelabro","Corda","Punhal","Chave Inglesa","Revólver","Cano de Chumbo"];
// var LOCAIS = ["Biblioteca","Salão de Baile","Cozinha","Escritório","Jardim de Inverno","Sala de Bilhar","Sala de Jantar","Vestíbulo","Terraço"];

var SUSPEITOS = [
    "Prof. Black",
    "Srta. Rosa",
    "Cel. Mostarda",
    "Dona Branca",
    "Sr. Marinho",
    "Dona Violeta"
];

var ARMAS = [
    "Revólver",
    "Cano",
    "Chave Inglesa",
    "Faca",
    "Candelabro",
    "Corda"
];

var LOCAIS = [
    "Hall",
    "Sala de Estar",
    "Salão de Festas",
    "Cozinha",
    "Biblioteca",
    "Sala de Jantar",
    "Escritório",
    "Sala de Música",
    "Salão de Jogos"
];

var state = {
  screen: 'home',
  name: '',
  code: '',
  playerId: null,
  isSpectator: false,
  room: null,
  hand: [],
  notifications: [],
  notes: buildEmptyNotes(),
  error: '',
  joinError: '',
  showCardModal: null,
  showSuggestModal: false,
  showAccuseModal: false,
  suggestPick: {suspeito:SUSPEITOS[0], arma:ARMAS[0], local:LOCAIS[0]},
  accusePick: {suspeito:SUSPEITOS[0], arma:ARMAS[0], local:LOCAIS[0]},
  suggestedRoomVisit: null,
  lastSeenRoom: null,
  suggestModalPos: null,
  history: []
};

var unsubRoom = null;
var unsubHand = null;
var unsubNotify = null;
var unsubNotes = null;

function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function slugify(s){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function genCode(){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for(var i=0;i<5;i++){ out += chars[Math.floor(Math.random()*chars.length)]; }
  return out;
}

function nowTs(){
  var d = new Date();
  return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

function shuffle(arr){
  var a = arr.slice();
  for(var i=a.length-1;i>0;i--){
    var j = Math.floor(Math.random()*(i+1));
    var t=a[i]; a[i]=a[j]; a[j]=t;
  }
  return a;
}

function cardCategory(name){
  if(SUSPEITOS.indexOf(name)>=0) return 'suspeito';
  if(ARMAS.indexOf(name)>=0) return 'arma';
  return 'local';
}
function cardLabel(cat){
  return cat==='suspeito' ? 'Suspeito' : cat==='arma' ? 'Arma' : 'Cômodo';
}
function cardImagePath(name){
  return 'images/cards/' + slugify(name) + '.png';
}

function fv(){ return firebase.firestore.FieldValue; }

function roomsCol(){ return db.collection('rooms'); }
function handsCol(){ return db.collection('hands'); }
function notifCol(){ return db.collection('notifications'); }
function historyCol(){ return db.collection('history'); }
function handKey(code,pid){ return code+'_'+pid; }

// ===== Sessão local (isolada — permite voltar pro jogo após F5) =====
var SESSION_KEY = 'casoArquivado_session_v1';

// id único deste navegador/dispositivo — gerado uma vez e reaproveitado.
// Não depende do nome digitado, então dois jogadores diferentes usando o
// mesmo nome (em computadores diferentes) nunca colidem no mesmo "pid".
var DEVICE_ID_KEY = 'casoArquivado_device_id_v1';
function getDeviceId(){
  try{
    var id = localStorage.getItem(DEVICE_ID_KEY);
    if(!id){
      id = 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }catch(e){
    return 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  }
}

function saveSession(code, pid, name){
  try{
    localStorage.setItem(SESSION_KEY, JSON.stringify({code:code, pid:pid, name:name}));
  }catch(e){}
}
function loadSession(){
  try{
    var raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function clearSession(){
  try{
    localStorage.removeItem(SESSION_KEY);
  }catch(e){}
}
// ===== fim sessão local =====

// ===== Ficha de Anotações (isolada — não deve afetar mãos/sala/histórico) =====
function notesCol(){ return db.collection('notes'); }
function buildEmptyNotes(){
  var n = {suspeito:{}, arma:{}, local:{}};
  SUSPEITOS.forEach(function(s){ n.suspeito[s]=''; });
  ARMAS.forEach(function(a){ n.arma[a]=''; });
  LOCAIS.forEach(function(l){ n.local[l]=''; });
  return n;
}
function noteMarkSymbol(status){
  return status==='x' ? '✕' : status==='?' ? '?' : '○';
}
function noteMarkClass(status){
  return status==='x' ? 'mark-x' : status==='?' ? 'mark-q' : 'mark-blank';
}
function nextNoteStatus(status){
  return status==='' ? 'x' : status==='x' ? '?' : '';
}
// ===== fim helpers de anotações =====

// sorteia o personagem (suspeito) que um jogador vai controlar — fica
// gravado no próprio jogador, então tanto o mistério quanto o peão no
// tabuleiro sempre concordam sobre quem é quem.
function pickRandomSuspect(existingPlayers){
  var usados = (existingPlayers||[]).map(function(p){ return p.suspect; }).filter(Boolean);
  var livres = SUSPEITOS.filter(function(s){ return usados.indexOf(s) < 0; });
  var pool = livres.length ? livres : SUSPEITOS; // mais jogadores que suspeitos: permite repetir
  return pool[Math.floor(Math.random()*pool.length)];
}

async function createRoom(){
  var name = document.getElementById('name-input').value.trim();
  if(!name){ state.error='Digite seu nome de detetive.'; render(); return; }
  var code = genCode();
  var pid = code+'-'+getDeviceId();
  var room = {
    code: code,
    hostId: pid,
    phase: 'lobby',
    players: [{id:pid, name:name, eliminated:false, suspect: pickRandomSuspect([])}],
    turnOrder: [],
    turnIndex: 0,
    secret: null,
    log: [{text:name+' abriu o caso #'+code+'.', type:'system', ts:nowTs()}],
    winner: null,
    createdAt: Date.now()
  };
  try{
    await roomsCol().doc(code).set(room);
  }catch(e){
    state.error = 'Não foi possível criar a sala. Confira sua conexão e as credenciais do Firebase.';
    render();
    return;
  }
  state.name = name;
  state.code = code;
  state.playerId = pid;
  state.hand = [];
  state.error = '';
  state.room = room;
  saveSession(code, pid, name);
  attachListeners(code, pid);
  state.screen = 'lobby';
  render();
}

async function joinRoom(){
  var name = document.getElementById('join-name-input').value.trim();
  var code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if(!name || !code){ state.joinError='Preencha seu nome e o código do caso.'; render(); return; }
  var pid = code+'-'+getDeviceId();
  try{
    var snap = await roomsCol().doc(code).get();
    if(!snap.exists){ state.joinError='Caso não encontrado. Confira o código.'; render(); return; }
    var room = snap.data();
    if(room.phase==='cancelled'){
      state.joinError='Esta sala foi cancelada pelo anfitrião. Peça para abrirem um novo caso.';
      render();
      return;
    }
    var isPlayer = room.players.some(function(p){return p.id===pid;});
    var isSpec = (room.spectators||[]).some(function(p){return p.id===pid;});
    if(!isPlayer && !isSpec){
      if(room.phase==='lobby'){
        var meuSuspeito = pickRandomSuspect(room.players);
        var updates = {
          players: fv().arrayUnion({id:pid, name:name, eliminated:false, suspect: meuSuspeito}),
          log: fv().arrayUnion({text:name+' entrou no caso.', type:'system', ts:nowTs()})
        };
        var becameHost = !room.hostId;
        if(becameHost){
          updates.hostId = pid;
          updates.log = fv().arrayUnion(
            {text:name+' entrou no caso.', type:'system', ts:nowTs()},
            {text:'👑 '+name+' é o anfitrião da sala.', type:'system', ts:nowTs()}
          );
        }
        await roomsCol().doc(code).update(updates);
        room = Object.assign({}, room, {
          players: room.players.concat([{id:pid, name:name, eliminated:false, suspect: meuSuspeito}]),
          hostId: becameHost ? pid : room.hostId
        });
        isPlayer = true;
      } else if(room.phase==='playing' || room.phase==='ended'){
        // caso já iniciado: entra apenas como espectador, sem peão, cartas ou ações
        await roomsCol().doc(code).update({
          spectators: fv().arrayUnion({id:pid, name:name}),
          log: fv().arrayUnion({text:'👁 '+name+' entrou como espectador.', type:'system', ts:nowTs()})
        });
        room = Object.assign({}, room, {
          spectators: (room.spectators||[]).concat([{id:pid, name:name}])
        });
        isSpec = true;
      } else {
        state.joinError='Esse caso já está em investigação. Peça ao anfitrião para abrir um novo.';
        render();
        return;
      }
    }
  }catch(e){
    state.joinError = 'Não foi possível entrar na sala. Confira sua conexão e as credenciais do Firebase.';
    render();
    return;
  }
  state.name = name;
  state.code = code;
  state.playerId = pid;
  state.room = room;
  state.isSpectator = isSpec && !isPlayer;
  state.joinError = '';
  saveSession(code, pid, name);
  attachListeners(code, pid);
  state.screen = 'lobby';
  render();
}

function attachListeners(code, pid){
  if(unsubRoom) unsubRoom();
  if(unsubHand) unsubHand();
  if(unsubNotify) unsubNotify();

  unsubRoom = roomsCol().doc(code).onSnapshot(function(snap){
    if(!snap.exists){
      if(state.screen==='lobby' || state.screen==='game'){
        detachListeners();
        clearSession();
        state.screen = 'gone';
        state.goneReason = 'Esta sala não existe mais.';
        render();
      }
      return;
    }
    var data = snap.data();
    if(data.phase==='cancelled'){
      detachListeners();
      clearSession();
      state.screen = 'gone';
      state.goneReason = 'O anfitrião cancelou esta investigação.';
      render();
      return;
    }
    state.room = data;
    state.isSpectator = !(data.players||[]).some(function(p){return p.id===state.playerId;}) &&
      (data.spectators||[]).some(function(p){return p.id===state.playerId;});
    if(state.room.phase!=='lobby' && (state.screen==='lobby' || state.screen==='home')){
      state.screen = 'game';
    }
    render();
  });

  unsubHand = handsCol().doc(handKey(code,pid)).onSnapshot(function(snap){
    state.hand = snap.exists ? (snap.data().cards || []) : [];
    render();
  });

  unsubNotify = notifCol().doc(handKey(code,pid)).onSnapshot(function(snap){
    state.notifications = snap.exists ? (snap.data().items || []) : [];
    render();
  });

  // Listener isolado da ficha de anotações — falha aqui nunca deve afetar o resto do jogo
  unsubNotes = notesCol().doc(handKey(code,pid)).onSnapshot(function(snap){
    state.notes = (snap.exists && snap.data().data) ? snap.data().data : buildEmptyNotes();
    render();
  }, function(err){
    state.notes = buildEmptyNotes();
  });
}

function detachListeners(){
  if(unsubRoom){ unsubRoom(); unsubRoom=null; }
  if(unsubHand){ unsubHand(); unsubHand=null; }
  if(unsubNotify){ unsubNotify(); unsubNotify=null; }
  if(unsubNotes){ unsubNotes(); unsubNotes=null; }
}

async function startGame(){
  var room = state.room;
  if(room.players.length<3) return;

  var secretSuspeito = shuffle(SUSPEITOS)[0];
  var secretArma = shuffle(ARMAS)[0];
  var secretLocal = shuffle(LOCAIS)[0];
  var remaining = shuffle(
    SUSPEITOS.filter(function(s){return s!==secretSuspeito;})
    .concat(ARMAS.filter(function(a){return a!==secretArma;}))
    .concat(LOCAIS.filter(function(l){return l!==secretLocal;}))
  );
  var players = room.players;
  var hands = {};
  players.forEach(function(p){ hands[p.id]=[]; });
  remaining.forEach(function(card, idx){
    var p = players[idx % players.length];
    hands[p.id].push(card);
  });

  var batch = db.batch();
  Object.keys(hands).forEach(function(pid){
    batch.set(handsCol().doc(handKey(room.code,pid)), {cards:hands[pid]});
    batch.set(notifCol().doc(handKey(room.code,pid)), {items:[]});
  });
  batch.update(roomsCol().doc(room.code), {
    secret: {suspeito:secretSuspeito, arma:secretArma, local:secretLocal},
    turnOrder: players.map(function(p){return p.id;}),
    turnIndex: 0,
    phase: 'playing',
    log: fv().arrayUnion({text:'A investigação começou! '+players.length+' detetives receberam suas cartas.', type:'system', ts:nowTs()})
  });
  await batch.commit();

  // Inicialização isolada da ficha de anotações — em operação separada do batch principal,
  // e protegida por try/catch, para que uma eventual falha aqui (ex: regra de segurança
  // faltando para a coleção "notes") jamais impeça o jogo de começar.
  try{
    var notesWrites = Object.keys(hands).map(function(pid){
      var notes = buildEmptyNotes();
      hands[pid].forEach(function(c){
        var cat = cardCategory(c);
        notes[cat][c] = 'x';
      });
      return notesCol().doc(handKey(room.code,pid)).set({data:notes});
    });
    await Promise.all(notesWrites);
  }catch(e){
    console.warn('Ficha de anotações não pôde ser inicializada (o jogo continua normalmente):', e);
  }

  state.screen = 'game';
  render();
}

async function cancelRoom(){
  var room = state.room;
  if(!room || room.hostId!==state.playerId || room.phase!=='lobby') return;
  await roomsCol().doc(room.code).update({
    phase: 'cancelled',
    log: fv().arrayUnion({text:state.name+' cancelou a investigação.', type:'system', ts:nowTs()})
  });
  detachListeners();
  clearSession();
  state.screen = 'home';
  state.room = null;
  state.code = '';
  state.playerId = null;
  render();
}

function isMyTurn(){
  var room = state.room;
  if(!room || room.phase!=='playing') return false;
  var activeOrder = room.turnOrder.filter(function(id){
    var p = room.players.filter(function(pp){return pp.id===id;})[0];
    return p && !p.eliminated;
  });
  if(activeOrder.length===0) return false;
  var idx = room.turnIndex % activeOrder.length;
  return activeOrder[idx] === state.playerId;
}

function currentTurnName(){
  var room = state.room;
  if(!room || room.phase!=='playing') return '';
  var activeOrder = room.turnOrder.filter(function(id){
    var p = room.players.filter(function(pp){return pp.id===id;})[0];
    return p && !p.eliminated;
  });
  if(activeOrder.length===0) return '';
  var idx = room.turnIndex % activeOrder.length;
  var pid = activeOrder[idx];
  var p = room.players.filter(function(pp){return pp.id===pid;})[0];
  return p ? p.name : '';
}

async function passTurn(){
  var room = state.room;
  await roomsCol().doc(room.code).update({
    turnIndex: fv().increment(1),
    log: fv().arrayUnion({text:state.name+' passou a vez.', type:'normal', ts:nowTs()})
  });
}

async function makeSuggestion(){
  var room = state.room;
  var pick = state.suggestPick;
  await roomsCol().doc(room.code).update({
    log: fv().arrayUnion({text:state.name+' sugeriu: '+pick.suspeito+' + '+pick.arma+' + '+pick.local+'. Aguardando alguém mostrar uma carta.', type:'normal', ts:nowTs()})
  });
  // move o peão do suspeito e a arma do palpite para o cômodo indicado
  try{ if(window.boardMoveToRoom) window.boardMoveToRoom(pick.suspeito, pick.arma, pick.local); }catch(e){}
  state.suggestedRoomVisit = pick.local; // trava "Fazer Palpite" até sair e voltar a entrar nesta sala
  state.showSuggestModal = false;
  render();
}

function openShowCard(card){
  state.showCardModal = card;
  render();
}

async function showCardTo(targetId){
  var room = state.room;
  var card = state.showCardModal;
  var target = room.players.filter(function(p){return p.id===targetId;})[0];
  await notifCol().doc(handKey(room.code,targetId)).set({
    items: fv().arrayUnion({from:state.name, card:card, ts:nowTs()})
  }, {merge:true});
  await roomsCol().doc(room.code).update({
    log: fv().arrayUnion({text:state.name+' mostrou uma carta para '+target.name+'.', type:'normal', ts:nowTs()})
  });
  state.showCardModal = null;
  render();
}

async function makeAccusation(){
  var room = state.room;
  var pick = state.accusePick;
  // move o peão do suspeito e a arma da acusação para o cômodo indicado
  try{ if(window.boardMoveToRoom) window.boardMoveToRoom(pick.suspeito, pick.arma, pick.local); }catch(e){}
  var correct = pick.suspeito===room.secret.suspeito && pick.arma===room.secret.arma && pick.local===room.secret.local;

  if(correct){
    await roomsCol().doc(room.code).update({
      phase: 'ended',
      winner: state.playerId,
      log: fv().arrayUnion({text:'🏆 '+state.name+' resolveu o caso! A resposta era: '+room.secret.suspeito+' + '+room.secret.arma+' + '+room.secret.local+'.', type:'win', ts:nowTs()})
    });
    await historyCol().add({
      code: room.code,
      players: room.players.map(function(p){return p.name;}),
      winner: state.name,
      solution: room.secret,
      finishedAtStr: new Date().toLocaleString('pt-BR'),
      createdAt: fv().serverTimestamp()
    });
  }else{
    await db.runTransaction(async function(tx){
      var ref = roomsCol().doc(room.code);
      var snap = await tx.get(ref);
      var data = snap.data();
      var players = data.players.map(function(p){
        if(p.id===state.playerId){ p.eliminated = true; }
        return p;
      });
      tx.update(ref, {
        players: players,
        log: fv().arrayUnion({text:state.name+' fez uma acusação final e errou. Está fora da disputa, mas continua revelando cartas.', type:'normal', ts:nowTs()})
      });
    });
  }
  state.showAccuseModal = false;
  render();
}

// Ações da ficha de anotações — isoladas, nunca lançam erro pro resto do app
async function toggleNote(cat, item){
  var next = nextNoteStatus((state.notes[cat] && state.notes[cat][item]) || '');
  state.notes[cat][item] = next;
  render();
  try{
    await notesCol().doc(handKey(state.code,state.playerId)).set({data: state.notes});
  }catch(e){
    console.warn('Não foi possível salvar a ficha de anotações:', e);
  }
}

async function markFromNotification(card){
  var cat = cardCategory(card);
  state.notes[cat][card] = 'x';
  render();
  try{
    await notesCol().doc(handKey(state.code,state.playerId)).set({data: state.notes});
  }catch(e){
    console.warn('Não foi possível salvar a ficha de anotações:', e);
  }
}

function copyRoomCode(){
  var room = state.room;
  if(!room) return;
  var code = room.code;
  var btn = document.getElementById('copy-code-btn');

  function showCopied(){
    if(!btn) return;
    var original = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(function(){ if(btn) btn.textContent = original; }, 1500);
  }

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(showCopied).catch(function(){
      fallbackCopy(code, showCopied);
    });
  } else {
    fallbackCopy(code, showCopied);
  }
}

function fallbackCopy(text, onDone){
  try{
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if(onDone) onDone();
  }catch(e){
    console.warn('Não foi possível copiar o código:', e);
  }
}

async function goHistory(){
  state.screen = 'history';
  render();
  try{
    var snap = await historyCol().orderBy('createdAt','desc').limit(40).get();
    state.history = snap.docs.map(function(d){ return d.data(); });
  }catch(e){
    state.history = [];
  }
  render();
}

// escolhe quem vira o novo anfitrião quando o atual sai (prefere alguém ainda ativo no jogo)
function pickNewHost(players, excludeId){
  var candidates = players.filter(function(p){ return p.id!==excludeId; });
  var active = candidates.filter(function(p){ return !p.eliminated; });
  var pick = active[0] || candidates[0];
  return pick ? pick.id : null;
}

async function leaveGame(){
  var room = state.room;

  if(state.isSpectator){
    if(room){
      try{
        var meSpec = (room.spectators||[]).filter(function(p){return p.id===state.playerId;})[0];
        if(meSpec){
          await roomsCol().doc(room.code).update({
            spectators: fv().arrayRemove(meSpec),
            log: fv().arrayUnion({text:'👁 '+state.name+' saiu do modo espectador.', type:'system', ts:nowTs()})
          });
        }
      }catch(e){
        console.warn('Não foi possível registrar a saída do espectador:', e);
      }
    }
    goHome();
    return;
  }

  var me = room && room.players.filter(function(p){return p.id===state.playerId;})[0];

  if(room && room.phase==='playing' && me && !me.eliminated){
    var cardsText = state.hand.length ? state.hand.join(', ') : 'nenhuma carta';
    try{
      await db.runTransaction(async function(tx){
        var ref = roomsCol().doc(room.code);
        var snap = await tx.get(ref);
        var data = snap.data();
        var players = data.players.map(function(p){
          if(p.id===state.playerId){ p.eliminated = true; }
          return p;
        });
        var text = '🚪 '+state.name+' saiu da partida e foi eliminado. Cartas reveladas: '+cardsText+'.';
        var updates = {
          players: players,
          log: fv().arrayUnion({text:text, type:'normal', ts:nowTs()})
        };
        if(data.hostId === state.playerId){
          var newHostId = pickNewHost(players, state.playerId);
          if(newHostId){
            var newHost = players.filter(function(p){return p.id===newHostId;})[0];
            updates.hostId = newHostId;
            updates.log = fv().arrayUnion(
              {text:text, type:'normal', ts:nowTs()},
              {text:'👑 '+(newHost?newHost.name:'?')+' agora é o anfitrião da sala.', type:'system', ts:nowTs()}
            );
          }
        }
        tx.update(ref, updates);
      });
    }catch(e){
      console.warn('Não foi possível registrar a saída do jogador:', e);
    }
  }

  goHome();
}

async function leaveLobby(){
  var room = state.room;
  if(room && room.phase==='lobby'){
    try{
      await db.runTransaction(async function(tx){
        var ref = roomsCol().doc(room.code);
        var snap = await tx.get(ref);
        var data = snap.data();
        var remaining = data.players.filter(function(p){ return p.id!==state.playerId; });
        var updates = {
          players: remaining,
          log: fv().arrayUnion({text: state.name+' saiu da sala.', type:'system', ts:nowTs()})
        };
        if(data.hostId === state.playerId){
          if(remaining.length){
            var newHostId = pickNewHost(remaining, state.playerId);
            if(newHostId){
              var newHost = remaining.filter(function(p){return p.id===newHostId;})[0];
              updates.hostId = newHostId;
              updates.log = fv().arrayUnion(
                {text: state.name+' saiu da sala.', type:'system', ts:nowTs()},
                {text: '👑 '+(newHost?newHost.name:'?')+' agora é o anfitrião da sala.', type:'system', ts:nowTs()}
              );
            }
          } else {
            updates.hostId = null; // sala vazia — o próximo a entrar vira anfitrião automaticamente
          }
        }
        tx.update(ref, updates);
      });
    }catch(e){
      console.warn('Não foi possível registrar a saída do jogador:', e);
    }
  }
  goHome();
}

function goHome(){
  detachListeners();
  clearSession();
  state.screen = 'home';
  state.room = null;
  state.code = '';
  state.playerId = null;
  state.isSpectator = false;
  state.goneReason = '';
  state.notes = buildEmptyNotes();
  render();
}

function activePlayers(){
  return state.room.players.filter(function(p){return p.id!==state.playerId;});
}

function renderHome(){
  return ''+
  '<div class="masthead">'+
    '<div class="kicker">Dossiê Confidencial · Jogo de Dedução</div>'+
    '<h1>DETETIVE</h1>'+
    '<div class="sub">Companion digital para o seu jogo de detetive com tabuleiro físico</div>'+
  '</div>'+
  '<div class="panel">'+
    '<span class="stamp">Novo Caso</span>'+
    '<h2 style="margin-top:14px;font-size:18px;color:var(--gold-bright);">Abrir uma investigação</h2>'+
    '<div class="field" style="margin-top:14px;">'+
      '<label>Seu nome de detetive</label>'+
      '<input type="text" id="name-input" placeholder="Ex: Inspetora Lima" maxlength="24">'+
    '</div>'+
    '<button class="primary" onclick="__actions.createRoom()">Criar Sala</button>'+
    (state.error ? '<div class="error">'+esc(state.error)+'</div>' : '')+
  '</div>'+
  '<div class="panel">'+
    '<span class="stamp">Entrar</span>'+
    '<h2 style="margin-top:14px;font-size:18px;color:var(--gold-bright);">Entrar em um caso existente</h2>'+
    '<div class="row" style="margin-top:14px;">'+
      '<div class="field">'+
        '<label>Seu nome de detetive</label>'+
        '<input type="text" id="join-name-input" placeholder="Ex: Detetive Rocha" maxlength="24">'+
      '</div>'+
      '<div class="field">'+
        '<label>Código do caso</label>'+
        '<input type="text" id="join-code-input" placeholder="Ex: 7K3QZ" maxlength="6" style="text-transform:uppercase;">'+
      '</div>'+
    '</div>'+
    '<button class="primary" onclick="__actions.joinRoom()">Entrar em Sala</button>'+
    (state.joinError ? '<div class="error">'+esc(state.joinError)+'</div>' : '')+
  '</div>'+
  '<div style="text-align:center;">'+
    '<button class="link" onclick="__actions.goHistory()">Ver histórico de casos resolvidos</button>'+
  '</div>';
}

function renderLobby(){
  var room = state.room;
  var isHost = room.hostId === state.playerId;
  var players = room.players;
  var canStart = players.length>=3;
  return ''+
  '<div class="masthead">'+
    '<div class="kicker">Sala de Espera</div>'+
    '<h1>DETETIVE</h1>'+
  '</div>'+
  '<div class="panel">'+
    '<div class="section-title"><h2>Código do Caso</h2><button class="small" onclick="__actions.leaveLobby()">Sair</button></div>'+
    '<div class="code-row">'+
      '<div class="code-badge">'+esc(room.code)+'</div>'+
      '<button type="button" class="small" id="copy-code-btn" onclick="__actions.copyRoomCode()">Copiar</button>'+
    '</div>'+
    '<p class="hint">Compartilhe esse código com os outros jogadores para eles entrarem.</p>'+
  '</div>'+
  '<div class="panel">'+
    '<div class="section-title"><h2>Detetives na sala ('+players.length+')</h2></div>'+
    '<div class="players-list">'+
      players.map(function(p, idx){
        var cls = 'player-row'+(p.id===state.playerId?' you':'');
        var pieceName = p.suspect;
        return '<div class="'+cls+'">'+
          '<span>'+esc(p.name)+(p.id===state.playerId?' (você)':'')+(pieceName?' — <span class="piece-name">'+esc(pieceName)+'</span>':'')+'</span>'+
          (p.id===room.hostId ? '<span class="badge host">Anfitrião</span>' : '')+
        '</div>';
      }).join('')+
    '</div>'+
    (isHost ? (
      '<div class="row" style="margin-top:16px;">'+
        (canStart ?
          '<button class="primary" onclick="__actions.startGame()">Iniciar Investigação</button>' :
          '<button disabled>Iniciar Investigação (mín. 3 detetives)</button>'
        )+
        '<button class="danger" onclick="__actions.cancelRoom()">Cancelar Sala</button>'+
      '</div>'
    ) : '<p class="hint" style="margin-top:14px;">Aguardando o anfitrião iniciar a investigação. Assim que a partida começar, suas cartas aparecem aqui automaticamente.</p>')+
  '</div>';
}

function renderGame(){
  var room = state.room;
  var isSpectator = !!state.isSpectator;
  var me = room.players.filter(function(p){return p.id===state.playerId;})[0];
  var myTurn = isMyTurn();
  var ended = room.phase==='ended';

  var html = '<div class="masthead">'+
    '<div class="kicker">Caso #'+esc(room.code)+(isSpectator ? ' · Modo Espectador' : '')+'</div>'+
    '<h1>DETETIVE</h1>'+
    (ended ? '' : '<div class="sub">'+(isSpectator ? 'Acompanhando a investigação.' : (myTurn ? 'É a sua vez de agir, detetive.' : 'Vez de: '+esc(currentTurnName())))+'</div>')+
  '</div>';

  if(ended){
    var win = room.players.filter(function(p){return p.id===room.winner;})[0];
    html += '<div class="final-banner">'+
      '<h2>Caso Encerrado</h2>'+
      '<p class="solution-line">Vencedor: <b>'+esc(win?win.name:'?')+'</b></p>'+
      '<p class="solution-line">Solução: '+esc(room.secret.suspeito)+' · '+esc(room.secret.arma)+' · '+esc(room.secret.local)+'</p>'+
      '<div style="margin-top:14px;"><button class="primary" onclick="__actions.goHome()">Voltar ao Início</button></div>'+
    '</div>';
  }

  html += '<div class="panel">'+
    '<div class="section-title"><h2>Detetives</h2>'+(!ended?'<button class="small" onclick="__actions.leaveGame()">Sair</button>':'')+'</div>'+
    '<div class="players-list">'+
      room.players.map(function(p, idx){
        var cls = 'player-row';
        if(p.id===state.playerId) cls+=' you';
        if(p.eliminated) cls+=' eliminated';
        var isTurnPlayer = !ended && currentTurnName()===p.name;
        if(isTurnPlayer) cls+=' turn';
        var pieceName = p.suspect; // mesmo valor sorteado e gravado no jogador, usado igual no tabuleiro
        return '<div class="'+cls+'">'+
          '<span>'+esc(p.name)+(p.id===state.playerId?' (você)':'')+(pieceName?' — <span class="piece-name">'+esc(pieceName)+'</span>':'')+'</span>'+
          '<span>'+(isTurnPlayer?'<span class="badge turnb">Na vez</span>':'')+(p.eliminated?'<span class="badge">Eliminado</span>':'')+'</span>'+
        '</div>';
      }).join('')+
    '</div>'+
  '</div>';

  if(room.spectators && room.spectators.length){
    html += '<div class="panel">'+
      '<div class="section-title"><h2>Espectadores ('+room.spectators.length+')</h2>'+
        (isSpectator && !ended ? '<button class="small" onclick="__actions.leaveGame()">Sair</button>' : '')+
      '</div>'+
      '<div class="players-list">'+
        room.spectators.map(function(p){
          var cls = 'player-row'+(p.id===state.playerId?' you':'');
          return '<div class="'+cls+'"><span>👁 '+esc(p.name)+(p.id===state.playerId?' (você)':'')+'</span></div>';
        }).join('')+
      '</div>'+
    '</div>';
  }

  if(!ended && !isSpectator){
    html += '<div class="panel">'+
      '<div class="section-title"><h2>Suas Cartas</h2></div>'+
      '<div class="hand">'+
        (state.hand.length ? state.hand.map(function(c){
          var cat = cardCategory(c);
          return '<div class="card '+cat+'" onclick="__actions.openShowCard(\''+esc(c).replace(/'/g,"\\'")+'\')">'+
            '<img src="'+esc(cardImagePath(c))+'" alt="'+esc(c)+'" class="card-image">'+
          '</div>';
        }).join('') : '<div class="empty">Nenhuma carta.</div>')+
      '</div>'+
      '<p class="hint">Clique em uma carta para mostrá-la em segredo a um jogador específico.</p>'+
    '</div>';

    html += '<div class="panel notes-panel">'+
      '<div class="section-title"><h2>Ficha de Anotações</h2></div>'+
      '<p class="hint">Clique em um item para alternar: em branco → descartado (✕) → suspeito (?) → em branco.</p>'+
      '<div class="notes-grid">'+
        notesColumn('suspeito','Suspeitos',SUSPEITOS)+
        notesColumn('arma','Armas',ARMAS)+
        notesColumn('local','Cômodos',LOCAIS)+
      '</div>'+
    '</div>';

    // em qual sala (se houver) o meu peão está agora, segundo o tabuleiro
    var myRoom = (typeof window.boardCurrentRoomOf === 'function') ? window.boardCurrentRoomOf(state.playerId) : null;

    // detecta se isso é uma visita NOVA à sala (entrou agora, veio de fora ou
    // de outra sala) — nesse caso libera o palpite de novo. Enquanto o
    // jogador ficar na mesma sala sem sair, mesmo em turnos seguintes, o
    // palpite continua travado.
    if(myRoom !== state.lastSeenRoom){
      if(myRoom) state.suggestedRoomVisit = null;
      state.lastSeenRoom = myRoom;
    }
    var jaSugeriuNestaVisita = myRoom && state.suggestedRoomVisit === myRoom;

    html += '<div class="panel">'+
      '<div class="section-title"><h2>Ações</h2></div>'+
      (myTurn && !myRoom ? '<div class="sub" style="margin-bottom:8px;">Você precisa estar dentro de uma sala para fazer um palpite ou acusação. Role o dado e mova seu peão até uma porta.</div>' : '')+
      '<div class="row">'+
        (myTurn && myRoom && !jaSugeriuNestaVisita ?
          '<button onclick="__actions.openSuggest()">Fazer Palpite</button>' :
          '<button disabled title="'+(!myTurn ? 'Aguarde a sua vez.' : !myRoom ? 'Você precisa estar dentro de uma sala.' : 'Você já fez um palpite nesta sala. Saia e entre novamente para poder sugerir de novo.')+'">Fazer Palpite</button>'
        )+
        (myTurn ? '<button onclick="__actions.passTurn()">Passar a Vez</button>' : '')+
        (!me.eliminated && myTurn && myRoom ?
          '<button class="danger" onclick="__actions.openAccuse()">Acusação Final</button>' :
          (!me.eliminated ? '<button class="danger" disabled title="'+(!myTurn ? 'Aguarde a sua vez.' : 'Você precisa estar dentro de uma sala.')+'">Acusação Final</button>' : '')
        )+
      '</div>'+
    '</div>';

    if(state.notifications.length){
      html += '<div class="panel">'+
        '<div class="section-title"><h2>Cartas que te mostraram</h2></div>'+
        '<div class="notify">'+
          state.notifications.slice().reverse().map(function(n){
            return '<div class="notify-item"><b>'+esc(n.from)+'</b> te mostrou: <b>'+esc(n.card)+'</b> <span style="color:var(--muted);">('+esc(n.ts)+')</span> '+
              '<button class="small" style="margin-left:8px;" onclick="__actions.markFromNotification(\''+esc(n.card).replace(/'/g,"\\'")+'\')">Marcar na ficha</button>'+
            '</div>';
          }).join('')+
        '</div>'+
      '</div>';
    }
  }

  html += '<div class="panel">'+
    '<div class="section-title"><h2>Registro do Caso</h2></div>'+
    '<div class="log">'+
      (room.log.length ? room.log.slice().reverse().map(function(l){
        return '<div class="log-entry '+l.type+'">'+esc(l.text)+'<span class="ts">'+esc(l.ts)+'</span></div>';
      }).join('') : '<div class="empty">Nenhum evento ainda.</div>')+
    '</div>'+
  '</div>';

  if(state.showCardModal){
    var card = state.showCardModal;
    var others = activePlayers();
    html += '<div class="modal-overlay" onclick="if(event.target===this) __actions.closeModals()">'+
      '<div class="modal">'+
        '<h3>Mostrar "'+esc(card)+'" para:</h3>'+
        (others.length ? others.map(function(p){
          return '<button style="width:100%;margin-bottom:8px;" onclick="__actions.showCardTo(\''+p.id+'\')">'+esc(p.name)+'</button>';
        }).join('') : '<div class="empty">Não há outros jogadores.</div>')+
        '<div class="modal-actions"><button class="small" onclick="__actions.closeModals()">Cancelar</button></div>'+
      '</div>'+
    '</div>';
  }

  if(state.showSuggestModal){
    var sp = state.suggestModalPos;
    var spStyle = sp ? ' style="position:fixed;left:'+sp.left+'px;top:'+sp.top+'px;margin:0;"' : '';
    var salaAtual = (typeof window.boardCurrentRoomOf === 'function') ? window.boardCurrentRoomOf(state.playerId) : null;
    if(salaAtual) state.suggestPick.local = salaAtual; // só pode sugerir a sala onde está
    html += '<div class="modal-overlay" onclick="if(event.target===this) __actions.closeModals()">'+
      '<div class="modal" id="suggestModal"'+spStyle+'>'+
        '<div class="modal-drag-handle" style="cursor:grab;touch-action:none;margin:-20px -20px 14px;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,.12);">'+
          '<h3 style="margin:0;">⠿ Fazer um palpite</h3>'+
        '</div>'+
        selectField('suggestPick','suspeito','Suspeito',SUSPEITOS)+
        selectField('suggestPick','arma','Arma',ARMAS)+
        '<label class="field-label">Cômodo</label>'+
        '<div class="field-locked" style="padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.06);margin-bottom:12px;">'+
          esc(salaAtual || '—')+' <span style="opacity:.6;font-size:11px;">(a sala onde você está agora)</span>'+
        '</div>'+
        '<div class="modal-actions"><button class="primary" onclick="__actions.makeSuggestion()">Registrar Palpite</button><button class="small" onclick="__actions.closeModals()">Cancelar</button></div>'+
      '</div>'+
    '</div>';
  }

  if(state.showAccuseModal){
    html += '<div class="modal-overlay" onclick="if(event.target===this) __actions.closeModals()">'+
      '<div class="modal">'+
        '<h3>Acusação Final</h3>'+
        '<p class="hint" style="margin-bottom:14px;">Atenção: se errar, você não poderá mais vencer nesta partida.</p>'+
        selectField('accusePick','suspeito','Suspeito',SUSPEITOS)+
        selectField('accusePick','arma','Arma',ARMAS)+
        selectField('accusePick','local','Cômodo',LOCAIS)+
        '<div class="modal-actions"><button class="danger" onclick="__actions.makeAccusation()">Confirmar Acusação</button><button class="small" onclick="__actions.closeModals()">Cancelar</button></div>'+
      '</div>'+
    '</div>';
  }

  return html;
}

function notesColumn(cat, label, items){
  return '<div class="notes-col">'+
    '<div class="notes-col-title">'+esc(label)+'</div>'+
    items.map(function(item){
      var status = (state.notes[cat] && state.notes[cat][item]) || '';
      return '<div class="notes-item" onclick="__actions.toggleNote(\''+cat+'\',\''+esc(item).replace(/'/g,"\\'")+'\')">'+
        '<span class="notes-mark '+noteMarkClass(status)+'">'+noteMarkSymbol(status)+'</span>'+
        '<span class="notes-item-name">'+esc(item)+'</span>'+
      '</div>';
    }).join('')+
  '</div>';
}

function selectField(stateKey, field, label, options){
  var id = stateKey+'-'+field;
  return '<div class="field">'+
    '<label>'+label+'</label>'+
    '<select id="'+id+'" onchange="__actions.updatePick(\''+stateKey+'\',\''+field+'\',this.value)">'+
      options.map(function(o){
        var sel = state[stateKey][field]===o ? ' selected' : '';
        return '<option value="'+esc(o)+'"'+sel+'>'+esc(o)+'</option>';
      }).join('')+
    '</select>'+
  '</div>';
}

function renderGone(){
  return ''+
  '<div class="masthead">'+
    '<div class="kicker">Aviso</div>'+
    '<h1>DETETIVE</h1>'+
  '</div>'+
  '<div class="final-banner">'+
    '<h2>Investigação Encerrada</h2>'+
    '<p class="solution-line">'+esc(state.goneReason||'Esta sala não está mais disponível.')+'</p>'+
    '<div style="margin-top:14px;"><button class="primary" onclick="__actions.goHome()">Voltar ao Início</button></div>'+
  '</div>';
}

function renderHistory(){
  return ''+
  '<div class="masthead">'+
    '<div class="kicker">Arquivo Morto</div>'+
    '<h1>Histórico de Casos</h1>'+
  '</div>'+
  '<div class="panel">'+
    (state.history.length ? state.history.map(function(h){
      return '<div class="history-item">'+
        '<span class="code">#'+esc(h.code)+'</span> · '+esc(h.finishedAtStr)+'<br>'+
        'Detetives: '+esc(h.players.join(', '))+'<br>'+
        'Vencedor: <b>'+esc(h.winner)+'</b>'+
        '<div class="solution">Solução: '+esc(h.solution.suspeito)+' · '+esc(h.solution.arma)+' · '+esc(h.solution.local)+'</div>'+
      '</div>';
    }).join('') : '<div class="empty">Nenhum caso arquivado ainda. Resolva um mistério para ele aparecer aqui.</div>')+
  '</div>'+
  '<div style="text-align:center;"><button onclick="__actions.goHome()">Voltar ao Início</button></div>';
}

function render(){
  var app = document.getElementById('app');
  var html = '';
  if(state.screen==='home') html = renderHome();
  else if(state.screen==='lobby') html = state.room ? renderLobby() : '<div class="empty">Carregando caso...</div>';
  else if(state.screen==='game') html = state.room ? renderGame() : '<div class="empty">Carregando caso...</div>';
  else if(state.screen==='history') html = renderHistory();
  else if(state.screen==='gone') html = renderGone();
  app.innerHTML = html;
  if(state.showSuggestModal) attachSuggestModalDrag();
}

// arrasta o modal "Fazer um palpite" pela barra do topo. Precisa ser
// reanexado a cada render(), pois o innerHTML do #app é recriado do zero
// sempre que a sala do Firestore atualiza (ex: novo item no log).
function attachSuggestModalDrag(){
  var modal = document.getElementById('suggestModal');
  var handle = modal && modal.querySelector('.modal-drag-handle');
  if(!modal || !handle) return;

  var dragging=false, sx=0, sy=0, ox=0, oy=0;

  handle.addEventListener('pointerdown', function(e){
    var r = modal.getBoundingClientRect();
    modal.style.position='fixed'; modal.style.margin='0';
    modal.style.left=r.left+'px'; modal.style.top=r.top+'px';
    dragging=true; sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var dx=e.clientX-sx, dy=e.clientY-sy;
    var left = Math.min(Math.max(0, ox+dx), window.innerWidth-60);
    var top  = Math.min(Math.max(0, oy+dy), window.innerHeight-40);
    modal.style.left=left+'px'; modal.style.top=top+'px';
  });
  function stop(){
    if(!dragging) return;
    dragging=false;
    state.suggestModalPos = {
      left: parseFloat(modal.style.left)||0,
      top: parseFloat(modal.style.top)||0
    };
  }
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

window.__actions = {
  createRoom: createRoom,
  joinRoom: joinRoom,
  startGame: startGame,
  cancelRoom: cancelRoom,
  goHome: goHome,
  leaveGame: leaveGame,
  leaveLobby: leaveLobby,
  copyRoomCode: copyRoomCode,
  goHistory: goHistory,
  passTurn: passTurn,
  openSuggest: function(){ state.showSuggestModal=true; render(); },
  openAccuse: function(){ state.showAccuseModal=true; render(); },
  closeModals: function(){ state.showCardModal=null; state.showSuggestModal=false; state.showAccuseModal=false; render(); },
  openShowCard: openShowCard,
  showCardTo: showCardTo,
  toggleNote: toggleNote,
  markFromNotification: markFromNotification,
  makeSuggestion: makeSuggestion,
  makeAccusation: makeAccusation,
  updatePick: function(stateKey, field, value){ state[stateKey][field] = value; }
};

// Tenta reconectar automaticamente após um F5, se houver sessão salva.
// Qualquer falha aqui cai de volta silenciosamente para a tela inicial normal.
async function init(){
  var session = loadSession();
  if(!session || !session.code || !session.pid){
    render();
    return;
  }
  try{
    var snap = await roomsCol().doc(session.code).get();
    if(!snap.exists){
      clearSession();
      render();
      return;
    }
    var room = snap.data();
    if(room.phase==='cancelled'){
      clearSession();
      render();
      return;
    }
    var stillInPlayers = room.players.some(function(p){ return p.id===session.pid; });
    var stillInSpectators = (room.spectators||[]).some(function(p){ return p.id===session.pid; });
    if(!stillInPlayers && !stillInSpectators){
      clearSession();
      render();
      return;
    }
    state.name = session.name;
    state.code = session.code;
    state.playerId = session.pid;
    state.room = room;
    state.isSpectator = !stillInPlayers && stillInSpectators;
    attachListeners(session.code, session.pid);
    state.screen = room.phase==='lobby' ? 'lobby' : 'game';
    render();
  }catch(e){
    clearSession();
    render();
  }
}

init();
})();