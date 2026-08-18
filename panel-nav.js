/* ===== Navegação por abas — Caso Arquivado =====
   Arquivo isolado, independente do main.js. Controla QUANDO cada painel
   (dado, tabuleiro, solução, voz, bots, admin) aparece — sempre um por
   vez, em tela cheia — tocando a classe "panel-open" neles. Não mexe em
   nenhuma lógica interna dos painéis.

   Cada painel chama window.closePanelNav() no próprio botão de
   minimizar, pra "recolher" de volta pra barra de abas em vez de só
   esconder o conteúdo.

   Uso, depois de incluir Firebase + firebase-config.js + main.js:
   <div id="panel-tabbar"></div>
   <script src="panel-nav.js"></script>
   <script>mountPanelNav('#panel-tabbar');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';

  var TABS = [
    { id:'acoes',     label:'Ações',      icon:'🎯', sel:'#acoes-painel' },
    { id:'cartas',    label:'Cartas',     icon:'🃏', sel:'#cartas-painel' },
    { id:'notas',     label:'Anotações',  icon:'📝', sel:'#notas-painel' },
    { id:'ia',        label:'Assistente', icon:'🧠', sel:'#assistente-painel' },
    { id:'dado',      label:'Dado',       icon:'🎲', sel:'#dado' },
    { id:'tabuleiro', label:'Tabuleiro',  icon:'🗺️', sel:'#tabuleiro-painel' },
    { id:'solucao',   label:'Solução',    icon:'🔍', sel:'#solucao-painel' },
    { id:'voz',       label:'Voz',        icon:'🎤', sel:'#voz-painel' },
    { id:'bots',      label:'Bots',       icon:'🤖', sel:'#bot-painel', hostOnly:true },
    { id:'admin',     label:'Anfitrião',  icon:'👑', sel:'#admin-painel', hostOnly:true }
  ];

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }

  window.mountPanelNav = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.className = 'panel-tabbar';
    host.innerHTML = TABS.map(function(t){
      return '<button type="button" class="panel-tab" data-tab="'+t.id+'"'+(t.hostOnly?' hidden':'')+'>'+
        '<span class="panel-tab-icon">'+t.icon+'</span><span>'+t.label+'</span>'+
      '</button>';
    }).join('');

    var buttons = {};
    TABS.forEach(function(t){
      buttons[t.id] = host.querySelector('[data-tab="'+t.id+'"]');
    });

    var openId = null;

    function closeAll(){
      TABS.forEach(function(t){
        var el = document.querySelector(t.sel);
        if(el) el.classList.remove('panel-open');
        if(buttons[t.id]) buttons[t.id].classList.remove('active');
      });
      openId = null;
    }

    function openTab(id){
      var tab = TABS.filter(function(t){ return t.id===id; })[0];
      if(!tab) return;
      var el = document.querySelector(tab.sel);
      if(!el) return;

      if(openId === id){
        closeAll(); // tocar na aba já aberta fecha e volta pro jogo
        return;
      }
      closeAll();
      el.classList.add('panel-open');
      if(buttons[id]){
        buttons[id].classList.add('active');
        buttons[id].classList.remove('needs-action');
      }
      openId = id;
    }

    TABS.forEach(function(t){
      if(buttons[t.id]){
        buttons[t.id].addEventListener('click', function(){ openTab(t.id); });
      }
    });

    // cada painel chama isso no próprio botão de minimizar, pra fechar
    // e voltar pra barra de abas em vez de só esconder o conteúdo
    window.closePanelNav = closeAll;

    // ---------- mostra/esconde a aba "Anfitrião" + pulsa a aba certa ----------
    var roomCode = null, unsubRoom = null;

    function activePlayerId(room){
      var order = (room.turnOrder||[]).filter(function(id){
        var p = (room.players||[]).filter(function(pp){ return pp.id===id; })[0];
        return p && !p.eliminated;
      });
      if(!order.length) return null;
      return order[room.turnIndex % order.length];
    }

    function atualizarPulso(d, s){
      if(buttons.dado) buttons.dado.classList.remove('needs-action');
      if(buttons.tabuleiro) buttons.tabuleiro.classList.remove('needs-action');
      if(buttons.acoes) buttons.acoes.classList.remove('needs-action');
      if(!d || d.phase!=='playing' || !s || !s.pid) return;
      if(activePlayerId(d) !== s.pid) return; // não é a minha vez, nada pulsa

      var jaRolou = d.lastRollTurnIndex === d.turnIndex;
      if(!jaRolou){
        if(buttons.dado) buttons.dado.classList.add('needs-action');
        return;
      }
      var mb = d.moveBudget;
      var meusPassos = (mb && mb.turnIndex===d.turnIndex && mb.playerId===s.pid) ? mb.stepsLeft : 0;
      if(meusPassos > 0 && buttons.tabuleiro){
        buttons.tabuleiro.classList.add('needs-action');
        return;
      }
      // já rolou e já terminou de andar: hora de sugerir, acusar ou passar a vez
      if(buttons.acoes) buttons.acoes.classList.add('needs-action');
    }

    function aplicarVisibilidadeHost(souHost){
      TABS.forEach(function(t){
        if(t.hostOnly && buttons[t.id]) buttons[t.id].hidden = !souHost;
      });
    }

    function listenRoom(code){
      if(unsubRoom){ unsubRoom(); unsubRoom=null; }
      roomCode = code;
      if(!code || typeof db === 'undefined'){
        aplicarVisibilidadeHost(false);
        return;
      }
      unsubRoom = db.collection('rooms').doc(code).onSnapshot(function(snap){
        var d = snap.exists ? snap.data() : null;
        var s = getSession();
        var souHost = !!(d && s && s.pid && d.hostId===s.pid);
        aplicarVisibilidadeHost(souHost);
        atualizarPulso(d, s);
      }, function(err){
        console.warn('[abas] falha ao ler a sala:', err && err.code, err && err.message);
      });
    }

    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      if(code !== roomCode) listenRoom(code);
    }

    checkSession();
    setInterval(checkSession, 1500);
  };
})();
