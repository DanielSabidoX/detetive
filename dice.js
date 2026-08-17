/* ===== Dado Virtual v3 - sincronizado entre jogadores =====
   Grava a rolagem DENTRO do documento da sala (rooms/{code}), reaproveitando
   as regras do Firestore que o jogo ja usa. Assim nao e preciso liberar
   nenhuma colecao nova. Independente do main.js. */
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';

  var PIPS = {
    1:['p-mc'],
    2:['p-tl','p-br'],
    3:['p-tl','p-mc','p-br'],
    4:['p-tl','p-tr','p-bl','p-br'],
    5:['p-tl','p-tr','p-mc','p-bl','p-br'],
    6:['p-tl','p-tr','p-ml','p-mr','p-bl','p-br']
  };
  var FINAL = {
    1:{x:0,y:0}, 2:{x:0,y:180}, 3:{x:0,y:-90},
    4:{x:0,y:90}, 5:{x:-90,y:0}, 6:{x:90,y:0}
  };

  function faceHTML(n, cls){
    var html = '<div class="dice-face '+cls+'">';
    PIPS[n].forEach(function(p){ html += '<span class="pip '+p+'"></span>'; });
    return html + '</div>';
  }

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }

  window.mountDice = function(target){
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if(!el) return;

    el.innerHTML =
      '<div class="panel-handle">'+
        '<h3>Dado</h3>'+
        '<button type="button" class="panel-toggle">_</button>'+
      '</div>'+
      '<div class="panel-body">'+
        '<p class="dice-hint">Clique no dado para rolar</p>' +
        '<div class="dice-stage"><div class="dice">' +
          faceHTML(1,'f1')+faceHTML(2,'f2')+faceHTML(3,'f3')+
          faceHTML(4,'f4')+faceHTML(5,'f5')+faceHTML(6,'f6') +
        '</div></div>' +
        '<div class="dice-result">Aguardando...</div>' +
        '<div class="dice-by"></div>' +
        '<button type="button" class="dice-btn">Rolar dado</button>' +
        '<div><span class="dice-sync">Dado local</span></div>'+
      '</div>';

    var handle    = el.querySelector('.panel-handle');
    var toggleBtn = el.querySelector('.panel-toggle');
    var stage  = el.querySelector('.dice-stage');
    var hintEl = el.querySelector('.dice-hint');
    var dice   = el.querySelector('.dice');
    var result = el.querySelector('.dice-result');
    var byEl   = el.querySelector('.dice-by');
    var btn    = el.querySelector('.dice-btn');
    var syncEl = el.querySelector('.dice-sync');

    // ---------- botão "_" fecha o painel e volta pra barra de abas ----------
    toggleBtn.addEventListener('click', function(evt){
      evt.stopPropagation();
      if(typeof window.closePanelNav === 'function') window.closePanelNav();
    });

    var rolling = false, spins = 0;
    var lastRollId = null;
    var roomCode = null, unsub = null;
    var locked = false;
    var roomData = null; // guarda a sala inteira, pra saber de quem é a vez

    function activePlayerId(){
      if(!roomData) return null;
      var order = (roomData.turnOrder||[]).filter(function(id){
        var p = (roomData.players||[]).filter(function(pp){ return pp.id===id; })[0];
        return p && !p.eliminated;
      });
      if(!order.length) return null;
      return order[roomData.turnIndex % order.length];
    }
    function isMyTurnDice(){
      var s = getSession();
      return !!(s && s.pid && roomData && roomData.phase==='playing' && activePlayerId()===s.pid);
    }
    // true assim que ALGUÉM rolou o dado neste turnIndex — mesmo antes do
    // moveBudget (que só chega depois da animação) ser gravado
    function jaRolouEsseTurno(){
      return !!(roomData && roomData.lastRollTurnIndex===roomData.turnIndex);
    }

    function applyLockUI(){
      if(locked){
        btn.disabled = true;
        stage.classList.add('dice-disabled');
        hintEl.textContent = 'O anfitrião desabilitou o dado no momento.';
      } else if(roomCode && !isMyTurnDice()){
        btn.disabled = true;
        stage.classList.add('dice-disabled');
        hintEl.textContent = 'Aguarde a sua vez para rolar o dado.';
      } else if(roomCode && jaRolouEsseTurno()){
        btn.disabled = true;
        stage.classList.add('dice-disabled');
        hintEl.textContent = 'Você já rolou o dado neste turno.';
      } else {
        if(!rolling) btn.disabled = false;
        stage.classList.remove('dice-disabled');
        hintEl.textContent = 'Clique no dado para rolar';
      }
    }

    function setFace(value){
      var f = FINAL[value] || FINAL[1];
      dice.style.transition = 'none';
      dice.style.transform = 'rotateX('+f.x+'deg) rotateY('+f.y+'deg)';
    }

    function animate(value, byName){
      if(rolling) return;
      rolling = true;
      btn.disabled = true;
      result.textContent = 'Rolando...';
      byEl.textContent = byName ? (byName + ' esta rolando...') : '';

      dice.style.transition = 'none';
      dice.classList.add('rolling');

      setTimeout(function(){
        dice.classList.remove('rolling');
        spins += 4;
        var f = FINAL[value] || FINAL[1];
        dice.style.transition = 'transform 1.4s cubic-bezier(0.15,0.85,0.25,1)';
        dice.style.transform =
          'rotateX(' + (f.x + spins*360) + 'deg) rotateY(' + (f.y + spins*360) + 'deg)';

        setTimeout(function(){
          result.innerHTML = 'Resultado <b>' + value + '</b>';
          byEl.textContent = byName ? ('rolado por ' + byName) : '';
          rolling = false;
          btn.disabled = locked;
          if(typeof window.onDiceRoll === 'function') window.onDiceRoll(value, byName);
        }, 500);
      }, 3000);
    }

    var ROLL_ANIM_MS = 3600; // precisa ser >= tempo total da animação (3000 + 500 + folga)

    function roll(){
      if(rolling || locked) return;
      var value = Math.floor(Math.random()*6)+1;
      var s = getSession();

      if(!roomCode || typeof firebase === 'undefined' || typeof db === 'undefined'){
        animate(value, null); // sem sala: dado puramente local
        return;
      }

      if(!isMyTurnDice()){
        hintEl.textContent = 'Aguarde a sua vez para rolar o dado.';
        return;
      }
      if(jaRolouEsseTurno()){
        hintEl.textContent = 'Você já rolou o dado neste turno.';
        return;
      }

      var turnoDaRolagem = roomData.turnIndex;

      var payload = {
        diceValue: value,
        diceRollId: Date.now() + '-' + Math.random().toString(36).slice(2,8),
        diceBy: (s && s.name) ? s.name : 'Alguem',
        diceAt: Date.now(),
        // trava "rolar de novo" JÁ, mesmo antes da animação acabar
        lastRollTurnIndex: turnoDaRolagem
      };

      // O snapshot dispara a animacao para todos, inclusive para quem rolou.
      db.collection('rooms').doc(roomCode).update(payload).then(function(){
        // só libera o movimento no tabuleiro depois que a animação termina
        // pra todo mundo — senão as casas "andáveis" apareceriam destacadas
        // antes do dado visualmente parar de rolar.
        setTimeout(function(){
          db.collection('rooms').doc(roomCode).update({
            moveBudget: { turnIndex: turnoDaRolagem, playerId: s.pid, stepsLeft: value }
          }).catch(function(err){
            console.warn('[dado] falha ao liberar movimento:', err && err.code, err && err.message);
          });
        }, ROLL_ANIM_MS);
      }).catch(function(err){
        console.warn('[dado] falha ao gravar a rolagem na sala:', err && err.code, err && err.message);
        syncEl.textContent = 'Sem permissao - dado local';
        syncEl.classList.remove('on');
        animate(value, null);
      });
    }

    function listen(code){
      if(unsub){ unsub(); unsub = null; }
      roomCode = code;
      lastRollId = null;
      if(!code || typeof db === 'undefined'){
        syncEl.textContent = 'Dado local';
        syncEl.classList.remove('on');
        locked = false;
        applyLockUI();
        return;
      }
      syncEl.textContent = 'Sincronizado - sala ' + code;
      syncEl.classList.add('on');

      var first = true;
      unsub = db.collection('rooms').doc(code).onSnapshot(function(snap){
        var d = snap.exists ? snap.data() : null;
        roomData = d;

        var nowLocked = !!(d && d.diceLocked);
        if(nowLocked !== locked){
          locked = nowLocked;
        }
        applyLockUI(); // reavalia sempre: turnIndex pode ter mudado sem mexer no diceLocked

        if(!d || !d.diceRollId){ first = false; return; }
        if(d.diceRollId === lastRollId) return;
        lastRollId = d.diceRollId;

        if(first){
          first = false;
          setFace(d.diceValue);
          result.innerHTML = 'Resultado <b>' + d.diceValue + '</b>';
          byEl.textContent = d.diceBy ? ('rolado por ' + d.diceBy) : '';
          return;
        }
        animate(d.diceValue, d.diceBy);
      }, function(err){
        console.warn('[dado] falha ao ouvir a sala:', err && err.code, err && err.message);
        syncEl.textContent = 'Dado local';
        syncEl.classList.remove('on');
      });
    }

    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      if(code !== roomCode) listen(code);
    }
    checkSession();
    setInterval(checkSession, 1000);

    stage.addEventListener('click', roll);
    btn.addEventListener('click', roll);
  };
})();
