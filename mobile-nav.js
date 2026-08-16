/* ===== Navegação mobile — Caso Arquivado =====
   Arquivo isolado, independente do main.js. Só entra em ação em telas
   pequenas (o CSS de mobile-nav.css já cuida de esconder tudo isso no
   desktop). Não substitui nenhum painel — só controla QUANDO cada um
   aparece em tela cheia, tocando a classe "mobile-open" neles.

   Detecta se o jogador é o anfitrião (pra mostrar ou não a aba
   "Anfitrião") do mesmo jeito que os outros módulos: lendo a sessão
   salva no localStorage e comparando com o hostId da sala no Firestore.

   Uso, depois de incluir Firebase + firebase-config.js + main.js:
   <div id="mobile-tabbar"></div>
   <script src="mobile-nav.js"></script>
   <script>mountMobileNav('#mobile-tabbar');</script>
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

  window.mountMobileNav = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.className = 'mobile-tabbar';
    host.innerHTML = TABS.map(function(t){
      return '<button type="button" class="mobile-tab" data-tab="'+t.id+'"'+(t.hostOnly?' hidden':'')+'>'+
        '<span class="mobile-tab-icon">'+t.icon+'</span><span>'+t.label+'</span>'+
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
        if(el) el.classList.remove('mobile-open');
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
      // garante que o painel não esteja "minimizado" (colapsado) ao abrir
      el.classList.remove('collapsed');
      el.classList.add('mobile-open');
      if(buttons[id]) buttons[id].classList.add('active');
      openId = id;
    }

    TABS.forEach(function(t){
      if(buttons[t.id]){
        buttons[t.id].addEventListener('click', function(){ openTab(t.id); });
      }
    });

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
        console.warn('[nav mobile] falha ao ler a sala:', err && err.code, err && err.message);
      });
    }

    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      if(code !== roomCode) listenRoom(code);
    }

    checkSession();
    setInterval(checkSession, 1500);

    // se a tela deixar de ser "mobile" (ex: girou pra paisagem numa tablet
    // grande, ou é um resize de janela), garante que nada fique preso
    // em modo tela-cheia escondendo a barra de rolagem do jogo por engano
    window.addEventListener('resize', function(){
      if(window.matchMedia('(min-width: 641px)').matches){
        closeAll();
      }
    });
  };
})();
