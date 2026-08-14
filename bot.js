/* ===== Detetives IA — Caso Arquivado =====
   Arquivo isolado, independente do main.js. Segue exatamente o mesmo padrão
   estrutural do solucao.js: o próprio elemento alvo (#bot-painel) é o
   painel arrastável — sem div interna extra — pra não haver descompasso
   entre o que o CSS posiciona e o que o JS arrasta.

   Só lê/escreve nas coleções que o jogo já usa (rooms, hands, notifications).
   Nenhuma coleção nova é criada.

   IMPORTANTE: as listas BOT_SUSPEITOS / BOT_ARMAS / BOT_LOCAIS precisam
   ser EXATAMENTE iguais às listas SUSPEITOS/ARMAS/LOCAIS do main.js.

   Uso, depois de incluir Firebase + firebase-config.js + main.js:
   <div id="bot-painel"></div>
   <script src="bot.js"></script>
   <script>mountBot('#bot-painel');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';
  var PANEL_POS_KEY = 'casoArquivado_bot_pos_v1';
  var PANEL_COLLAPSED_KEY = 'casoArquivado_bot_collapsed_v1';

  var MAX_PLAYERS = 6; // limitado pelo número de peões/suspeitos do jogo

  // ---- precisa bater com main.js ----
  var BOT_SUSPEITOS = [
    "Prof. Black", "Srta. Rosa", "Cel. Mostarda",
    "Dona Branca", "Sr. Marinho", "Dona Violeta"
  ];
  var BOT_ARMAS = [
    "Revólver", "Cano", "Chave Inglesa",
    "Faca", "Candelabro", "Corda"
  ];
  var BOT_LOCAIS = [
    "Hall", "Sala de Estar", "Salão de Festas", "Cozinha",
    "Biblioteca", "Sala de Jantar", "Escritório",
    "Sala de Música", "Salão de Jogos"
  ];

  var BOT_NOMES = [
    "Auguste D.", "Miss Marple", "Sherlock H.", "Columbo",
    "Kate Beckett", "Hercule P.", "Nero Wolfe", "Kinsey M."
  ];

  // ---- Groq (IA da sugestão) ----
  // Uso pessoal: chave direto no código, sem proxy. Gere a sua em
  // https://console.groq.com/keys
  var GROQ_API_KEY = 'COLOQUE_SUA_CHAVE_AQUI';
  var GROQ_MODEL = 'llama-3.3-70b-versatile';
  var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  // Pede pra Groq escolher a sugestão mais estratégica, olhando o que
  // ainda não foi eliminado e o histórico recente da sala. Se a chave
  // não estiver configurada, der erro, ou vier algo inválido, cai pra
  // uma escolha aleatória (mesmo comportamento de antes) — o jogo nunca
  // trava por causa da IA.
  function escolherSugestaoComIA(ctx, cb){
    if(!GROQ_API_KEY || GROQ_API_KEY === 'COLOQUE_SUA_CHAVE_AQUI'){
      cb(escolhaAleatoria(ctx));
      return;
    }

    var logRecente = ctx.logRecente || '(sem histórico ainda)';

    var prompt =
      'Você está jogando um jogo de dedução estilo Detetive/Clue. É sua vez de sugerir.\n'+
      'Escolha exatamente UM suspeito, UMA arma e UM cômodo, cada um das listas abaixo '+
      '(essas são as opções que você AINDA NÃO conseguiu eliminar — não escolha nada fora delas):\n\n'+
      'Suspeitos possíveis: '+ctx.faltamSuspeitos.join(', ')+'\n'+
      'Armas possíveis: '+ctx.faltamArmas.join(', ')+'\n'+
      'Cômodos possíveis: '+ctx.faltamLocais.join(', ')+'\n\n'+
      'Histórico recente da partida (para te ajudar a raciocinar sobre o que os outros já sugeriram):\n'+
      logRecente+'\n\n'+
      'Responda APENAS com um JSON no formato exato, sem nenhum texto antes ou depois:\n'+
      '{"suspeito":"...","arma":"...","local":"..."}';

    fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'Você responde APENAS com JSON válido, sem markdown, sem explicação.' },
          { role: 'user', content: prompt }
        ]
      })
    }).then(function(r){ return r.json(); })
      .then(function(data){
        var texto = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        var limpo = (texto||'').replace(/```json|```/g,'').trim();
        var escolha = JSON.parse(limpo);

        var valido =
          ctx.faltamSuspeitos.indexOf(escolha.suspeito) >= 0 &&
          ctx.faltamArmas.indexOf(escolha.arma) >= 0 &&
          ctx.faltamLocais.indexOf(escolha.local) >= 0;

        cb(valido ? escolha : escolhaAleatoria(ctx));
      })
      .catch(function(err){
        console.warn('[bot] Groq falhou, usando escolha aleatória:', err && err.message);
        cb(escolhaAleatoria(ctx));
      });
  }

  function escolhaAleatoria(ctx){
    return {
      suspeito: pickRandom(ctx.faltamSuspeitos),
      arma: pickRandom(ctx.faltamArmas),
      local: pickRandom(ctx.faltamLocais)
    };
  }

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
  function roomsCol(){ return db.collection('rooms'); }
  function handsCol(){ return db.collection('hands'); }
  function notifCol(){ return db.collection('notifications'); }
  function handKey(code, pid){ return code + '_' + pid; }
  function randId(){ return 'bot-' + Math.random().toString(36).slice(2,9); }
  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function shuffle(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t=a[i]; a[i]=a[j]; a[j]=t;
    }
    return a;
  }

  window.mountBot = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="bot-handle">'+
        '<h3>Detetives IA</h3>'+
        '<button type="button" class="bot-toggle">_</button>'+
      '</div>'+
      '<div class="bot-body">'+
        '<div class="bot-status">Sem sala ativa</div>'+
        '<div class="bot-content"></div>'+
      '</div>';

    var handle    = host.querySelector('.bot-handle');
    var toggleBtn = host.querySelector('.bot-toggle');
    var statusEl  = host.querySelector('.bot-status');
    var contentEl = host.querySelector('.bot-content');

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

    var roomCode = null;
    var room = null;
    var unsubRoom = null;
    var lastLogLen = -1;
    var handledSuggestion = {};
    var lastTurnKey = null;
    var acting = false;

    function isHost(){
      var s = getSession();
      return !!(s && room && s.pid === room.hostId);
    }

    function render(){
      if(!room){
        statusEl.textContent = 'Sem sala ativa';
        statusEl.classList.remove('on');
        contentEl.innerHTML = '<div class="bot-empty">Entre em uma sala para ver este painel.</div>';
        return;
      }
      if(!isHost()){
        statusEl.textContent = 'Sincronizado — sala ' + roomCode;
        statusEl.classList.add('on');
        contentEl.innerHTML = '<div class="bot-empty">Só o anfitrião controla os detetives IA.</div>';
        return;
      }

      statusEl.textContent = 'Sincronizado — sala ' + roomCode;
      statusEl.classList.add('on');

      var bots = (room.players||[]).filter(function(p){ return p.isBot; });
      var total = (room.players||[]).length;
      var html = '';

      if(room.phase === 'lobby'){
        html += '<div class="bot-list">' +
          (bots.length ? bots.map(function(b){
            return '<div class="bot-row"><span>🤖 '+escHtml(b.name)+'</span>' +
              '<button type="button" class="bot-remove" data-id="'+escHtml(b.id)+'">remover</button></div>';
          }).join('') : '<div class="bot-empty">Nenhum detetive IA na sala.</div>') +
        '</div>';

        if(total < MAX_PLAYERS){
          html += '<button type="button" class="bot-add">+ Adicionar Detetive IA</button>';
        } else {
          html += '<div class="bot-hint">Sala cheia ('+MAX_PLAYERS+' detetives no máximo).</div>';
        }
      } else if(room.phase === 'playing'){
        html += '<div class="bot-list">' +
          (bots.length ? bots.map(function(b){
            return '<div class="bot-row"><span>🤖 '+escHtml(b.name)+(b.eliminated?' (eliminado)':'')+'</span></div>';
          }).join('') : '<div class="bot-empty">Nenhum detetive IA nesta partida.</div>') +
        '</div>' +
        '<div class="bot-hint">Os detetives IA jogam sozinhos enquanto esta aba estiver aberta.</div>';
      } else {
        html += '<div class="bot-empty">Disponível na sala de espera.</div>';
      }

      contentEl.innerHTML = html;

      var addBtn = contentEl.querySelector('.bot-add');
      if(addBtn) addBtn.addEventListener('click', addBot);

      var removeBtns = contentEl.querySelectorAll('.bot-remove');
      removeBtns.forEach(function(btn){
        btn.addEventListener('click', function(){ removeBot(btn.getAttribute('data-id')); });
      });
    }

    function addBot(){
      if(!roomCode || !room || room.phase!=='lobby') return;
      var used = (room.players||[]).map(function(p){ return p.name; });
      var pool = shuffle(BOT_NOMES).filter(function(n){ return used.indexOf(n+' (IA)') < 0; });
      var name = (pool[0] || ('Detetive '+Math.floor(Math.random()*90+10))) + ' (IA)';
      var novoBot = { id: randId(), name: name, eliminated: false, isBot: true };

      roomsCol().doc(roomCode).update({
        players: fv().arrayUnion(novoBot)
      }).catch(function(err){
        console.warn('[bot] falha ao adicionar bot:', err && err.code, err && err.message);
      });
    }

    function removeBot(botId){
      if(!roomCode || !room || room.phase!=='lobby') return;
      var novosPlayers = (room.players||[]).filter(function(p){ return p.id !== botId; });
      roomsCol().doc(roomCode).update({ players: novosPlayers }).catch(function(err){
        console.warn('[bot] falha ao remover bot:', err && err.code, err && err.message);
      });
    }

    function loadBotMemory(botId, cb){
      Promise.all([
        handsCol().doc(handKey(roomCode, botId)).get(),
        notifCol().doc(handKey(roomCode, botId)).get()
      ]).then(function(results){
        var handSnap = results[0], notifSnap = results[1];
        var hand = handSnap.exists ? (handSnap.data().cards || []) : [];
        var items = notifSnap.exists ? (notifSnap.data().items || []) : [];
        var vistas = items.map(function(it){ return it.card; });
        var conhecidoNao = {};
        hand.concat(vistas).forEach(function(c){ conhecidoNao[c] = true; });
        cb({ hand: hand, conhecidoNao: conhecidoNao });
      }).catch(function(err){
        console.warn('[bot] falha ao carregar memória:', err && err.code, err && err.message);
        cb({ hand: [], conhecidoNao: {} });
      });
    }

    function activePlayerAt(room){
      var activeOrder = (room.turnOrder||[]).filter(function(id){
        var p = (room.players||[]).filter(function(pp){ return pp.id===id; })[0];
        return p && !p.eliminated;
      });
      if(!activeOrder.length) return null;
      var idx = room.turnIndex % activeOrder.length;
      return activeOrder[idx];
    }

    function playerById(id){
      return (room.players||[]).filter(function(p){ return p.id===id; })[0] || null;
    }

    function takeBotTurn(botId){
      var p = playerById(botId);
      if(!p) return;

      loadBotMemory(botId, function(mem){
        var faltamSuspeitos = BOT_SUSPEITOS.filter(function(c){ return !mem.conhecidoNao[c]; });
        var faltamArmas     = BOT_ARMAS.filter(function(c){ return !mem.conhecidoNao[c]; });
        var faltamLocais    = BOT_LOCAIS.filter(function(c){ return !mem.conhecidoNao[c]; });

        var resolvido = faltamSuspeitos.length===1 && faltamArmas.length===1 && faltamLocais.length===1;

        if(resolvido){
          fazerAcusacao(p, faltamSuspeitos[0], faltamArmas[0], faltamLocais[0]);
          return;
        }

        var logRecente = (room.log||[]).slice(-15).map(function(e){ return e.text; }).join('\n');

        escolherSugestaoComIA({
          faltamSuspeitos: faltamSuspeitos,
          faltamArmas: faltamArmas,
          faltamLocais: faltamLocais,
          logRecente: logRecente
        }, function(pick){
          fazerSugestao(p, pick);
        });
      });
    }

    function fazerSugestao(p, pick){
      roomsCol().doc(roomCode).update({
        log: fv().arrayUnion({
          text: p.name+' sugeriu: '+pick.suspeito+' + '+pick.arma+' + '+pick.local+'. Aguardando alguém mostrar uma carta.',
          type: 'normal', ts: nowTs()
        })
      }).then(function(){
        try{ if(window.boardMoveToRoom) window.boardMoveToRoom(pick.suspeito, pick.arma, pick.local); }catch(e){}
        setTimeout(function(){ passarVez(p); }, 6000 + Math.random()*2000);
      }).catch(function(err){
        console.warn('[bot] falha ao sugerir:', err && err.code, err && err.message);
      });
    }

    function passarVez(p){
      roomsCol().doc(roomCode).update({
        turnIndex: fv().increment(1),
        log: fv().arrayUnion({text: p.name+' passou a vez.', type:'normal', ts: nowTs()})
      }).catch(function(err){
        console.warn('[bot] falha ao passar a vez:', err && err.code, err && err.message);
      });
    }

    function fazerAcusacao(p, suspeito, arma, local){
      var secret = room.secret;
      var correto = suspeito===secret.suspeito && arma===secret.arma && local===secret.local;

      try{ if(window.boardMoveToRoom) window.boardMoveToRoom(suspeito, arma, local); }catch(e){}

      if(correto){
        roomsCol().doc(roomCode).update({
          phase: 'ended',
          winner: p.id,
          log: fv().arrayUnion({text:'🏆 '+p.name+' resolveu o caso! A resposta era: '+secret.suspeito+' + '+secret.arma+' + '+secret.local+'.', type:'win', ts:nowTs()})
        }).catch(function(err){
          console.warn('[bot] falha ao registrar vitória:', err && err.code, err && err.message);
        });
      } else {
        db.runTransaction(function(tx){
          var ref = roomsCol().doc(roomCode);
          return tx.get(ref).then(function(snap){
            var data = snap.data();
            var players = (data.players||[]).map(function(pp){
              if(pp.id===p.id){ pp.eliminated = true; }
              return pp;
            });
            tx.update(ref, {
              players: players,
              log: fv().arrayUnion({text: p.name+' fez uma acusação final e errou. Está fora da disputa, mas continua revelando cartas.', type:'normal', ts:nowTs()})
            });
          });
        }).catch(function(err){
          console.warn('[bot] falha ao registrar acusação errada:', err && err.code, err && err.message);
        });
      }
    }

    var SUGESTAO_RE = /^(.+?) sugeriu: (.+?) \+ (.+?) \+ (.+?)\. Aguardando alguém mostrar uma carta\.$/;

    function checkNovasSugestoes(){
      var log = room.log || [];
      if(lastLogLen < 0){ lastLogLen = log.length; return; }
      if(log.length <= lastLogLen){ lastLogLen = log.length; return; }

      var novos = log.slice(lastLogLen);
      lastLogLen = log.length;

      novos.forEach(function(entry){
        var m = SUGESTAO_RE.exec(entry.text || '');
        if(!m) return;
        var suggestionKey = entry.ts + '|' + entry.text;
        if(handledSuggestion[suggestionKey]) return;
        handledSuggestion[suggestionKey] = true;

        var suggesterName = m[1];
        var trio = [m[2], m[3], m[4]];
        var suggester = (room.players||[]).filter(function(p){ return p.name===suggesterName; })[0];
        if(!suggester) return;

        responderSugestao(suggester, trio);
      });
    }

    function responderSugestao(suggester, trio){
      var order = room.turnOrder || (room.players||[]).map(function(p){ return p.id; });
      var startIdx = order.indexOf(suggester.id);
      if(startIdx < 0) startIdx = 0;

      var ordemResposta = [];
      for(var i=1;i<=order.length;i++){
        ordemResposta.push(order[(startIdx+i) % order.length]);
      }

      var botsNaOrdem = ordemResposta
        .map(function(id){ return playerById(id); })
        .filter(function(p){ return p && p.isBot && !p.eliminated && p.id !== suggester.id; });

      (function tentarProximo(i){
        if(i >= botsNaOrdem.length) return;
        var bot = botsNaOrdem[i];
        loadBotMemory(bot.id, function(mem){
          var match = trio.filter(function(c){ return mem.hand.indexOf(c) >= 0; });
          if(match.length){
            var carta = pickRandom(match);
            setTimeout(function(){
              notifCol().doc(handKey(roomCode, suggester.id)).set({
                items: fv().arrayUnion({from: bot.name, card: carta, ts: nowTs()})
              }, {merge:true}).then(function(){
                return roomsCol().doc(roomCode).update({
                  log: fv().arrayUnion({text: bot.name+' mostrou uma carta para '+suggester.name+'.', type:'normal', ts: nowTs()})
                });
              }).catch(function(err){
                console.warn('[bot] falha ao mostrar carta:', err && err.code, err && err.message);
              });
            }, 1500 + Math.random()*2500);
          } else {
            tentarProximo(i+1);
          }
        });
      })(0);
    }

    function tick(){
      if(!room || !isHost() || room.phase !== 'playing') return;

      checkNovasSugestoes();

      var activeId = activePlayerAt(room);
      if(!activeId) return;
      var p = playerById(activeId);
      if(!p || !p.isBot) return;

      var turnKey = room.turnIndex + '|' + activeId;
      if(turnKey === lastTurnKey) return;
      lastTurnKey = turnKey;

      if(acting) return;
      acting = true;
      setTimeout(function(){
        takeBotTurn(activeId);
        acting = false;
      }, 1800 + Math.random()*1800);
    }

    function listenRoom(code){
      if(unsubRoom){ unsubRoom(); unsubRoom = null; }
      roomCode = code;
      lastLogLen = -1;
      lastTurnKey = null;
      handledSuggestion = {};
      if(!code || typeof db === 'undefined'){ room = null; render(); return; }
      unsubRoom = roomsCol().doc(code).onSnapshot(function(snap){
        room = snap.exists ? snap.data() : null;
        render();
        tick();
      }, function(err){
        console.warn('[bot] falha ao ler a sala:', err && err.code, err && err.message);
      });
    }

    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      if(code !== roomCode) listenRoom(code);
    }

    render();
    checkSession();
    setInterval(checkSession, 1000);
  };
})();