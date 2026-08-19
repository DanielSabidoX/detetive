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

  // ---- Geometria do tabuleiro — precisa bater com board.js ----
  // (usada só pra calcular caminhos; nada disso desenha nada na tela)
  var ROOM_GRID = [
    ['Hall','Sala de Estar','Salão de Festas'],
    ['Biblioteca','Escritório','Sala de Jantar'],
    ['Salão de Jogos','Sala de Música','Cozinha']
  ];
  var BLOCK = 4, GAP = 2, BORDER = 1;
  var BOARD_SIZE = BORDER*2 + BLOCK*3 + GAP*2;
  var CENTER_OFFSET = Math.floor(BLOCK/2);
  // ordem EXATA do board.js — decide qual peão (slug) cada jogador controla
  // pela posição no array de jogadores. Diferente da ordem de BOT_SUSPEITOS
  // acima, que é só a ordem usada no mistério (main.js).
  var BOARD_SUSPECTS = ["Prof. Black","Cel. Mostarda","Sr. Marinho","Dona Branca","Srta. Rosa","Dona Violeta"];

  function slugifyBoard(s){
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }

  function roomStartRow(rIdx){ return BORDER + rIdx*(BLOCK+GAP) + 1; }
  function roomStartCol(cIdx){ return BORDER + cIdx*(BLOCK+GAP) + 1; }

  function buildRoomMeta(){
    var rooms = [], cellOwner = {}, doorOwner = {};
    for(var ri=0; ri<3; ri++){
      for(var ci=0; ci<3; ci++){
        var name = ROOM_GRID[ri][ci];
        var r0 = roomStartRow(ri), c0 = roomStartCol(ci);
        var idx = rooms.length;
        var doorSouth = { row: r0+BLOCK, col: c0+1 };
        var doorSide = (ci===2)
          ? { row: r0+BLOCK-1, col: c0-1 }
          : { row: r0, col: c0+BLOCK };
        rooms.push({ name:name, r0:r0, c0:c0, anchorRow:r0+CENTER_OFFSET, anchorCol:c0+CENTER_OFFSET, doors:[doorSouth, doorSide] });
        doorOwner[doorSouth.row+','+doorSouth.col] = { name:name };
        doorOwner[doorSide.row+','+doorSide.col] = { name:name };
        for(var dr=0; dr<BLOCK; dr++){
          for(var dc=0; dc<BLOCK; dc++){
            cellOwner[(r0+dr)+','+(c0+dc)] = idx;
          }
        }
      }
    }
    return { rooms:rooms, cellOwner:cellOwner, doorOwner:doorOwner };
  }
  var BOARD_META = buildRoomMeta();

  function boardRoomAt(r,c){
    var idx = BOARD_META.cellOwner[r+','+c];
    return idx===undefined ? null : BOARD_META.rooms[idx];
  }
  function boardDoorAt(r,c){
    return BOARD_META.doorOwner[r+','+c] || null;
  }
  function boardPodeEntrar(fromCell, toCell){
    var fromRoom = boardRoomAt(fromCell.row, fromCell.col);
    var toRoom = boardRoomAt(toCell.row, toCell.col);
    if(toRoom){
      if(fromRoom === toRoom) return true;
      var fromDoor = boardDoorAt(fromCell.row, fromCell.col);
      return !!(fromDoor && fromDoor.name === toRoom.name);
    }
    if(fromRoom){
      var toDoor = boardDoorAt(toCell.row, toCell.col);
      return !!(toDoor && toDoor.name === fromRoom.name);
    }
    return true;
  }
  function findBoardRoomByName(name){
    var s = slugifyBoard(name||'');
    for(var i=0;i<BOARD_META.rooms.length;i++){
      if(slugifyBoard(BOARD_META.rooms[i].name)===s) return BOARD_META.rooms[i];
    }
    return null;
  }

  // precisa bater com SECRET_PASSAGES do board.js
  var SECRET_PASSAGES = {
    'Hall': 'Cozinha',
    'Cozinha': 'Hall',
    'Salão de Jogos': 'Salão de Festas',
    'Salão de Festas': 'Salão de Jogos'
  };
  function passageFromBoard(roomName){
    return SECRET_PASSAGES[roomName] || null;
  }

  // ---- spawn padrão determinístico (precisa bater com board.js: mesmo
  // código de sala => mesma posição inicial, pra todo mundo ver igual) ----
  var CORRIDOR_CELLS = (function(){
    var list = [];
    for(var r=1; r<=BOARD_SIZE; r++){
      for(var c=1; c<=BOARD_SIZE; c++){
        if(!boardRoomAt(r,c)) list.push({row:r, col:c});
      }
    }
    return list;
  })();
  function seedFromStr(str){
    var h = 2166136261;
    for(var i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = (h*16777619)>>>0; }
    return h>>>0;
  }
  function nextRandSeed(seed){
    seed ^= seed<<13; seed>>>=0; seed ^= seed>>17; seed ^= seed<<5; seed>>>=0;
    return seed>>>0;
  }
  function defaultSpawnFor(code, slug){
    var used = {}, seed = seedFromStr(code||'_sem-sala');
    for(var i=0;i<BOARD_SUSPECTS.length;i++){
      var s = slugifyBoard(BOARD_SUSPECTS[i]);
      var cell = null;
      for(var tries=0; tries<200 && CORRIDOR_CELLS.length; tries++){
        seed = nextRandSeed(seed);
        var cand = CORRIDOR_CELLS[seed % CORRIDOR_CELLS.length];
        var k = cand.row+','+cand.col;
        if(!used[k]){ used[k]=true; cell=cand; break; }
      }
      if(!cell) cell = CORRIDOR_CELLS[0] || {row:BOARD_SIZE, col:BOARD_SIZE};
      if(s===slug) return cell;
    }
    return {row:BOARD_SIZE, col:BOARD_SIZE};
  }

  // BFS: caminho mais curto de "from" até uma célula-alvo, respeitando as
  // regras de parede/porta. Devolve a lista de células do caminho (sem
  // contar a célula inicial), ou null se não houver caminho.
  function shortestPath(from, to){
    var startKey = from.row+','+from.col, targetKey = to.row+','+to.col;
    if(startKey===targetKey) return [];
    var visited = {}; visited[startKey]=true;
    var queue = [{cell:from, path:[]}];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    while(queue.length){
      var cur = queue.shift();
      for(var i=0;i<dirs.length;i++){
        var nr = cur.cell.row+dirs[i][0], nc = cur.cell.col+dirs[i][1];
        if(nr<1||nr>BOARD_SIZE||nc<1||nc>BOARD_SIZE) continue;
        var key = nr+','+nc;
        if(visited[key]) continue;
        var nextCell = {row:nr, col:nc};
        if(!boardPodeEntrar(cur.cell, nextCell)) continue;
        var novoPath = cur.path.concat([nextCell]);
        if(key===targetKey) return novoPath;
        visited[key]=true;
        // não continuamos o BFS por dentro de uma sala (só a porta interessa como alvo)
        if(boardRoomAt(nr,nc) && key!==targetKey) continue;
        queue.push({cell:nextCell, path:novoPath});
      }
    }
    return null;
  }

  // ---- Groq (IA da sugestão) ----
  // Uso pessoal: chave direto no código, sem proxy. Gere a sua em
  // https://console.groq.com/keys
  var GROQ_API_KEY = '';
  var GROQ_MODEL = 'openai/gpt-oss-120b';
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
    var ultimasProprias = (historicoSugestoes[ctx.botId] || [])
      .map(function(t){ return t.suspeito+' + '+t.arma+' + '+t.local; })
      .join(' | ') || '(nenhuma ainda)';

    var prompt =
      'Você está jogando um jogo de dedução estilo Detetive/Clue. É sua vez de sugerir.\n'+
      'Escolha exatamente UM suspeito, UMA arma e UM cômodo, cada um das listas abaixo '+
      '(essas são as opções que você AINDA NÃO conseguiu eliminar — não escolha nada fora delas):\n\n'+
      'Suspeitos possíveis: '+ctx.faltamSuspeitos.join(', ')+'\n'+
      'Armas possíveis: '+ctx.faltamArmas.join(', ')+'\n'+
      'Cômodos possíveis: '+ctx.faltamLocais.join(', ')+'\n\n'+
      'Suas últimas sugestões (evite repetir a mesma combinação de novo):\n'+
      ultimasProprias+'\n\n'+
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

  // ---- variedade e blefe ----
  var CHANCE_DE_BLEFE = 0.25; // 25% das sugestões incluem uma carta que o bot já sabe ser falsa
  var HISTORICO_MAX = 3;
  var historicoSugestoes = {}; // botId -> array das últimas trios sugeridos por ele

  function cardCategoria(c){
    if(BOT_SUSPEITOS.indexOf(c)>=0) return 'suspeito';
    if(BOT_ARMAS.indexOf(c)>=0) return 'arma';
    if(BOT_LOCAIS.indexOf(c)>=0) return 'local';
    return null;
  }

  // se a sugestão for idêntica à última que esse bot mesmo fez, troca pelo
  // menos uma categoria por outra opção ainda válida, pra não repetir toda hora
  function evitarRepeticao(pick, botId, ctx){
    var historico = historicoSugestoes[botId] || [];
    var ultimo = historico[historico.length-1];
    if(!ultimo) return pick;
    if(ultimo.suspeito!==pick.suspeito || ultimo.arma!==pick.arma || ultimo.local!==pick.local){
      return pick; // já é diferente, não precisa mexer
    }

    var categorias = shuffle(['suspeito','arma','local']);
    for(var i=0;i<categorias.length;i++){
      var cat = categorias[i];
      var pool = cat==='suspeito' ? ctx.faltamSuspeitos : cat==='arma' ? ctx.faltamArmas : ctx.faltamLocais;
      var alternativas = pool.filter(function(c){ return c !== pick[cat]; });
      if(alternativas.length){
        var novo = {}; for(var k in pick) novo[k]=pick[k];
        novo[cat] = pickRandom(alternativas);
        return novo;
      }
    }
    return pick; // não há alternativa em nenhuma categoria (raro, categoria já resolvida em tudo)
  }

  // com uma certa chance, troca uma categoria por uma carta que o bot já
  // sabe NÃO ser a resposta (prioriza a própria mão) — blefe estratégico
  function talvezBlefar(pick, mem){
    if(Math.random() > CHANCE_DE_BLEFE) return pick;

    var conhecidasFalsas = mem.hand.slice();
    for(var c in mem.conhecidoNao){
      if(mem.hand.indexOf(c) < 0) conhecidasFalsas.push(c);
    }
    if(!conhecidasFalsas.length) return pick;

    var opcoes = shuffle(conhecidasFalsas);
    for(var i=0;i<opcoes.length;i++){
      var cat = cardCategoria(opcoes[i]);
      if(cat){
        var novo = {}; for(var k in pick) novo[k]=pick[k];
        novo[cat] = opcoes[i];
        return novo;
      }
    }
    return pick;
  }

  function registrarSugestao(botId, pick){
    if(!historicoSugestoes[botId]) historicoSugestoes[botId] = [];
    historicoSugestoes[botId].push(pick);
    if(historicoSugestoes[botId].length > HISTORICO_MAX){
      historicoSugestoes[botId].shift();
    }
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
      '<div class="panel-handle">'+
        '<h3>Detetives IA</h3>'+
        '<button type="button" class="panel-toggle">_</button>'+
      '</div>'+
      '<div class="panel-body">'+
        '<div class="panel-status">Sem sala ativa</div>'+
        '<div class="bot-content"></div>'+
      '</div>';

    var handle    = host.querySelector('.panel-handle');
    var toggleBtn = host.querySelector('.panel-toggle');
    var statusEl  = host.querySelector('.panel-status');
    var contentEl = host.querySelector('.bot-content');

    // ---------- botão "_" fecha o painel e volta pra barra de abas ----------
    toggleBtn.addEventListener('click', function(){
      if(typeof window.closePanelNav === 'function') window.closePanelNav();
    });

    var roomCode = null;
    var room = null;
    var unsubRoom = null;
    var lastLogLen = -1;
    var handledSuggestion = {};
    var lastTurnKey = null;
    var acting = false;

    // timers de espera por humano mostrar carta (Estratégia 3)
    var MOCHA_TIMER_MS = 60000;      // tempo para um humano mostrar carta
    var SUGGEST_TIMEOUT_MS = 66000;  // timeout pra bot passar a vez depois de sugerir
    var pendingSuggestion = null;    // { timer, suggesterId, trio } para sugestão ativa
    var watchingSuggestion = null;  // { timer, suggesterName, trio } pra quando alguém sugeriu

    function isHost(){
      var s = getSession();
      return !!(s && room && s.pid === room.hostId);
    }

    function render(){
      if(!room){
        statusEl.textContent = 'Sem sala ativa';
        statusEl.classList.remove('on');
        contentEl.innerHTML = '<div class="panel-empty">Entre em uma sala para ver este painel.</div>';
        return;
      }
      if(!isHost()){
        statusEl.textContent = 'Sincronizado — sala ' + roomCode;
        statusEl.classList.add('on');
        contentEl.innerHTML = '<div class="panel-empty">Só o anfitrião controla os detetives IA.</div>';
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
          }).join('') : '<div class="panel-empty">Nenhum detetive IA na sala.</div>') +
        '</div>';

        if(total < MAX_PLAYERS){
          html += '<button type="button" class="bot-add">+ Adicionar Detetive IA</button>';
        } else {
          html += '<div class="panel-hint">Sala cheia ('+MAX_PLAYERS+' detetives no máximo).</div>';
        }
      } else if(room.phase === 'playing'){
        html += '<div class="bot-list">' +
          (bots.length ? bots.map(function(b){
            return '<div class="bot-row"><span>🤖 '+escHtml(b.name)+(b.eliminated?' (eliminado)':'')+'</span></div>';
          }).join('') : '<div class="panel-empty">Nenhum detetive IA nesta partida.</div>') +
        '</div>' +
        '<div class="panel-hint">Os detetives IA jogam sozinhos enquanto esta aba estiver aberta.</div>';
      } else {
        html += '<div class="panel-empty">Disponível na sala de espera.</div>';
      }

      contentEl.innerHTML = html;

      var addBtn = contentEl.querySelector('.bot-add');
      if(addBtn) addBtn.addEventListener('click', addBot);

      var removeBtns = contentEl.querySelectorAll('.bot-remove');
      removeBtns.forEach(function(btn){
        btn.addEventListener('click', function(){ removeBot(btn.getAttribute('data-id')); });
      });
    }

    // sorteia um suspeito ainda não usado — mesma lógica do main.js, pra
    // ficar consistente com o que os jogadores humanos recebem
    function pickRandomSuspectForBot(existingPlayers){
      var usados = (existingPlayers||[]).map(function(p){ return p.suspect; }).filter(Boolean);
      var livres = BOT_SUSPEITOS.filter(function(s){ return usados.indexOf(s) < 0; });
      var pool = livres.length ? livres : BOT_SUSPEITOS;
      return pool[Math.floor(Math.random()*pool.length)];
    }

    function addBot(){
      if(!roomCode || !room || room.phase!=='lobby') return;
      var used = (room.players||[]).map(function(p){ return p.name; });
      var pool = shuffle(BOT_NOMES).filter(function(n){ return used.indexOf(n+' (IA)') < 0; });
      var name = (pool[0] || ('Detetive '+Math.floor(Math.random()*90+10))) + ' (IA)';
      var novoBot = { id: randId(), name: name, eliminated: false, isBot: true, suspect: pickRandomSuspectForBot(room.players) };

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

    function boardPosCol(){ return db.collection('board_positions'); }

    function loadBoardPositions(cb){
      boardPosCol().doc(roomCode).get().then(function(snap){
        var d = snap.exists ? snap.data() : {};
        cb((d && d.pawns) || {});
      }).catch(function(err){
        console.warn('[bot] falha ao ler posições do tabuleiro:', err && err.code, err && err.message);
        cb({});
      });
    }

    function saveBoardPawnPos(slug, row, col){
      var ref = boardPosCol().doc(roomCode);
      var value = { row: row, col: col, at: Date.now() };
      var dotField = {}; dotField['pawns.'+slug] = value;
      ref.update(dotField).catch(function(err){
        if(err && (err.code === 'not-found' || /No document to update/i.test(err.message||''))){
          var nested = { pawns: {} }; nested.pawns[slug] = value;
          ref.set(nested, {merge:true}).catch(function(err2){
            console.warn('[bot] falha ao criar posição do peão:', err2 && err2.code, err2 && err2.message);
          });
        } else {
          console.warn('[bot] falha ao salvar posição do peão:', err && err.code, err && err.message);
        }
      });
    }

    // qual peão (slug) do tabuleiro pertence a este jogador — lê o suspeito
    // GRAVADO nele (sorteado ao entrar), igual ao board.js já faz. Fallback
    // por posição só existe pra compatibilidade com salas antigas.
    function boardSlugForBot(botId){
      var idx = -1;
      for(var i=0;i<(room.players||[]).length;i++){
        if(room.players[i].id===botId){ idx=i; break; }
      }
      if(idx<0) return null;
      var nome = room.players[idx].suspect || BOARD_SUSPECTS[idx % BOARD_SUSPECTS.length];
      return slugifyBoard(nome);
    }

    function botRollDice(p, value){
      return roomsCol().doc(roomCode).update({
        diceValue: value,
        diceRollId: Date.now()+'-'+Math.random().toString(36).slice(2,8),
        diceBy: p.name,
        diceAt: Date.now(),
        moveBudget: { turnIndex: room.turnIndex, playerId: p.id, stepsLeft: value }
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

      var slug = boardSlugForBot(botId);
      var value = Math.floor(Math.random()*6)+1;

      // regra: todo jogador (inclusive IA) precisa rolar o dado no turno
      botRollDice(p, value).catch(function(err){
        console.warn('[bot] falha ao rolar dado:', err && err.code, err && err.message);
      });

      loadBotMemory(botId, function(mem){
        var faltamSuspeitos = BOT_SUSPEITOS.filter(function(c){ return !mem.conhecidoNao[c]; });
        var faltamArmas     = BOT_ARMAS.filter(function(c){ return !mem.conhecidoNao[c]; });
        var faltamLocais    = BOT_LOCAIS.filter(function(c){ return !mem.conhecidoNao[c]; });
        var resolvido = faltamSuspeitos.length===1 && faltamArmas.length===1 && faltamLocais.length===1;

        if(!slug){
          setTimeout(function(){ passarVez(p); }, 1500);
          return;
        }

        // sugere ou acusa usando a sala em que o bot está AGORA — nunca uma
        // sala livre, igual à regra que vale pros jogadores humanos
        function agirNaSala(roomName){
          if(resolvido && faltamLocais[0]===roomName){
            fazerAcusacao(p, faltamSuspeitos[0], faltamArmas[0], faltamLocais[0]);
            return;
          }
          if(resolvido){
            // certeza da solução, mas está na sala errada pra acusar — só passa
            setTimeout(function(){ passarVez(p); }, 1500);
            return;
          }
          var logRecente = (room.log||[]).slice(-15).map(function(e){ return e.text; }).join('\n');
          var ctx = { botId: botId, faltamSuspeitos: faltamSuspeitos, faltamArmas: faltamArmas, faltamLocais: [roomName], logRecente: logRecente };
          escolherSugestaoComIA(ctx, function(pick){
            pick.local = roomName;
            pick = evitarRepeticao(pick, botId, ctx); pick.local = roomName;
            pick = talvezBlefar(pick, mem);           pick.local = roomName;
            registrarSugestao(botId, pick);
            fazerSugestao(p, pick);
          });
        }

        loadBoardPositions(function(pawnsPos){
          var pos = pawnsPos[slug] || defaultSpawnFor(roomCode, slug);
          var currentRoom = boardRoomAt(pos.row, pos.col);

          if(currentRoom){
            // se a sala atual já não interessa mais (foi eliminada) mas a
            // sala do outro lado da passagem secreta ainda é útil, usa a
            // passagem em vez de sugerir aqui — só custa 1 passo
            var passagemPara = passageFromBoard(currentRoom.name);
            var salaAtualUtil = faltamLocais.indexOf(currentRoom.name) >= 0;
            if(!salaAtualUtil && passagemPara && faltamLocais.indexOf(passagemPara) >= 0 && value >= 1){
              var destRoom = findBoardRoomByName(passagemPara);
              if(destRoom){
                saveBoardPawnPos(slug, destRoom.anchorRow, destRoom.anchorCol);
                roomsCol().doc(roomCode).update({ 'moveBudget.stepsLeft': 0 }).catch(function(){});
                setTimeout(function(){ agirNaSala(destRoom.name); }, 1500);
                return;
              }
            }
            agirNaSala(currentRoom.name);
            return;
          }

          // não está em nenhuma sala: escolhe pra onde andar (prioriza salas
          // ainda não eliminadas; se já resolveu o caso, vai direto pra sala certa)
          var alvoNomes = resolvido ? [faltamLocais[0]] : shuffle(faltamLocais);
          var melhor = null;
          for(var i=0;i<alvoNomes.length;i++){
            var alvoRoom = findBoardRoomByName(alvoNomes[i]);
            if(!alvoRoom) continue;
            for(var d=0; d<alvoRoom.doors.length; d++){
              var path = shortestPath(pos, alvoRoom.doors[d]);
              if(path && (!melhor || path.length < melhor.path.length)){
                melhor = { room: alvoRoom, path: path };
              }
            }
          }

          if(!melhor){
            setTimeout(function(){ passarVez(p); }, 1500);
            return;
          }

          if(melhor.path.length <= value){
            // dá pra chegar até a porta e entrar na sala neste turno
            saveBoardPawnPos(slug, melhor.room.anchorRow, melhor.room.anchorCol);
            roomsCol().doc(roomCode).update({ 'moveBudget.stepsLeft': 0 }).catch(function(){});
            setTimeout(function(){ agirNaSala(melhor.room.name); }, 1500);
          } else {
            // anda o quanto dá em direção à porta, mas não chega neste turno
            var passos = melhor.path.slice(0, value);
            var fim = passos[passos.length-1];
            saveBoardPawnPos(slug, fim.row, fim.col);
            roomsCol().doc(roomCode).update({ 'moveBudget.stepsLeft': 0 }).catch(function(){});
            setTimeout(function(){ passarVez(p); }, 1500);
          }
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

        // Estratégia 3: não passa a vez imediatamente.
        // Monitora o log por um "mostrou uma carta" pelos próximos JOGADORES.
        // Se ninguém mostrar carta em SUGGEST_TIMEOUT_MS, passa a vez.
        pendingSuggestion = {
          timer: setTimeout(function(){
            pendingSuggestion = null;
            passarVez(p);
          }, SUGGEST_TIMEOUT_MS),
          suggesterId: p.id,
          trio: [pick.suspeito, pick.arma, pick.local]
        };
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
    var MOSTROU_RE = /mostrou uma? carta/;  // detecta "mostrou uma carta" ou "mostrou uma carta"

    function limparTimersDeEspera(){
      if(pendingSuggestion){
        clearTimeout(pendingSuggestion.timer);
        pendingSuggestion = null;
      }
      if(watchingSuggestion){
        clearTimeout(watchingSuggestion.timer);
        watchingSuggestion = null;
      }
    }

    function checkNovasSugestoes(){
      var log = room.log || [];
      if(lastLogLen < 0){ lastLogLen = log.length; return; }
      if(log.length <= lastLogLen){ lastLogLen = log.length; return; }

      var novos = log.slice(lastLogLen);
      lastLogLen = log.length;

      novos.forEach(function(entry){
        // Estratégia 3: alguém mostrou uma carta? Limpa timers de espera.
        if(MOSTROU_RE.test(entry.text || '')){
          limparTimersDeEspera();
          return;
        }

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
        var pid = order[(startIdx+i) % order.length];
        if(pid === suggester.id) break; // volta ao sugestor = ninguém mostrou
        ordemResposta.push(pid);
      }

      // Estratégia 3: espera um humano mostrar carta antes de qualquer bot
      // agir. Percorremos a ordem; humanos = passivo (espera), bots = ativo.
      var idx = 0;
      var responded = false;

      function clearWatch(){ if(watchingSuggestion){ clearTimeout(watchingSuggestion.timer); } }
      clearWatch();
      watchingSuggestion = {
        suggesterName: suggester.name,
        trio: trio,
        timer: setTimeout(function(){
          if(responded) return;
          responded = true;
          // tempo esgotou: nenhum humano mostrou carta, segue pra bots
          tentarBots();
        }, MOCHA_TIMER_MS)
      };

      function tentarBots(){
        (function tentarProximo(i){
          if(responded || i >= ordemResposta.length) return;
          var pid = ordemResposta[i];
          var p = playerById(pid);
          if(!p){ tentarProximo(i+1); return; }

          if(!p.isBot){
            // humano na ordem: nada a fazer, segue
            tentarProximo(i+1);
            return;
          }
          loadBotMemory(p.id, function(mem){
            if(responded) return;
            var match = trio.filter(function(c){ return mem.hand.indexOf(c) >= 0; });
            if(match.length){
              responded = true;
              var carta = pickRandom(match);
              setTimeout(function(){
                notifCol().doc(handKey(roomCode, suggester.id)).set({
                  items: fv().arrayUnion({from: p.name, card: carta, ts: nowTs()})
                }, {merge:true}).then(function(){
                  return roomsCol().doc(roomCode).update({
                    log: fv().arrayUnion({text: p.name+' mostrou uma carta para '+suggester.name+'.', type:'normal', ts: nowTs()})
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

      // Primeiro percorre humanos na ordem. Se algum humano está "entre" o
      // sugestor e o próximo bot, aguarda MOCHA_TIMER_MS pra ele mostrar.
      // Se ninguém mostrar nesse tempo, libera os bots.
      watchingSuggestion.timer = setTimeout(function(){
        if(responded) return;
        // Nenhum humano entre o sugestor e o próximo bot mostrou carta.
        // Dá inicio aos bots.
        responded = true;
        tentarBots();
      }, MOCHA_TIMER_MS);
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
