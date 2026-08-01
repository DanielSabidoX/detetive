/* ===== Tabuleiro Virtual v1 — sincronizado entre jogadores =====
   Totalmente independente do main.js. Usa sua PRÓPRIA coleção no Firestore
   ("board_positions"), então não interfere em nada que o jogo principal
   já grava na coleção "rooms". Só faz LEITURA de "rooms" (nomes/lista de
   jogadores), nunca escreve nela.

   Uso, depois de incluir Firebase + firebase-config.js + este arquivo:
   <div id="tabuleiro-painel"></div>
   <script src="tabuleiro/board.js"></script>
   <script>mountBoard('#tabuleiro-painel');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';
  var PANEL_POS_KEY = 'casoArquivado_tabuleiro_pos_v1';
  var PANEL_COLLAPSED_KEY = 'casoArquivado_tabuleiro_collapsed_v1';

  // ---- Layout da matriz (independente dos nomes reais — lido do room quando possível) ----
  var ROOM_GRID = [
    ['Hall','Sala de Estar','Salão de Festas'],
    ['Biblioteca','Escritório','Sala de Jantar'],
    ['Salão de Jogos','Sala de Música','Cozinha']
  ];
  var BLOCK = 4;   // cada sala ocupa um bloco 4x4 de células
  var GAP = 2;     // corredor de 2 células entre blocos de sala
  var BORDER = 1;  // margem externa de 1 célula
  var SIZE = BORDER*2 + BLOCK*3 + GAP*2; // = 18
  var CENTER_OFFSET = Math.floor(BLOCK/2); // célula usada como "âncora" central da sala

  var PAWN_COLORS = ['#b5433a','#4a86b8','#5f9c4a','#c98a3c','#9c5cb8','#3ca6a0'];

  // cor temática de cada sala — os valores de verdade ficam em board.css (variáveis CSS),
  // aqui só apontamos qual variável cada sala usa.
  var ROOM_COLORS = {
    'Hall':            'var(--cor-hall)',
    'Sala de Estar':   'var(--cor-sala-estar)',
    'Salão de Festas': 'var(--cor-salao-festas)',
    'Biblioteca':      'var(--cor-biblioteca)',
    'Escritório':      'var(--cor-escritorio)',
    'Sala de Jantar':  'var(--cor-sala-jantar)',
    'Salão de Jogos':  'var(--cor-salao-jogos)',
    'Sala de Música':  'var(--cor-sala-musica)',
    'Cozinha':         'var(--cor-cozinha)'
  };

  function roomStartRow(rIdx){ return BORDER + rIdx*(BLOCK+GAP) + 1; }
  function roomStartCol(cIdx){ return BORDER + cIdx*(BLOCK+GAP) + 1; }

  // célula "âncora" (centro) de cada sala, mapa de células por sala, e as 2 portas de cada uma
  function buildRoomMeta(){
    var rooms = []; // {name, r0,c0, anchorRow, anchorCol, color, doors:[{row,col}]}
    var cellOwner = {}; // "r,c" -> room index
    var doorOwner = {}; // "r,c" -> {color,name}
    for(var ri=0; ri<3; ri++){
      for(var ci=0; ci<3; ci++){
        var name = ROOM_GRID[ri][ci];
        var color = ROOM_COLORS[name] || '#b8863b';
        var r0 = roomStartRow(ri), c0 = roomStartCol(ci);
        var idx = rooms.length;

        // porta 1: sempre no meio do lado de baixo da sala
        var doorSouth = { row: r0+BLOCK, col: c0+1 };
        // porta 2: lado lateral que aponta para o centro do tabuleiro.
        // Colunas meio/direita dividem o mesmo corredor entre si, então usamos
        // linhas diferentes (topo/base do bloco) pra evitar as portas colidirem.
        var doorSide = (ci===2)
          ? { row: r0+BLOCK-1, col: c0-1 }  // coluna direita -> porta olha pra esquerda (linha de baixo)
          : { row: r0, col: c0+BLOCK };     // colunas esquerda/meio -> porta olha pra direita (linha de cima)

        rooms.push({
          name:name, r0:r0, c0:c0,
          anchorRow: r0+CENTER_OFFSET, anchorCol: c0+CENTER_OFFSET,
          color: color,
          doors: [doorSouth, doorSide]
        });
        doorOwner[doorSouth.row+','+doorSouth.col] = {color:color, name:name};
        doorOwner[doorSide.row+','+doorSide.col] = {color:color, name:name};

        for(var dr=0; dr<BLOCK; dr++){
          for(var dc=0; dc<BLOCK; dc++){
            cellOwner[(r0+dr)+','+(c0+dc)] = idx;
          }
        }
      }
    }
    return {rooms:rooms, cellOwner:cellOwner, doorOwner:doorOwner};
  }

  var ROOM_META = buildRoomMeta();

  function isRoomCell(r,c){
    return ROOM_META.cellOwner.hasOwnProperty(r+','+c);
  }
  function roomAt(r,c){
    var idx = ROOM_META.cellOwner[r+','+c];
    return idx===undefined ? null : ROOM_META.rooms[idx];
  }
  function doorAt(r,c){
    return ROOM_META.doorOwner[r+','+c] || null;
  }
  function clampCell(r,c){
    r = Math.max(1, Math.min(SIZE, Math.round(r)));
    c = Math.max(1, Math.min(SIZE, Math.round(c)));
    return {row:r, col:c};
  }
  // se caiu dentro de uma sala, "gruda" no ponto âncora dela
  function snapCell(r,c){
    var cell = clampCell(r,c);
    var room = roomAt(cell.row, cell.col);
    if(room) return {row:room.anchorRow, col:room.anchorCol};
    return cell;
  }

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }

  window.mountBoard = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="tab-handle">'+
        '<h3>Tabuleiro</h3>'+
        '<button type="button" class="tab-toggle">_</button>'+
      '</div>'+
      '<div class="tab-body">'+
        '<div class="tab-status">Sem sala ativa</div>'+
        '<div class="tab-board-wrap"></div>'+
        '<div class="tab-legend"></div>'+
        '<div class="tab-hint">Arraste qualquer peão para mover — inclusive o dos outros jogadores.</div>'+
      '</div>';

    var handle    = host.querySelector('.tab-handle');
    var toggleBtn = host.querySelector('.tab-toggle');
    var body      = host.querySelector('.tab-body');
    var statusEl  = host.querySelector('.tab-status');
    var boardWrap = host.querySelector('.tab-board-wrap');
    var legendEl  = host.querySelector('.tab-legend');

    // ---------- posição/estado salvo do painel (só desta instância local) ----------
    try{
      var savedPos = JSON.parse(localStorage.getItem(PANEL_POS_KEY));
      if(savedPos && typeof savedPos.left === 'number'){
        host.style.left = savedPos.left + 'px';
        host.style.top  = savedPos.top + 'px';
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
    var players = [];       // [{id,name,eliminated}]
    var pawns = {};         // playerId -> {row,col}
    var cellPx = 26;        // recalculado a cada render
    var GAP_PX = 1;         // precisa bater com o "gap" definido em .tab-board no CSS
    var draggingPawnId = null;
    var boardEl = null;

    var unsubRoomRead = null;
    var unsubBoard = null;

    function playerColor(pid){
      var idx = players.findIndex(function(p){ return p.id===pid; });
      if(idx<0) idx = 0;
      return PAWN_COLORS[idx % PAWN_COLORS.length];
    }
    function playerInitial(name){
      return (name||'?').trim().charAt(0).toUpperCase();
    }
    function defaultSpawn(idx){
      // fileira de baixo, espalhados
      var col = 2 + (idx*2) % (SIZE-2);
      return {row: SIZE, col: Math.min(SIZE-1, Math.max(2,col))};
    }

    function buildBoardSkeleton(){
      boardWrap.innerHTML = '<div class="tab-board" id="tab-board-el"></div>';
      boardEl = boardWrap.querySelector('#tab-board-el');

      // tamanho de célula responsivo ao container (descontando o espaço do "gap" entre células)
      var wrapWidth = boardWrap.clientWidth || 340;
      var totalGap = (SIZE-1) * GAP_PX;
      cellPx = Math.max(14, Math.floor((wrapWidth - totalGap) / SIZE));

      boardEl.style.gridTemplateColumns = 'repeat('+SIZE+', '+cellPx+'px)';
      boardEl.style.gridTemplateRows = 'repeat('+SIZE+', '+cellPx+'px)';
      boardEl.style.width = (cellPx*SIZE + totalGap)+'px';
      boardEl.style.height = (cellPx*SIZE + totalGap)+'px';

      var frag = document.createDocumentFragment();
      var renderedRoom = {}; // evita desenhar a mesma sala 9x (uma vez por bloco)

      for(var r=1; r<=SIZE; r++){
        for(var c=1; c<=SIZE; c++){
          var room = roomAt(r,c);
          if(room){
            var key = room.name;
            if(renderedRoom[key]) continue;
            renderedRoom[key] = true;
            var div = document.createElement('div');
            div.className = 'tab-room';
            div.dataset.roomAnchor = room.anchorRow+','+room.anchorCol;
            div.style.gridRow = room.r0 + ' / span ' + BLOCK;
            div.style.gridColumn = room.c0 + ' / span ' + BLOCK;
            div.style.setProperty('--room-color', room.color);
            div.innerHTML = '<span class="tab-room-name">'+escHtml(room.name)+'</span>';
            frag.appendChild(div);
          } else {
            var cell = document.createElement('div');
            cell.className = 'tab-cell corridor';
            cell.dataset.row = r; cell.dataset.col = c;
            cell.style.gridRow = r; cell.style.gridColumn = c;
            var door = doorAt(r,c);
            if(door){
              cell.className += ' door';
              cell.style.setProperty('--door-color', door.color);
              cell.title = 'Porta — ' + door.name;
            }
            frag.appendChild(cell);
          }
        }
      }
      boardEl.appendChild(frag);
    }

    function escHtml(s){
      return String(s).replace(/[&<>"']/g, function(ch){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
      });
    }

    // posição em pixels do CENTRO de uma célula (row/col 1-indexados), considerando o gap
    function cellCenterPx(row, col){
      var step = cellPx + GAP_PX;
      return { x: (col-1)*step + cellPx/2, y: (row-1)*step + cellPx/2 };
    }
    // caminho inverso: de um pixel (x,y) pra qual célula (row/col) ele corresponde
    function pxToCell(x, y){
      var step = cellPx + GAP_PX;
      return {
        col: Math.floor(x/step) + 1,
        row: Math.floor(y/step) + 1
      };
    }

    function renderLegend(){
      legendEl.innerHTML = players.map(function(p){
        var me = getSession();
        var mine = me && me.pid === p.id;
        return '<span class="tab-legend-item'+(mine?' you':'')+'">'+
          '<span class="tab-legend-dot" style="background:'+playerColor(p.id)+'"></span>'+
          escHtml(p.name)+(mine?' (você)':'')+
        '</span>';
      }).join('');
    }

    function renderPawns(){
      if(!boardEl) return;
      // remove peões antigos
      var old = boardEl.querySelectorAll('.tab-pawn');
      for(var i=0;i<old.length;i++){ old[i].remove(); }

      // agrupa peões por célula pra espalhar visualmente quando empilhados
      var byCell = {};
      players.forEach(function(p, idx){
        var pos = pawns[p.id] || defaultSpawn(idx);
        var key = pos.row+','+pos.col;
        (byCell[key] = byCell[key]||[]).push({player:p, pos:pos});
      });

      Object.keys(byCell).forEach(function(key){
        var group = byCell[key];
        group.forEach(function(item, gi){
          var p = item.player, pos = item.pos;
          var center = cellCenterPx(pos.row, pos.col);
          var spread = group.length>1 ? (gi - (group.length-1)/2) * 12 : 0;

          var el = document.createElement('div');
          el.className = 'tab-pawn';
          el.style.left = (center.x + spread) + 'px';
          el.style.top  = (center.y) + 'px';
          el.style.background = playerColor(p.id);
          el.textContent = playerInitial(p.name);
          el.title = p.name;
          el.dataset.pid = p.id;
          attachPawnDrag(el, p.id);
          boardEl.appendChild(el);
        });
      });
    }

    function clearDropHighlights(){
      var hl = boardEl.querySelectorAll('.drop-hover');
      for(var i=0;i<hl.length;i++){ hl[i].classList.remove('drop-hover'); }
    }

    function attachPawnDrag(el, pid){
      var dragging=false, offX=0, offY=0;

      el.addEventListener('pointerdown', function(e){
        e.stopPropagation();
        dragging = true;
        draggingPawnId = pid;
        el.classList.add('dragging');
        var boardRect = boardEl.getBoundingClientRect();
        offX = e.clientX - boardRect.left - parseFloat(el.style.left);
        offY = e.clientY - boardRect.top - parseFloat(el.style.top);
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', function(e){
        if(!dragging) return;
        var boardRect = boardEl.getBoundingClientRect();
        var x = e.clientX - boardRect.left - offX;
        var y = e.clientY - boardRect.top - offY;
        el.style.left = x+'px';
        el.style.top  = y+'px';

        var cellIdx = pxToCell(x, y);
        var col = cellIdx.col, row = cellIdx.row;
        clearDropHighlights();
        var target = boardEl.querySelector('[data-row="'+row+'"][data-col="'+col+'"]');
        if(target){ target.classList.add('drop-hover'); }
        else {
          var room = roomAt(row, col);
          if(room){
            var roomDiv = boardEl.querySelector('[data-room-anchor="'+room.anchorRow+','+room.anchorCol+'"]');
            if(roomDiv) roomDiv.classList.add('drop-hover');
          }
        }
      });

      function finish(e){
        if(!dragging) return;
        dragging = false;
        draggingPawnId = null;
        el.classList.remove('dragging');
        clearDropHighlights();

        var boardRect = boardEl.getBoundingClientRect();
        var x = parseFloat(el.style.left) || 0;
        var y = parseFloat(el.style.top) || 0;
        var cellIdx = pxToCell(x, y);
        var snapped = snapCell(cellIdx.row, cellIdx.col);

        pawns[pid] = {row:snapped.row, col:snapped.col};
        renderPawns();
        savePawnPosition(pid, snapped.row, snapped.col);
      }
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
    }

    function savePawnPosition(pid, row, col){
      if(!roomCode || typeof db === 'undefined') return;
      var ref = db.collection('board_positions').doc(roomCode);
      var value = {row:row, col:col, at: Date.now()};
      var dotField = {};
      dotField['pawns.'+pid] = value;
      // update() interpreta "pawns.<id>" como caminho aninhado corretamente.
      ref.update(dotField).catch(function(err){
        // Se o documento ainda não existe (primeira jogada nesta sala), update() falha.
        // Nesse caso criamos o documento com a estrutura aninhada de verdade.
        if(err && (err.code === 'not-found' || /No document to update/i.test(err.message||''))){
          var nested = {pawns:{}};
          nested.pawns[pid] = value;
          ref.set(nested, {merge:true}).catch(function(err2){
            console.warn('[tabuleiro] não foi possível criar a posição do peão:', err2 && err2.code, err2 && err2.message);
          });
        } else {
          console.warn('[tabuleiro] não foi possível salvar a posição do peão:', err && err.code, err && err.message);
        }
      });
    }

    function fullRender(){
      buildBoardSkeleton();
      renderLegend();
      renderPawns();
    }

    function listenRoom(code){
      if(unsubRoomRead){ unsubRoomRead(); unsubRoomRead=null; }
      if(!code || typeof db === 'undefined'){ return; }
      unsubRoomRead = db.collection('rooms').doc(code).onSnapshot(function(snap){
        var d = snap.exists ? snap.data() : null;
        players = (d && d.players) ? d.players : [];
        fullRender();
      }, function(err){
        console.warn('[tabuleiro] falha ao ler jogadores da sala:', err && err.code, err && err.message);
      });
    }

    function listenBoard(code){
      if(unsubBoard){ unsubBoard(); unsubBoard=null; }
      if(!code || typeof db === 'undefined'){ return; }
      unsubBoard = db.collection('board_positions').doc(code).onSnapshot(function(snap){
        var d = snap.exists ? snap.data() : null;
        pawns = (d && d.pawns) ? d.pawns : {};
        renderPawns();
      }, function(err){
        console.warn('[tabuleiro] falha ao sincronizar peões:', err && err.code, err && err.message);
      });
    }

    function activate(code){
      roomCode = code;
      statusEl.textContent = 'Sincronizado — sala ' + code;
      statusEl.classList.add('on');
      boardWrap.style.display = '';
      legendEl.style.display = '';
      listenRoom(code);
      listenBoard(code);
    }

    function deactivate(){
      roomCode = null;
      players = []; pawns = {};
      if(unsubRoomRead){ unsubRoomRead(); unsubRoomRead=null; }
      if(unsubBoard){ unsubBoard(); unsubBoard=null; }
      statusEl.textContent = 'Sem sala ativa';
      statusEl.classList.remove('on');
      boardWrap.innerHTML = '<div class="tab-empty">Entre em uma sala para ver o tabuleiro.</div>';
      legendEl.innerHTML = '';
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

    window.addEventListener('resize', function(){
      if(roomCode) fullRender();
    });
  };
})();