/* ===== Painel de Solução do Caso v1 =====
   Totalmente independente do main.js. Usa sua PRÓPRIA coleção no Firestore
   ("solution_reveal") pra guardar se a solução já foi revelada, e só faz
   LEITURA da coleção "rooms" (pra saber o segredo, quem é o anfitrião e a
   fase da partida). A única ESCRITA feita em "rooms" é um arrayUnion no
   campo "log" — o mesmo campo que o Registro do Caso do jogo já lê — então
   a revelação aparece lá automaticamente, sem precisar mexer no main.js.

   Uso, depois de incluir Firebase + firebase-config.js + este arquivo:
   <div id="solucao-painel"></div>
   <script src="solucao.js"></script>
   <script>mountSolution('#solucao-painel');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';
  var PANEL_POS_KEY = 'casoArquivado_solucao_pos_v1';
  var PANEL_COLLAPSED_KEY = 'casoArquivado_solucao_collapsed_v1';

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }
  function escHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  // mesma lógica do main.js, pra achar a mesma imagem que "Suas Cartas" já usa
  function slugify(s){
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function cardImagePath(name){
    return 'images/cards/' + slugify(name) + '.png';
  }

  window.mountSolution = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="sol-handle">'+
        '<h3>Solução do Caso</h3>'+
        '<button type="button" class="sol-toggle">_</button>'+
      '</div>'+
      '<div class="sol-body">'+
        '<div class="sol-status">Sem sala ativa</div>'+
        '<div class="sol-content"></div>'+
      '</div>';

    var handle    = host.querySelector('.sol-handle');
    var toggleBtn = host.querySelector('.sol-toggle');
    var statusEl  = host.querySelector('.sol-status');
    var contentEl = host.querySelector('.sol-content');

    // ---------- posição/estado salvo do painel ----------
    try{
      var savedPos = JSON.parse(localStorage.getItem(PANEL_POS_KEY));
      if(savedPos && typeof savedPos.left === 'number'){
        host.style.left = savedPos.left + 'px';
        host.style.top  = savedPos.top + 'px';
        host.style.right = 'auto';
        host.style.bottom = 'auto';
      }
    }catch(e){}
    try{
      if(localStorage.getItem(PANEL_COLLAPSED_KEY) === '1') host.classList.add('collapsed');
    }catch(e){}

    toggleBtn.addEventListener('click', function(){
      host.classList.toggle('collapsed');
      try{ localStorage.setItem(PANEL_COLLAPSED_KEY, host.classList.contains('collapsed') ? '1' : '0'); }catch(e){}
    });

    // ---------- arrastar o painel pela barra superior ----------
    (function panelDrag(){
      var dragging=false, sx=0, sy=0, ox=0, oy=0;
      handle.addEventListener('pointerdown', function(e){
        if(e.target === toggleBtn) return;
        var r = host.getBoundingClientRect();
        host.style.left = r.left+'px'; host.style.top = r.top+'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
        dragging = true; sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
        host.classList.add('dragging-panel');
        handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', function(e){
        if(!dragging) return;
        var dx=e.clientX-sx, dy=e.clientY-sy;
        var left = Math.min(Math.max(0, ox+dx), window.innerWidth-60);
        var top  = Math.min(Math.max(0, oy+dy), window.innerHeight-40);
        host.style.left = left+'px'; host.style.top = top+'px';
      });
      function stop(){
        if(!dragging) return;
        dragging=false;
        host.classList.remove('dragging-panel');
        try{
          localStorage.setItem(PANEL_POS_KEY, JSON.stringify({
            left: parseFloat(host.style.left)||0, top: parseFloat(host.style.top)||0
          }));
        }catch(e){}
      }
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    })();

    // ---------- estado ----------
    var roomCode = null;
    var room = null; // dados lidos de "rooms" (somente leitura aqui)
    var revealState = null; // dados de "solution_reveal"
    var unsubRoomRead = null;
    var unsubReveal = null;

    function isHost(){
      var s = getSession();
      return !!(s && room && s.pid === room.hostId);
    }
    function alreadyRevealed(){
      return !!(revealState && revealState.revealed);
    }

    function render(){
      if(room){
        if(alreadyRevealed()){
          statusEl.textContent = 'Solução revelada — sala ' + roomCode;
          statusEl.classList.add('revealed');
          statusEl.classList.remove('on');
        } else {
          statusEl.textContent = 'Sincronizado — sala ' + roomCode;
          statusEl.classList.add('on');
          statusEl.classList.remove('revealed');
        }
      }
      if(!room){
        contentEl.innerHTML = '<div class="sol-empty">Entre em uma sala para ver este painel.</div>';
        return;
      }
      if(room.phase !== 'playing' && room.phase !== 'ended'){
        contentEl.innerHTML = '<div class="sol-empty">Disponível assim que a investigação começar.</div>';
        return;
      }
      if(!room.secret){
        contentEl.innerHTML = '<div class="sol-empty">Aguardando o início da partida...</div>';
        return;
      }

      var revealed = alreadyRevealed();
      var cards = [
        {cat:'Suspeito', name: room.secret.suspeito, cls:'suspeito'},
        {cat:'Arma',     name: room.secret.arma,      cls:'arma'},
        {cat:'Cômodo',   name: room.secret.local,      cls:'local'}
      ];

      var html = '<div class="sol-cards">'+
        cards.map(function(c){
          return '<div class="sol-card '+c.cls+(revealed?' flipped':'')+'">'+
            '<div class="sol-face sol-back">'+
              '<div class="sol-lock">🔒</div>'+
              '<div class="sol-confidencial">Confidencial</div>'+
            '</div>'+
            '<div class="sol-face sol-front">'+
              '<img src="'+escHtml(cardImagePath(c.name))+'" alt="'+escHtml(c.name)+'" class="sol-card-image">'+
              '<div class="sol-card-caption">'+
                '<span class="sol-cat">'+escHtml(c.cat)+'</span>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>';

      if(revealed){
        html += '<div class="sol-revealed-by">Revelado por '+escHtml(revealState.revealedBy||'?')+'</div>';
      } else if(isHost()){
        html += '<button type="button" class="sol-reveal-btn">Revelar Solução</button>'+
                '<div class="sol-hint">Só você (anfitrião) vê este botão. Use se ninguém acertar o caso.</div>';
      } else {
        html += '<div class="sol-hint">Só o anfitrião pode revelar a solução.</div>';
      }

      contentEl.innerHTML = html;

      var btn = contentEl.querySelector('.sol-reveal-btn');
      if(btn){ btn.addEventListener('click', doReveal); }
    }

    function doReveal(){
      if(!roomCode || typeof db === 'undefined' || alreadyRevealed()) return;
      var s = getSession();
      var byName = (s && s.name) ? s.name : 'Anfitrião';
      var secret = room.secret;

      var btn = contentEl.querySelector('.sol-reveal-btn');
      if(btn){ btn.disabled = true; btn.textContent = 'Revelando...'; }

      db.collection('solution_reveal').doc(roomCode).set({
        revealed: true, revealedBy: byName, at: Date.now()
      }, {merge:true}).then(function(){
        var text = '🔓 '+byName+' revelou a solução do caso: '+
          secret.suspeito+' + '+secret.arma+' + '+secret.local+'.';
        return db.collection('rooms').doc(roomCode).update({
          log: firebase.firestore.FieldValue.arrayUnion({text:text, type:'system', ts:nowTs()})
        });
      }).catch(function(err){
        console.warn('[solução] não foi possível revelar:', err && err.code, err && err.message);
        if(btn){ btn.disabled = false; btn.textContent = 'Revelar Solução'; }
      });
    }

    function nowTs(){
      var d = new Date();
      return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    }

    function listenRoom(code){
      if(unsubRoomRead){ unsubRoomRead(); unsubRoomRead=null; }
      if(!code || typeof db === 'undefined') return;
      unsubRoomRead = db.collection('rooms').doc(code).onSnapshot(function(snap){
        room = snap.exists ? snap.data() : null;
        render();
      }, function(err){
        console.warn('[solução] falha ao ler a sala:', err && err.code, err && err.message);
      });
    }

    function listenReveal(code){
      if(unsubReveal){ unsubReveal(); unsubReveal=null; }
      if(!code || typeof db === 'undefined') return;
      unsubReveal = db.collection('solution_reveal').doc(code).onSnapshot(function(snap){
        revealState = snap.exists ? snap.data() : null;
        render();
      }, function(err){
        console.warn('[solução] falha ao ler o estado de revelação:', err && err.code, err && err.message);
      });
    }

    function activate(code){
      roomCode = code;
      statusEl.textContent = 'Sincronizado — sala ' + code;
      statusEl.classList.add('on');
      statusEl.classList.remove('revealed');
      listenRoom(code);
      listenReveal(code);
    }

    function deactivate(){
      roomCode = null; room = null; revealState = null;
      if(unsubRoomRead){ unsubRoomRead(); unsubRoomRead=null; }
      if(unsubReveal){ unsubReveal(); unsubReveal=null; }
      statusEl.textContent = 'Sem sala ativa';
      statusEl.classList.remove('on','revealed');
      contentEl.innerHTML = '<div class="sol-empty">Entre em uma sala para ver este painel.</div>';
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
