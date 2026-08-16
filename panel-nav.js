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
    { id:'dado',      label:'Dado',       icon:'🎲', sel:'#dado' },
    { id:'tabuleiro', label:'Tabuleiro',  icon:'🗺️', sel:'#tabuleiro-painel' },
    { id:'solucao',   label:'Solução',    icon:'🔍', sel:'#solucao-painel' },
    { id:'voz',       label:'Voz',        icon:'🎤', sel:'#voz-painel' },
    { id:'bots',      label:'Bots',       icon:'🤖', sel:'#bot-painel' },
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
      if(buttons[id]) buttons[id].classList.add('active');
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

    // ---------- mostra/esconde a aba "Anfitrião" conforme a sessão ----------
    var roomCode = null, unsubRoom = null;

    function listenRoom(code){
      if(unsubRoom){ unsubRoom(); unsubRoom=null; }
      roomCode = code;
      if(!code || typeof db === 'undefined'){
        if(buttons.admin) buttons.admin.hidden = true;
        return;
      }
      unsubRoom = db.collection('rooms').doc(code).onSnapshot(function(snap){
        var d = snap.exists ? snap.data() : null;
        var s = getSession();
        var souHost = !!(d && s && s.pid && d.hostId===s.pid);
        if(buttons.admin) buttons.admin.hidden = !souHost;
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
