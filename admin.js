/* ===== Painel do Anfitrião v1 =====
   Totalmente independente do main.js. Só faz LEITURA da coleção "rooms"
   (pra saber quem é o anfitrião, de quem é a vez, e o segredo do caso) e
   ESCREVE apenas em campos que o próprio jogo já usa (turnIndex, log) ou
   na coleção isolada "solution_reveal" (a mesma que o painel de Solução
   do Caso já usa — os dois ficam sincronizados automaticamente).

   O painel só aparece visualmente para quem é o anfitrião da sala atual.

   Uso, depois de incluir Firebase + firebase-config.js + este arquivo:
   <div id="admin-painel"></div>
   <script src="admin.js"></script>
   <script>mountAdmin('#admin-painel');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }
  function escHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function nowTs(){
    var d = new Date();
    return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  }
  function fv(){ return firebase.firestore.FieldValue; }

  // mesma lógica de turno do main.js, só de leitura, pra saber de quem é a vez
  function activeTurnOrder(room){
    return (room.turnOrder||[]).filter(function(id){
      var p = room.players.filter(function(pp){return pp.id===id;})[0];
      return p && !p.eliminated;
    });
  }
  function currentTurnPlayer(room){
    var order = activeTurnOrder(room);
    if(!order.length) return null;
    var idx = (room.turnIndex||0) % order.length;
    var pid = order[idx];
    return room.players.filter(function(p){return p.id===pid;})[0] || null;
  }

  window.mountAdmin = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="adm-handle">'+
        '<h3>Painel do Anfitrião</h3>'+
        '<button type="button" class="adm-toggle">_</button>'+
      '</div>'+
      '<div class="adm-body">'+
        '<span class="adm-badge">Somente Você Vê Isto</span>'+
        '<div class="adm-content"></div>'+
      '</div>';

    var handle    = host.querySelector('.adm-handle');
    var toggleBtn = host.querySelector('.adm-toggle');
    var contentEl = host.querySelector('.adm-content');

    // ---------- botão "_" fecha o painel e volta pra barra de abas ----------
    toggleBtn.addEventListener('click', function(){
      if(typeof window.closePanelNav === 'function') window.closePanelNav();
    });

    // ---------- estado ----------
    var roomCode = null;
    var room = null;
    var revealState = null;
    var unsubRoom = null;
    var unsubReveal = null;

    function isHost(){
      var s = getSession();
      return !!(s && room && s.pid === room.hostId);
    }

    // quando o tabuleiro avisa que o zoom sincronizado mudou, atualiza o botão
    var _renderingAdmin = false;
    window.addEventListener('board-zoom-sync-changed', function(){
      if(_renderingAdmin) return;
      render();
    });

    function render(){
      _renderingAdmin = true;
      try{ renderInner(); } finally { _renderingAdmin = false; }
    }

    function renderInner(){
      // o painel inteiro só fica visível pra quem é o anfitrião da sala atual
      if(isHost()){
        host.classList.add('visible');
        if(typeof window.boardForceHostControls === 'function') window.boardForceHostControls(true);
      } else {
        host.classList.remove('visible');
        if(typeof window.boardForceHostControls === 'function') window.boardForceHostControls(false);
        return;
      }


      if(!room){
        contentEl.innerHTML = '<div class="adm-empty">Entre em uma sala para ver este painel.</div>';
        return;
      }

      var revealed = !!(revealState && revealState.revealed);
      var turnPlayer = currentTurnPlayer(room);
      var ended = room.phase==='ended';
      var inGame = room.phase==='playing' || room.phase==='ended';

      var html = '';

      if(inGame){
        html += '<div class="adm-section">'+
          '<div class="adm-section-title">Solução do Caso</div>';
        if(revealed){
          html += '<div class="adm-desc">Já revelada por '+escHtml(revealState.revealedBy||'?')+'.</div>';
        } else if(ended){
          html += '<div class="adm-desc">O caso já foi resolvido, não é preciso revelar.</div>';
        } else {
          html += '<div class="adm-desc">Use se ninguém conseguir acertar o caso — mostra as 3 cartas para todos e registra no Registro do Caso.</div>'+
            '<button type="button" class="adm-btn danger" id="adm-reveal-btn">Revelar Solução</button>';
        }
        html += '</div>';

        html += '<div class="adm-section">'+
          '<div class="adm-section-title">Controle de Turno</div>';
        if(ended){
          html += '<div class="adm-desc">A partida já terminou.</div>';
        } else if(!turnPlayer){
          html += '<div class="adm-empty">Nenhum jogador ativo no momento.</div>';
        } else {
          html += '<div class="adm-current-turn">Vez atual: <b>'+escHtml(turnPlayer.name)+'</b></div>'+
            '<button type="button" class="adm-btn" id="adm-pass-btn">Pular Vez de '+escHtml(turnPlayer.name)+'</button>';
        }
        html += '</div>';

        var diceLocked = !!room.diceLocked;
        html += '<div class="adm-section">'+
          '<div class="adm-section-title">Controle do Dado</div>'+
          '<div class="adm-desc">'+(diceLocked
            ? 'O dado está desabilitado para todos os jogadores no momento.'
            : 'Bloqueia o botão de rolar dado para todos os jogadores da sala.')+'</div>'+
          '<button type="button" class="adm-btn'+(diceLocked?' danger':'')+'" id="adm-dice-toggle-btn">'+
            (diceLocked ? 'Habilitar Dado' : 'Desabilitar Dado para Todos')+
          '</button>'+
        '</div>';
      }

      // ---- Zoom do mapa sincronizado ----
      var zoomSynced = (typeof window.boardIsZoomSynced === 'function') ? !!window.boardIsZoomSynced() : false;
      var hasBoard = (typeof window.boardSetZoomSync === 'function');
      html += '<div class="adm-section">'+
        '<div class="adm-section-title">Zoom do Mapa</div>';
      if(!hasBoard){
        html += '<div class="adm-empty">Abra o tabuleiro para controlar o zoom.</div>';
      } else {
        html += '<div class="adm-desc">'+(zoomSynced
          ? 'O zoom está sincronizado: quando qualquer jogador dá zoom ou arrasta o mapa, todos veem igual.'
          : 'Cada jogador controla o zoom do mapa localmente.')+'</div>'+
          '<button type="button" class="adm-btn'+(zoomSynced?' danger':'')+'" id="adm-zoom-sync-btn">'+
            (zoomSynced ? 'Desativar Zoom Sincronizado' : 'Sincronizar Zoom para Todos')+
          '</button>';
      }
      html += '</div>';

      var others = room.players.filter(function(p){ return p.id!==room.hostId; });
      html += '<div class="adm-section">'+
        '<div class="adm-section-title">Transferir Anfitrião</div>';
      if(!others.length){
        html += '<div class="adm-empty">Não há outros jogadores na sala.</div>';
      } else {
        html += '<div class="adm-desc">Escolha quem vira o novo anfitrião da sala.</div>'+
          '<select id="adm-host-select">'+
            others.map(function(p){
              return '<option value="'+escHtml(p.id)+'">'+escHtml(p.name)+(p.eliminated?' (eliminado)':'')+'</option>';
            }).join('')+
          '</select>'+
          '<button type="button" class="adm-btn" id="adm-host-transfer-btn" style="margin-top:8px;">Tornar Anfitrião</button>';
      }
      html += '</div>';

      contentEl.innerHTML = html;

      var zoomBtn = contentEl.querySelector('#adm-zoom-sync-btn');
      if(zoomBtn){
        zoomBtn.addEventListener('click', function(){
          if(typeof window.boardSetZoomSync === 'function'){
            window.boardSetZoomSync(!zoomSynced);
          }
        });
      }


      var revealBtn = contentEl.querySelector('#adm-reveal-btn');
      if(revealBtn){ revealBtn.addEventListener('click', doReveal); }
      var passBtn = contentEl.querySelector('#adm-pass-btn');
      if(passBtn){ passBtn.addEventListener('click', function(){ doPassTurn(turnPlayer); }); }
      var diceBtn = contentEl.querySelector('#adm-dice-toggle-btn');
      if(diceBtn){ diceBtn.addEventListener('click', function(){ doToggleDiceLock(room.diceLocked); }); }
      var transferBtn = contentEl.querySelector('#adm-host-transfer-btn');
      var hostSelect = contentEl.querySelector('#adm-host-select');
      if(transferBtn && hostSelect){
        transferBtn.addEventListener('click', function(){
          var newHostId = hostSelect.value;
          var newHost = others.filter(function(p){return p.id===newHostId;})[0];
          if(newHost) doTransferHost(newHost);
        });
      }
    }

    function doTransferHost(newHost){
      if(!roomCode || typeof db === 'undefined') return;
      var s = getSession();
      var byName = (s && s.name) ? s.name : 'Anfitrião';

      var btn = contentEl.querySelector('#adm-host-transfer-btn');
      if(btn){ btn.disabled = true; }

      db.collection('rooms').doc(roomCode).update({
        hostId: newHost.id,
        log: fv().arrayUnion({
          text: '👑 '+byName+' passou o posto de anfitrião para '+newHost.name+'.',
          type: 'system', ts: nowTs()
        })
      }).catch(function(err){
        console.warn('[painel do anfitrião] não foi possível transferir o posto:', err && err.code, err && err.message);
        if(btn){ btn.disabled = false; }
      });
    }

    function doToggleDiceLock(currentlyLocked){
      if(!roomCode || typeof db === 'undefined') return;
      var s = getSession();
      var byName = (s && s.name) ? s.name : 'Anfitrião';
      var next = !currentlyLocked;

      var btn = contentEl.querySelector('#adm-dice-toggle-btn');
      if(btn){ btn.disabled = true; }

      db.collection('rooms').doc(roomCode).update({
        diceLocked: next,
        log: fv().arrayUnion({
          text: next
            ? '🎲 O anfitrião ('+byName+') desabilitou o dado para todos.'
            : '🎲 O anfitrião ('+byName+') habilitou o dado novamente.',
          type: 'system', ts: nowTs()
        })
      }).catch(function(err){
        console.warn('[painel do anfitrião] não foi possível alterar o bloqueio do dado:', err && err.code, err && err.message);
        if(btn){ btn.disabled = false; }
      });
    }

    function doReveal(){
      if(!roomCode || typeof db === 'undefined' || !room || !room.secret) return;
      var s = getSession();
      var byName = (s && s.name) ? s.name : 'Anfitrião';
      var secret = room.secret;

      var btn = contentEl.querySelector('#adm-reveal-btn');
      if(btn){ btn.disabled = true; btn.textContent = 'Revelando...'; }

      db.collection('solution_reveal').doc(roomCode).set({
        revealed: true, revealedBy: byName, at: Date.now()
      }, {merge:true}).then(function(){
        var text = '🔓 '+byName+' revelou a solução do caso: '+
          secret.suspeito+' + '+secret.arma+' + '+secret.local+'.';
        return db.collection('rooms').doc(roomCode).update({
          log: fv().arrayUnion({text:text, type:'system', ts:nowTs()})
        });
      }).catch(function(err){
        console.warn('[painel do anfitrião] não foi possível revelar:', err && err.code, err && err.message);
        if(btn){ btn.disabled = false; btn.textContent = 'Revelar Solução'; }
      });
    }

    function doPassTurn(turnPlayer){
      if(!roomCode || typeof db === 'undefined' || !turnPlayer) return;
      var s = getSession();
      var byName = (s && s.name) ? s.name : 'Anfitrião';

      var btn = contentEl.querySelector('#adm-pass-btn');
      if(btn){ btn.disabled = true; }

      db.collection('rooms').doc(roomCode).update({
        turnIndex: fv().increment(1),
        log: fv().arrayUnion({
          text: '⏭ O anfitrião ('+byName+') pulou a vez de '+turnPlayer.name+'.',
          type: 'normal', ts: nowTs()
        })
      }).catch(function(err){
        console.warn('[painel do anfitrião] não foi possível pular a vez:', err && err.code, err && err.message);
        if(btn){ btn.disabled = false; }
      });
    }

    function listenRoom(code){
      if(unsubRoom){ unsubRoom(); unsubRoom=null; }
      if(!code || typeof db === 'undefined') return;
      unsubRoom = db.collection('rooms').doc(code).onSnapshot(function(snap){
        room = snap.exists ? snap.data() : null;
        render();
      }, function(err){
        console.warn('[painel do anfitrião] falha ao ler a sala:', err && err.code, err && err.message);
      });
    }

    function listenReveal(code){
      if(unsubReveal){ unsubReveal(); unsubReveal=null; }
      if(!code || typeof db === 'undefined') return;
      unsubReveal = db.collection('solution_reveal').doc(code).onSnapshot(function(snap){
        revealState = snap.exists ? snap.data() : null;
        render();
      }, function(err){
        console.warn('[painel do anfitrião] falha ao ler o estado de revelação:', err && err.code, err && err.message);
      });
    }

    function activate(code){
      roomCode = code;
      listenRoom(code);
      listenReveal(code);
    }

    function deactivate(){
      roomCode = null; room = null; revealState = null;
      if(unsubRoom){ unsubRoom(); unsubRoom=null; }
      if(unsubReveal){ unsubReveal(); unsubReveal=null; }
      host.classList.remove('visible');
    }

    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      if(code !== roomCode){
        if(code) activate(code); else deactivate();
      }
    }

    deactivate();
    checkSession();
    setInterval(checkSession, 1000);
  };
})();
