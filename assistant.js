/* ===== Assistente IA pessoal — Caso Arquivado =====
   Arquivo isolado, independente do main.js. Cada jogador tem o SEU
   PRÓPRIO assistente, rodando só no navegador dele.

   REGRAS DE SEGURANÇA (nunca violar):
   - NUNCA lê a mão de outro jogador (só a própria, via handKey do
     PRÓPRIO pid).
   - NUNCA lê/usa room.secret (a resposta do caso) — mesmo que esse
     campo esteja tecnicamente acessível no documento da sala, este
     arquivo jamais o referencia ou envia pra IA.
   - Só usa: a mão do próprio jogador, as cartas que JÁ FORAM MOSTRADAS
     A ELE (coleção "notifications", coleção pública mas só a fatia
     dele mesmo), a própria ficha de anotações, e o registro público
     da partida (log da sala — o mesmo que todo mundo já vê no jogo).
   - Cada assistente é 100% independente: a consulta de um jogador
     nunca é usada como contexto pra IA de outro jogador.
   - Uma nova consulta SOBRESCREVE a anterior (não acumula histórico).

   Uso, depois de incluir Firebase + firebase-config.js + main.js:
   <div id="assistente-painel"></div>
   <script src="assistant.js"></script>
   <script>mountAssistant('#assistente-painel');</script>
*/
(function(){
  var SESSION_KEY = 'casoArquivado_session_v1';

  // precisa bater com main.js
  var SUSPEITOS = [
    "Prof. Black", "Srta. Rosa", "Cel. Mostarda",
    "Dona Branca", "Sr. Marinho", "Dona Violeta"
  ];
  var ARMAS = [
    "Revólver", "Cano", "Chave Inglesa",
    "Faca", "Candelabro", "Corda"
  ];
  var LOCAIS = [
    "Hall", "Sala de Estar", "Salão de Festas", "Cozinha",
    "Biblioteca", "Sala de Jantar", "Escritório",
    "Sala de Música", "Salão de Jogos"
  ];

  // ---- Groq ----
  // Uso pessoal: chave direto no código, sem proxy (mesma lógica já usada
  // em bot.js). Gere a sua em https://console.groq.com/keys
  var GROQ_API_KEY = '';
  var GROQ_MODEL = 'openai/gpt-oss-120b';
  var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }
  function escHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function roomsCol(){ return db.collection('rooms'); }
  function handsCol(){ return db.collection('hands'); }
  function notifCol(){ return db.collection('notifications'); }
  function notesCol(){ return db.collection('notes'); }
  function handKey(code, pid){ return code + '_' + pid; }
  function categoriaDaCarta(nome){
    if(SUSPEITOS.indexOf(nome) >= 0) return 'suspeito';
    if(ARMAS.indexOf(nome) >= 0) return 'arma';
    if(LOCAIS.indexOf(nome) >= 0) return 'local';
    return null;
  }

  // converte o texto (markdown simples) que a Groq devolve em HTML seguro
  function formatarRespostaIA(texto){
    var linhas = String(texto||'').replace(/\r\n/g,'\n').split('\n');
    var html = '';
    var dentroDeLista = false;
    linhas.forEach(function(linhaOriginal){
      var linha = linhaOriginal.trim();
      if(!linha){
        if(dentroDeLista){ html += '</ul>'; dentroDeLista = false; }
        return;
      }
      var isItem = /^[-•*]\s+/.test(linha);
      var conteudo = escHtml(linha.replace(/^[-•*]\s+/, ''));
      // **negrito** -> <b>
      conteudo = conteudo.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      // títulos tipo "### Algo" ou "Algo:" sozinho na linha
      var ehTitulo = /^#{1,4}\s+/.test(linha);
      if(ehTitulo){
        if(dentroDeLista){ html += '</ul>'; dentroDeLista = false; }
        html += '<h4 class="ia-subtitulo">'+conteudo.replace(/^#{1,4}\s+/,'')+'</h4>';
        return;
      }
      if(isItem){
        if(!dentroDeLista){ html += '<ul class="ia-lista">'; dentroDeLista = true; }
        html += '<li>'+conteudo+'</li>';
      } else {
        if(dentroDeLista){ html += '</ul>'; dentroDeLista = false; }
        html += '<p>'+conteudo+'</p>';
      }
    });
    if(dentroDeLista) html += '</ul>';
    return html || '<p class="panel-empty">A IA não retornou nenhum conteúdo.</p>';
  }

  window.mountAssistant = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="panel-handle"><h3>Assistente IA</h3>'+
        '<button type="button" class="panel-toggle" onclick="if(window.closePanelNav) window.closePanelNav();">_</button>'+
      '</div>'+
      '<div class="panel-body">'+
        '<div class="panel-status">Sem sala ativa</div>'+
        '<div class="ia-content"></div>'+
      '</div>';

    var statusEl  = host.querySelector('.panel-status');
    var contentEl = host.querySelector('.ia-content');

    var roomCode = null, myId = null, myName = null;
    var carregando = null; // 'resumo' | 'insights' | null

    function chaveResultado(kind){ return 'casoArquivado_ia_'+roomCode+'_'+myId+'_'+kind; }
    function salvarResultado(kind, texto){
      try{ localStorage.setItem(chaveResultado(kind), texto); }catch(e){}
    }
    function carregarResultado(kind){
      try{ return localStorage.getItem(chaveResultado(kind)) || ''; }catch(e){ return ''; }
    }

    function render(){
      if(!roomCode){
        statusEl.textContent = 'Sem sala ativa';
        statusEl.classList.remove('on');
        contentEl.innerHTML = '<div class="panel-empty">Entre em uma sala para usar o assistente.</div>';
        return;
      }
      statusEl.textContent = 'Sincronizado — sala ' + roomCode;
      statusEl.classList.add('on');

      var resumo = carregarResultado('resumo');
      var insights = carregarResultado('insights');

      var html = '<div class="ia-hint">'+
        'Seu assistente pessoal lê só as suas próprias cartas, sua ficha de anotações '+
        'e o registro público da partida — nunca vê as cartas de outros jogadores nem a resposta do caso.'+
      '</div>';

      html += '<div class="ia-actions">'+
        '<button type="button" class="ia-btn" data-kind="resumo" '+(carregando==='resumo'?'disabled':'')+'>'+
          (carregando==='resumo' ? '⏳ Gerando resumo...' : '📋 Resumo dos meus dados')+
        '</button>'+
        '<button type="button" class="ia-btn" data-kind="insights" '+(carregando==='insights'?'disabled':'')+'>'+
          (carregando==='insights' ? '⏳ Gerando insights...' : '💡 Insights e sugestões')+
        '</button>'+
      '</div>';

      html += '<div class="ia-resultado">';
      if(resumo){
        html += '<div class="ia-bloco"><div class="ia-bloco-titulo">📋 Último resumo</div>'+resumo+'</div>';
      }
      if(insights){
        html += '<div class="ia-bloco"><div class="ia-bloco-titulo">💡 Últimos insights</div>'+insights+'</div>';
      }
      if(!resumo && !insights){
        html += '<div class="panel-empty">Nenhuma consulta feita ainda nesta sala.</div>';
      }
      html += '</div>';

      contentEl.innerHTML = html;

      var botoes = contentEl.querySelectorAll('.ia-btn');
      botoes.forEach(function(btn){
        btn.addEventListener('click', function(){
          rodarConsulta(btn.getAttribute('data-kind'));
        });
      });
    }

    // ---------------- coleta de dados (só do próprio jogador) ----------------
    function coletarDados(cb){
      Promise.all([
        handsCol().doc(handKey(roomCode, myId)).get(),
        notifCol().doc(handKey(roomCode, myId)).get(),
        notesCol().doc(handKey(roomCode, myId)).get(),
        roomsCol().doc(roomCode).get()
      ]).then(function(results){
        var handSnap = results[0], notifSnap = results[1], notesSnap = results[2], roomSnap = results[3];
        var minhaMao = handSnap.exists ? (handSnap.data().cards || []) : [];
        var mostradas = notifSnap.exists ? (notifSnap.data().items || []) : [];
        var minhasNotas = notesSnap.exists ? (notesSnap.data().data || null) : null;
        var roomData = roomSnap.exists ? roomSnap.data() : {};
        // importante: NUNCA lemos/usamos roomData.secret aqui
        var log = (roomData.log || []).slice(-40); // últimas entradas bastam de contexto
        cb({ mao: minhaMao, mostradas: mostradas, notas: minhasNotas, log: log });
      }).catch(function(err){
        console.warn('[assistente] falha ao coletar dados:', err && err.code, err && err.message);
        cb(null);
      });
    }

    // cartas mostradas ao jogador que ele ainda não marcou como
    // descartadas ('x') na própria ficha — calculado aqui mesmo, sem IA,
    // pra garantir que a informação seja sempre exata
    function calcularEsquecidas(dados){
      var notas = dados.notas || { suspeito:{}, arma:{}, local:{} };
      var vistas = {};
      dados.mostradas.forEach(function(item){ vistas[item.card] = true; });
      dados.mao.forEach(function(c){ vistas[c] = true; }); // cartas da própria mão também deveriam estar marcadas
      var esquecidas = [];
      Object.keys(vistas).forEach(function(carta){
        var cat = categoriaDaCarta(carta);
        if(!cat) return;
        var status = (notas[cat] && notas[cat][carta]) || '';
        if(status !== 'x') esquecidas.push(carta);
      });
      return esquecidas;
    }

    function montarBlocoDados(dados){
      var mao = dados.mao.length ? dados.mao.join(', ') : '(nenhuma)';
      var mostradas = dados.mostradas.length
        ? dados.mostradas.map(function(it){ return it.card+' (mostrada por '+it.from+')'; }).join('; ')
        : '(nenhuma até agora)';

      var notas = dados.notas || { suspeito:{}, arma:{}, local:{} };
      function listarPorStatus(cat, status){
        var chaves = cat==='suspeito' ? SUSPEITOS : cat==='arma' ? ARMAS : LOCAIS;
        return chaves.filter(function(k){ return (notas[cat]&&notas[cat][k])===status; }).join(', ') || '(nenhum)';
      }

      var logTexto = dados.log.map(function(e){ return '['+e.ts+'] '+e.text; }).join('\n') || '(sem eventos ainda)';

      return 'SUAS CARTAS (você tem certeza que NÃO são a resposta):\n'+mao+'\n\n'+
        'CARTAS JÁ MOSTRADAS A VOCÊ POR OUTROS JOGADORES (também não são a resposta):\n'+mostradas+'\n\n'+
        'SUA FICHA DE ANOTAÇÕES ATUAL:\n'+
        '- Suspeitos descartados: '+listarPorStatus('suspeito','x')+'\n'+
        '- Suspeitos marcados como possíveis: '+listarPorStatus('suspeito','?')+'\n'+
        '- Armas descartadas: '+listarPorStatus('arma','x')+'\n'+
        '- Armas marcadas como possíveis: '+listarPorStatus('arma','?')+'\n'+
        '- Cômodos descartados: '+listarPorStatus('local','x')+'\n'+
        '- Cômodos marcados como possíveis: '+listarPorStatus('local','?')+'\n\n'+
        'REGISTRO PÚBLICO DA PARTIDA (mais recentes):\n'+logTexto;
    }

    function rodarConsulta(kind){
      if(carregando) return;
      carregando = kind;
      render();

      coletarDados(function(dados){
        if(!dados){
          carregando = null;
          contentEl.querySelector('.ia-resultado').insertAdjacentHTML('afterbegin',
            '<div class="ia-erro">Não foi possível coletar seus dados agora. Tente de novo.</div>');
          render();
          return;
        }

        var esquecidas = calcularEsquecidas(dados);
        var avisoHtml = esquecidas.length
          ? '<div class="ia-aviso">⚠️ <b>Atenção:</b> você já viu estas cartas mas ainda não marcou como descartadas na ficha: '+
            esquecidas.map(escHtml).join(', ')+'.</div>'
          : '';

        var blocoDados = montarBlocoDados(dados);

        var instrucaoBase =
          'Você é um assistente pessoal de UM jogador num jogo de dedução estilo Detetive/Clue. '+
          'Você NÃO sabe e NUNCA deve tentar adivinhar ou inventar qual é a resposta correta do caso. '+
          'Baseie-se SOMENTE nos dados abaixo, que pertencem exclusivamente a este jogador — nunca presuma '+
          'cartas de outros jogadores além do que foi explicitamente mostrado a ele.\n\n'+
          'Responda em português, formatado em tópicos curtos (use "- " no início de cada item), '+
          'com pequenos subtítulos quando fizer sentido separar seções, para facilitar a leitura.\n\n';

        var instrucaoEspecifica = kind==='resumo'
          ? 'Faça um RESUMO objetivo dos dados abaixo e uma conclusão DESCRITIVA (não preditiva) sobre o '+
            'estado atual da investigação deste jogador: o que já está descartado, o que ainda está em aberto, '+
            'e padrões que você perceber no que já foi sugerido na partida. Não tente advinhar a resposta final.'
          : 'Gere INSIGHTS e SUGESTÕES DE PRÓXIMAS JOGADAS pra esse jogador — que sugestões fazer a seguir, '+
            'para quais cômodos tentar ir, e por quê — com base só no que já se sabe pelos dados abaixo. '+
            'O objetivo é ajudar a estreitar as possibilidades mais rápido. Não invente a resposta final.';

        var prompt = instrucaoBase + instrucaoEspecifica + '\n\nDADOS:\n' + blocoDados;

        if(!GROQ_API_KEY || GROQ_API_KEY === 'COLOQUE_SUA_CHAVE_AQUI'){
          carregando = null;
          var msg = '<div class="ia-erro">Configure sua chave da Groq no topo do arquivo assistant.js (variável GROQ_API_KEY) para usar o assistente.</div>';
          contentEl.innerHTML = msg;
          setTimeout(render, 50);
          return;
        }

        fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
          body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0.4,
            messages: [
              { role: 'system', content: 'Você responde sempre em português, de forma objetiva e organizada em tópicos.' },
              { role: 'user', content: prompt }
            ]
          })
        }).then(function(r){ return r.json(); })
          .then(function(data){
            var texto = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            var respostaHtml = avisoHtml + formatarRespostaIA(texto || '');
            salvarResultado(kind, respostaHtml);
            carregando = null;
            render();
          })
          .catch(function(err){
            console.warn('[assistente] falha na Groq:', err && err.message);
            carregando = null;
            render();
            var bloco = contentEl.querySelector('.ia-resultado');
            if(bloco) bloco.insertAdjacentHTML('afterbegin', '<div class="ia-erro">Falha ao consultar a IA. Tente novamente em instantes.</div>');
          });
      });
    }

    // ---------------- ligação com a sessão ----------------
    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      var pid = s && s.pid ? s.pid : null;
      if(code !== roomCode || pid !== myId){
        roomCode = code; myId = pid; myName = s ? s.name : null;
        render();
      }
    }

    render();
    checkSession();
    setInterval(checkSession, 1500);
  };
})();
