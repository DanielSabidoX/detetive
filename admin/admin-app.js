/* ===== Painel Administrativo — Caso Arquivado =====
   Totalmente independente do jogo (main.js). Usa o MESMO projeto Firebase
   (via ../firebase-config.js) só que com Firebase Authentication (Google).
   Qualquer conta cadastrada no Firebase Authentication do projeto é tratada
   como administradora — não existe lista extra de permissões aqui.

   Coleções que este painel lê/apaga (as mesmas do jogo):
     rooms, hands, notes, notifications, solution_reveal, voice_rooms
*/
(function(){
  'use strict';

  var auth, db;
  var currentUser = null;
  var currentCode = null; // null = lista de partidas; senão = detalhe de uma partida
  var rooms = [];

  var PHASE_LABELS = {
    lobby: 'Aguardando jogadores',
    playing: 'Em andamento',
    ended: 'Encerrada',
    cancelled: 'Cancelada'
  };

  function app(){ return document.getElementById('admin-app'); }
  function mainEl(){ return document.getElementById('adm-main'); }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ---------------- modal de confirmação (substitui o confirm() nativo) ----------------
  function confirmModal(opts){
    var overlay = document.createElement('div');
    overlay.className = 'adm-modal-overlay';
    overlay.innerHTML =
      '<div class="adm-modal">'+
        '<h3>'+esc(opts.title || 'Confirmar ação')+'</h3>'+
        '<p class="adm-modal-msg">'+esc(opts.message || '')+'</p>'+
        '<div class="adm-modal-actions">'+
          '<button type="button" class="small" data-act="cancel">Cancelar</button>'+
          '<button type="button" class="small danger" data-act="confirm">'+esc(opts.confirmLabel || 'Confirmar')+'</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', function(){
      close();
      if(typeof opts.onConfirm === 'function') opts.onConfirm();
    });
  }
  function fmtDate(ts){
    if(!ts) return '—';
    try{ return new Date(ts).toLocaleString('pt-BR'); }catch(e){ return '—'; }
  }

  function init(){
    if(typeof firebase === 'undefined'){
      app().innerHTML = '<div class="adm-login-wrap"><div class="adm-login-card">'+
        '<h1>Erro de configuração</h1><p class="adm-sub">Firebase não carregou. Confira o caminho de firebase-config.js em index.html.</p>'+
        '</div></div>';
      return;
    }
    auth = firebase.auth();
    db = firebase.firestore();
    auth.onAuthStateChanged(function(user){
      currentUser = user;
      currentCode = null;
      render();
    });
  }

  function login(){
    var btn = document.getElementById('btn-google-login');
    var errEl = document.getElementById('adm-login-error');
    if(errEl) errEl.textContent = '';
    var provider = new firebase.auth.GoogleAuthProvider();
    if(btn) btn.disabled = true;
    auth.signInWithPopup(provider).catch(function(err){
      if(errEl) errEl.textContent = 'Falha no login: ' + (err && err.message ? err.message : err);
    }).then(function(){
      if(btn) btn.disabled = false;
    });
  }
  function logout(){ auth.signOut(); }

  // ==================== RENDER ====================
  function render(){
    if(!currentUser){ renderLogin(); return; }
    renderShell();
    if(currentCode) renderDetail(currentCode);
    else renderList();
  }

  function renderLogin(){
    app().innerHTML =
      '<div class="adm-login-wrap">'+
        '<div class="adm-login-card">'+
          '<div class="adm-kicker">Caso Arquivado</div>'+
          '<h1>Painel Administrativo</h1>'+
          '<p class="adm-sub">Acesso restrito à equipe. Entre com uma conta Google cadastrada no projeto.</p>'+
          '<button type="button" class="adm-google-btn" id="btn-google-login">Entrar com Google</button>'+
          '<div class="adm-error-msg" id="adm-login-error"></div>'+
        '</div>'+
      '</div>';
    document.getElementById('btn-google-login').addEventListener('click', login);
  }

  function renderShell(){
    app().innerHTML =
      '<div id="adm-shell">'+
        '<header class="adm-header">'+
          '<div class="adm-header-left">'+
            '<span class="adm-brand">Caso Arquivado</span>'+
            '<span class="adm-brand-sep">/</span>'+
            '<span class="adm-brand-sub">Painel Administrativo</span>'+
          '</div>'+
          '<nav class="adm-nav">'+
            '<button type="button" class="adm-nav-btn active" id="nav-partidas">Partidas</button>'+
          '</nav>'+
          '<div class="adm-header-right">'+
            '<span class="adm-user">'+esc(currentUser.displayName || currentUser.email || 'Administrador')+'</span>'+
            '<button type="button" class="adm-logout-btn small" id="btn-logout">Sair</button>'+
          '</div>'+
        '</header>'+
        '<main class="adm-main" id="adm-main"></main>'+
      '</div>';
    document.getElementById('nav-partidas').addEventListener('click', function(){ currentCode = null; renderList(); });
    document.getElementById('btn-logout').addEventListener('click', logout);
  }

  // ---------------- lista de partidas ----------------
  function renderList(){
    mainEl().innerHTML = '<div class="adm-empty">Carregando partidas...</div>';
    db.collection('rooms').orderBy('createdAt', 'desc').limit(200).get().then(function(snap){
      rooms = [];
      snap.forEach(function(doc){ rooms.push(Object.assign({code: doc.id}, doc.data())); });
      drawList();
    }).catch(function(err){
      mainEl().innerHTML = '<div class="adm-error">Não foi possível carregar as partidas: ' + esc(err.message || err) + '</div>';
    });
  }

  function drawList(){
    var toolbar =
      '<div class="adm-toolbar">'+
        '<h2>Partidas ('+rooms.length+')</h2>'+
        '<button type="button" class="small" id="btn-refresh">Atualizar</button>'+
      '</div>';

    if(!rooms.length){
      mainEl().innerHTML = toolbar + '<div class="adm-empty">Nenhuma partida encontrada.</div>';
      document.getElementById('btn-refresh').addEventListener('click', renderList);
      return;
    }

    var rows = rooms.map(function(r){
      var host = (r.players || []).filter(function(p){ return p.id === r.hostId; })[0];
      return '<tr>'+
        '<td class="mono">'+esc(r.code)+'</td>'+
        '<td><span class="adm-phase adm-phase-'+esc(r.phase||'')+'">'+esc(PHASE_LABELS[r.phase] || r.phase || '—')+'</span></td>'+
        '<td>'+esc(host ? host.name : '—')+'</td>'+
        '<td>'+(r.players ? r.players.length : 0)+'</td>'+
        '<td>'+esc(fmtDate(r.createdAt))+'</td>'+
        '<td class="adm-actions">'+
          '<button type="button" class="small" data-view="'+esc(r.code)+'">Ver</button>'+
          '<button type="button" class="small danger" data-del="'+esc(r.code)+'">Excluir</button>'+
        '</td>'+
      '</tr>';
    }).join('');

    mainEl().innerHTML =
      toolbar +
      '<div class="adm-table-wrap">'+
        '<table class="adm-table">'+
          '<thead><tr><th>Código</th><th>Status</th><th>Anfitrião</th><th>Jogadores</th><th>Criada em</th><th>Ações</th></tr></thead>'+
          '<tbody>'+rows+'</tbody>'+
        '</table>'+
      '</div>';

    document.getElementById('btn-refresh').addEventListener('click', renderList);
    mainEl().querySelectorAll('[data-view]').forEach(function(btn){
      btn.addEventListener('click', function(){ currentCode = btn.getAttribute('data-view'); renderDetail(currentCode); });
    });
    mainEl().querySelectorAll('[data-del]').forEach(function(btn){
      btn.addEventListener('click', function(){ deleteRoom(btn.getAttribute('data-del')); });
    });
  }

  // ---------------- excluir partida ----------------
  function deleteRoom(code){
    confirmModal({
      title: 'Excluir partida',
      message: 'Excluir a partida "'+code+'" permanentemente? Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: function(){ doDeleteRoom(code); }
    });
  }

  function doDeleteRoom(code){
    mainEl().innerHTML = '<div class="adm-empty">Excluindo partida '+esc(code)+'...</div>';

    var batch = db.batch();
    batch.delete(db.collection('rooms').doc(code));
    batch.delete(db.collection('solution_reveal').doc(code));

    var prefixQuery = function(col){
      return db.collection(col)
        .where(firebase.firestore.FieldPath.documentId(), '>=', code + '_')
        .where(firebase.firestore.FieldPath.documentId(), '<', code + '_\uf8ff')
        .get();
    };

    var voiceRef = db.collection('voice_rooms').doc(code);
    batch.delete(voiceRef);

    Promise.all([
      prefixQuery('hands'),
      prefixQuery('notes'),
      prefixQuery('notifications'),
      voiceRef.collection('peers').get(),
      voiceRef.collection('signals').get()
    ]).then(function(results){
      results.forEach(function(snap){ snap.forEach(function(doc){ batch.delete(doc.ref); }); });
      return batch.commit();
    }).then(function(){
      currentCode = null;
      renderList();
    }).catch(function(err){
      mainEl().innerHTML = '<div class="adm-error">Erro ao excluir: ' + esc(err.message || err) + '</div>';
    });
  }

  // ---------------- detalhe de uma partida ----------------
  function renderDetail(code){
    mainEl().innerHTML = '<div class="adm-empty">Carregando partida '+esc(code)+'...</div>';
    db.collection('rooms').doc(code).get().then(function(doc){
      if(!doc.exists){
        mainEl().innerHTML = '<div class="adm-error">Partida não encontrada (pode já ter sido excluída).</div>';
        return null;
      }
      var room = doc.data();
      var players = room.players || [];
      return Promise.all(players.map(function(p){
        return db.collection('hands').doc(code + '_' + p.id).get().then(function(hs){
          return { player: p, cards: hs.exists ? (hs.data().cards || []) : [] };
        });
      })).then(function(playerHands){
        drawDetail(code, room, playerHands);
      });
    }).catch(function(err){
      mainEl().innerHTML = '<div class="adm-error">Erro ao carregar a partida: ' + esc(err.message || err) + '</div>';
    });
  }

  function drawDetail(code, room, playerHands){
    var host = (room.players || []).filter(function(p){ return p.id === room.hostId; })[0];
    var winner = (room.players || []).filter(function(p){ return p.id === room.winner; })[0];

    var secretHtml = room.secret ?
      ('<b>'+esc(room.secret.suspeito)+'</b> + <b>'+esc(room.secret.arma)+'</b> + <b>'+esc(room.secret.local)+'</b>') :
      '<span class="adm-muted">ainda não definida</span>';

    var playersHtml = playerHands.map(function(ph){
      var p = ph.player;
      return '<div class="adm-player-card">'+
        '<div class="adm-player-head">'+
          '<span>'+esc(p.name)+'</span>'+
          (p.id === room.hostId ? '<span class="badge host">Anfitrião</span>' : '')+
          (p.eliminated ? '<span class="badge elim">Eliminado</span>' : '')+
          (p.id === room.winner ? '<span class="badge win">Vencedor</span>' : '')+
        '</div>'+
        '<div class="adm-player-cards">'+
          (ph.cards.length ?
            ph.cards.map(function(c){ return '<span class="adm-card-chip">'+esc(c)+'</span>'; }).join('') :
            '<span class="adm-muted">sem cartas</span>')+
        '</div>'+
      '</div>';
    }).join('');

    var logEntries = (room.log || []).slice().reverse();
    var logHtml = logEntries.length ?
      logEntries.map(function(l){
        return '<div class="adm-log-entry '+esc(l.type || '')+'">'+esc(l.text)+'<span class="ts">'+esc(l.ts)+'</span></div>';
      }).join('') :
      '<div class="adm-muted">Sem eventos registrados.</div>';

    mainEl().innerHTML =
      '<div class="adm-toolbar">'+
        '<button type="button" class="small" id="btn-back">← Voltar</button>'+
        '<h2>Partida '+esc(code)+'</h2>'+
        '<button type="button" class="small danger" id="btn-del-detail">Excluir partida</button>'+
      '</div>'+
      '<div class="adm-detail-grid">'+
        '<section class="adm-panel-box">'+
          '<h3>Resumo</h3>'+
          '<div class="adm-kv"><span>Status</span><b>'+esc(PHASE_LABELS[room.phase] || room.phase)+'</b></div>'+
          '<div class="adm-kv"><span>Anfitrião</span><b>'+esc(host ? host.name : '—')+'</b></div>'+
          '<div class="adm-kv"><span>Criada em</span><b>'+esc(fmtDate(room.createdAt))+'</b></div>'+
          '<div class="adm-kv"><span>Vencedor</span><b>'+esc(winner ? winner.name : '—')+'</b></div>'+
          '<div class="adm-kv"><span>Solução</span><b>'+secretHtml+'</b></div>'+
        '</section>'+
        '<section class="adm-panel-box">'+
          '<h3>Jogadores</h3>'+
          (playersHtml || '<div class="adm-muted">Sem jogadores.</div>')+
        '</section>'+
        '<section class="adm-panel-box adm-panel-wide">'+
          '<h3>Registro do caso</h3>'+
          '<div class="adm-log">'+logHtml+'</div>'+
        '</section>'+
      '</div>';

    document.getElementById('btn-back').addEventListener('click', function(){ currentCode = null; renderList(); });
    document.getElementById('btn-del-detail').addEventListener('click', function(){ deleteRoom(code); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();