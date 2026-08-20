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
    function limparResultados(){
      try{
        localStorage.removeItem(chaveResultado('atual'));
        // limpa chaves antigas da versão anterior
        localStorage.removeItem(chaveResultado('resumo'));
        localStorage.removeItem(chaveResultado('insights'));
      }catch(e){}
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

      var resultadoAtual = carregarResultado('atual');

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
      if(resultadoAtual){
        html += '<div class="ia-bloco">' + resultadoAtual + '</div>';
      } else {
        html += '<div class="panel-empty">Clique em uma opção acima para ver os resultados.</div>';
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
        var log = (roomData.log || []).slice(-80); // últimas 80 entradas para ter mais contexto
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

    // calcula, por categoria, o que já está 100% eliminado (sua mão +
    // cartas mostradas a você, IGNORANDO se a ficha foi marcada ou não —
    // essa é a fonte da verdade) e o que ainda está em aberto, com um
    // peso simples (marcado "?" pesa mais) pra estimar probabilidade.
    // Também cruza com o log pra ajustar pesos: cartas que apareceram
    // em sugestões onde NINGUÉM mostrou carta ganham peso maior.
    function calcularCandidatos(dados){
      var notas = dados.notas || { suspeito:{}, arma:{}, local:{} };
      var conhecidoNao = {};
      dados.mao.forEach(function(c){ conhecidoNao[c] = true; });
      dados.mostradas.forEach(function(it){ conhecidoNao[it.card] = true; });

      // analisa o log pra contar: quantas vezes cada carta apareceu em
      // sugestões onde NINGUÉM mostrou carta (indica que é provável resposta)
      var SUG_RE = /(.+?) sugeriu: (.+?) \+ (.+?) \+ (.+?)\. Aguardando/;
      var MOSTROU_RE = /mostrou uma? carta/;
      var nenhumMostrou = {};  // carta -> quantas sugestões sem resposta
      var log = dados.log || [];
      for(var i=0; i<log.length; i++){
        var entry = log[i];
        var text = entry.text || '';
        if(!SUG_RE.test(text)) continue;
        var m = SUG_RE.exec(text);
        var sugCartas = [m[2], m[3], m[4]];
        // verifica se ALGUÉM mostrou carta depois desta sugestão
        var alguemMostrou = false;
        for(var j=i+1; j<Math.min(i+10, log.length); j++){
          var next = log[j].text || '';
          if(SUG_RE.test(next)) break; // nova sugestão = fim dessa rodada
          if(MOSTROU_RE.test(next)){ alguemMostrou = true; break; }
        }
        if(!alguemMostrou){
          sugCartas.forEach(function(c){
            nenhumMostrou[c] = (nenhumMostrou[c] || 0) + 1;
          });
        }
      }

      function processarCategoria(cat, todasAsOpcoes){
        var restantes = [];
        var pesos = {};
        todasAsOpcoes.forEach(function(nome){
          var marcadoDescartado = (notas[cat] && notas[cat][nome]) === 'x';
          if(conhecidoNao[nome] || marcadoDescartado) return; // eliminado
          restantes.push(nome);
          var peso = 1;
          var marcadoSuspeita = (notas[cat] && notas[cat][nome]) === '?';
          if(marcadoSuspeita) peso += 1;
          // carta que apareceu em sugestão sem ninguém mostrar = mais provável
          if(nenhumMostrou[nome]) peso += nenhumMostrou[nome] * 0.5;
          pesos[nome] = peso;
        });
        var somaPesos = restantes.reduce(function(s,n){ return s+pesos[n]; }, 0) || 1;
        var comPercentual = restantes.map(function(nome){
          return nome + ' (~' + Math.round(pesos[nome]/somaPesos*100) + '%)';
        });
        return { restantes: restantes, texto: comPercentual.join(', ') || '(nenhum — todos já eliminados, revise sua ficha)' };
      }

      return {
        suspeito: processarCategoria('suspeito', SUSPEITOS),
        arma: processarCategoria('arma', ARMAS),
        local: processarCategoria('local', LOCAIS)
      };
    }

    function montarBlocoDados(dados){
      var mao = dados.mao.length ? dados.mao.join(', ') : '(nenhuma)';
      var mostradas = dados.mostradas.length
        ? dados.mostradas.map(function(it){ return it.card+' (mostrada por '+it.from+')'; }).join('; ')
        : '(nenhuma até agora)';

      var candidatos = calcularCandidatos(dados);

      // formata o log de forma mais legível pra IA
      var logLinhas = dados.log.map(function(e){
        var t = e.text || '';
        // simplifica tipos de evento
        if(/sugeriu:/.test(t)) return '[SUGESTÃO] ' + t.replace('. Aguardando alguém mostrar uma carta.', '');
        if(/mostrou uma? carta/.test(t)) return '[CARTA MOSTRADA] ' + t;
        if(/passou a vez/.test(t)) return '[PASSOU] ' + t;
        if(/acusação final/.test(t)) return '[ACUSAÇÃO] ' + t;
        if(/resolveu o caso/.test(t)) return '[RESOLVIDO] ' + t;
        return '[INFO] ' + t;
      });
      var logTexto = logLinhas.join('\n') || '(sem eventos ainda)';

      return '=== DADOS DESTA PARTIDA (use SOMENTE estes dados, não invente nada) ===\n\n'+
        'CARTAS EXISTENTES NO JOGO (estas são TODAS as opções possíveis — nunca cite algo fora desta lista):\n'+
        '- Suspeitos: '+SUSPEITOS.join(', ')+'\n'+
        '- Armas: '+ARMAS.join(', ')+'\n'+
        '- Cômodos: '+LOCAIS.join(', ')+'\n\n'+
        'SUAS CARTAS (você tem na mão — são certeza de que NÃO são a resposta):\n'+
        mao+'\n\n'+
        'CARTAS QUE OUTROS JOGADORES TE MOSTRARAM (também certeza de que NÃO são a resposta):\n'+
        mostradas+'\n\n'+
        'CANDIDATOS AINDA EM ABERTO (cálculo automático com base nas suas cartas, cartas mostradas, notas e registro):\n'+
        '- Suspeitos em aberto: '+candidatos.suspeito.texto+'\n'+
        '- Armas em aberto: '+candidatos.arma.texto+'\n'+
        '- Cômodos em aberto: '+candidatos.local.texto+'\n\n'+
        'REGISTRO DA PARTIDA (em ordem cronológica, do mais antigo ao mais recente):\n'+
        logTexto;
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
          'Você é o assistente pessoal de UM jogador num jogo de dedução estilo Detetive/Clue.\n'+
          'Você NÃO sabe e NUNCA deve tentar adivinhar a resposta do caso.\n'+
          'Trabalhe SOMENTE com os dados fornecidos abaixo — não invente dados, nomes, porcentagens nem combinações.\n\n'+
          'REGRAS OBRIGÁRIAS (violação = resposta errada):\n'+
          '1. Use SOMENTE os nomes exatos das listas fornecidas. NUNCA cite algo fora delas.\n'+
          '2. NUNCA escreva "etc", "entre outros" ou resuma listas — sempre liste tudo.\n'+
          '3. As porcentagens e probabilidades já estão calculadas nos dados. NÃO recalcule — use-as como estão.\n'+
          '4. NÃO explique regras do jogo. Foque 100% no estado atual desta partida.\n'+
          '5. Responda em português, em tópicos curtos ("- " no início de cada item).\n'+
          '6. Se o registro tiver poucos eventos, seja breve e diga que falta informação.\n'+
          '7. NUNCA invente cartas mostradas, sugestões de outros jogadores ou eventos que não estejam no registro.\n\n';

        var instrucaoEspecifica = kind==='resumo'
          ? 'RESUMO DO ESTADO ATUAL:\n'+
            '- Liste o que já foi eliminado (cartas que você tem + cartas que te mostraram).\n'+
            '- Liste os candidatos em aberto por categoria, usando as porcentagens fornecidas.\n'+
            '- Se houver eventos relevantes no registro (ex: "ninguém mostrou carta quando X foi sugerido"), cite-os como fatos — não como opinião.\n'+
            '- Seja direto e conciso.'
          : 'INSIGHTS E SUGESTÕES:\n'+
            '1) RANKING de até 5 combinações (suspeito + arma + cômodo) mais prováveis. Use as porcentagens por categoria já calculadas — multiplique as porcentagens de cada categoria pra estimar a chance de cada combinação.\n'+
            '2) MELHOR PRÓXIMA SUGESTÃO: qual trio (suspeito + arma + cômodo) testar agora, com motivo direto baseado nos dados.\n'+
            '3) Se o registro tiver sugestões de outros jogadores onde ninguém mostrou carta, aponte isso como sinal forte de que essas cartas podem ser a resposta.\n'+
            '4) Se faltar informação pra alguma conclusão, diga isso em uma linha — não invente.';

        limparResultados();

        var prompt = instrucaoBase + instrucaoEspecifica + '\n\nDADOS:\n' + blocoDados;

        if(!GROQ_API_KEY || GROQ_API_KEY === 'COLOQUE_SUA_CHAVE_AQUI'){
          carregando = null;
          var msg = '<div class="ia-erro">Configure sua chave da Groq no topo do arquivo assistant.js (variável GROQ_API_KEY) para usar o assistente.</div>';
          contentEl.innerHTML = msg;
          setTimeout(render, 50);
          return;
        }

        var titulos = { resumo: '📋 Resumo dos meus dados', insights: '💡 Insights e sugestões' };

        fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
          body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0.2,
            messages: [
              { role: 'system', content: 'Você é um assistente de um jogo de dedução. Responda SOMENTE com base nos dados fornecidos. NUNCA invente nomes, porcentagens ou eventos. Use SOMENTE os nomes exatos das listas dadas. Formate em tópicos curtos em português.' },
              { role: 'user', content: prompt }
            ]
          })
        }).then(function(r){ return r.json(); })
          .then(function(data){
            var texto = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            var tituloHtml = '<div class="ia-bloco-titulo">' + (titulos[kind] || '') + '</div>';
            var respostaHtml = tituloHtml + avisoHtml + formatarRespostaIA(texto || '');
            salvarResultado('atual', respostaHtml);
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
