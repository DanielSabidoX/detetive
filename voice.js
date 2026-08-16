/* =========================================================================
   voice.js — Conversa por áudio em tempo real (WebRTC mesh + Firestore)
   Arquivo totalmente independente: não altera nenhuma outra funcionalidade.
   Usa apenas:
     - localStorage 'casoArquivado_session_v1'  -> { code, pid, name }
     - coleção Firestore 'voice_rooms'          -> exclusiva deste módulo
   API: window.mountVoice('#voz-painel')
   ========================================================================= */
(function(){
  'use strict';

  var SESSION_KEY = 'casoArquivado_session_v1';
  var COL = 'voice_rooms';
  var HEARTBEAT_MS = 8000;
  var STALE_MS = 25000;

  var ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  };

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }catch(e){ return null; }
  }
  function now(){ return Date.now(); }

  window.mountVoice = function(target){
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if(!host) return;

    host.innerHTML =
      '<div class="voz-handle">'+
        '<div class="voz-title">Voz da mesa</div>'+
        '<button type="button" class="voz-toggle">–</button>'+
      '</div>'+
      '<div class="voz-body">'+
        '<div class="voz-actions">'+
          '<button type="button" class="voz-btn voz-join">Entrar na voz</button>'+
          '<button type="button" class="voz-btn voz-mute" hidden>Mutar</button>'+
        '</div>'+
        '<div class="voz-status">Sem sala ativa</div>'+
        '<div class="voz-peers"></div>'+
      '</div>';

    var joinBtn = host.querySelector('.voz-join');
    var muteBtn = host.querySelector('.voz-mute');
    var statusEl= host.querySelector('.voz-status');
    var peersEl = host.querySelector('.voz-peers');

    var handle  = host.querySelector('.voz-handle');
    var toggleBtn = host.querySelector('.voz-toggle');

    // ---------- botão "–" fecha o painel e volta pra barra de abas ----------
    toggleBtn.addEventListener('click', function(){
      if(typeof window.closePanelNav === 'function') window.closePanelNav();
    });

    var roomCode = null;     // sala do jogo em que estamos
    var myId = null, myName = '';
    var joined = false;
    var muted = false;
    var localStream = null;
    var peers = {};          // pid -> { pc, audio, name }
    var known = {};          // pid -> {name, muted}
    var unsubPeers = null, unsubSignals = null;
    var hbTimer = null;

    function ready(){ return typeof db !== 'undefined' && db; }
    function roomRef(){ return db.collection(COL).doc(roomCode); }
    function peersRef(){ return roomRef().collection('peers'); }
    function signalsRef(){ return roomRef().collection('signals'); }

    function setStatus(txt){ statusEl.textContent = txt; }

    function renderPeers(){
      var ids = Object.keys(known).filter(function(id){ return id !== myId; });
      if(!joined){ peersEl.innerHTML = ''; return; }
      if(!ids.length){ peersEl.innerHTML = '<div class="voz-peer">Ninguém mais na voz</div>'; return; }
      peersEl.innerHTML = ids.map(function(id){
        var p = known[id] || {};
        return '<div class="voz-peer"><span class="voz-dot'+(p.muted?' off':'')+'"></span>'+
               (p.name || 'Jogador') + (p.muted ? ' (mudo)' : '') + '</div>';
      }).join('');
    }

    // ---------------- sinalização ----------------
    function send(to, type, data){
      if(!ready() || !roomCode) return;
      signalsRef().add({
        from: myId, to: to, type: type,
        data: JSON.stringify(data || null),
        ts: now()
      }).catch(function(e){ console.warn('[voz] envio falhou', e && e.message); });
    }

    function getPeer(id, name){
      if(peers[id]) return peers[id];
      var pc = new RTCPeerConnection(ICE);
      var audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);

      var entry = { pc: pc, audio: audio, name: name || '', making: false, polite: myId > id };
      peers[id] = entry;

      if(localStream){
        localStream.getTracks().forEach(function(t){ pc.addTrack(t, localStream); });
      }

      pc.onicecandidate = function(ev){
        if(ev.candidate) send(id, 'ice', ev.candidate.toJSON());
      };
      pc.ontrack = function(ev){
        audio.srcObject = ev.streams[0];
        audio.play().catch(function(){});
      };
      pc.onconnectionstatechange = function(){
        if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){
          closePeer(id);
        }
      };
      return entry;
    }

    function closePeer(id){
      var p = peers[id];
      if(!p) return;
      try{ p.pc.close(); }catch(e){}
      if(p.audio && p.audio.parentNode) p.audio.parentNode.removeChild(p.audio);
      delete peers[id];
    }

    function callPeer(id, name){
      var entry = getPeer(id, name);
      // apenas o de id "menor" inicia a oferta, evitando colisão
      if(!(myId < id)) return;
      entry.pc.createOffer()
        .then(function(offer){ return entry.pc.setLocalDescription(offer); })
        .then(function(){ send(id, 'offer', entry.pc.localDescription); })
        .catch(function(e){ console.warn('[voz] offer', e && e.message); });
    }

    function handleSignal(msg){
      var id = msg.from;
      var data = null;
      try{ data = msg.data ? JSON.parse(msg.data) : null; }catch(e){ return; }
      var entry = getPeer(id, (known[id] && known[id].name) || '');
      var pc = entry.pc;

      if(msg.type === 'offer'){
        pc.setRemoteDescription(new RTCSessionDescription(data))
          .then(function(){ return pc.createAnswer(); })
          .then(function(a){ return pc.setLocalDescription(a); })
          .then(function(){ send(id, 'answer', pc.localDescription); })
          .catch(function(e){ console.warn('[voz] answer', e && e.message); });
      } else if(msg.type === 'answer'){
        if(pc.signalingState === 'have-local-offer'){
          pc.setRemoteDescription(new RTCSessionDescription(data))
            .catch(function(e){ console.warn('[voz] set answer', e && e.message); });
        }
      } else if(msg.type === 'ice'){
        pc.addIceCandidate(new RTCIceCandidate(data)).catch(function(){});
      } else if(msg.type === 'bye'){
        closePeer(id);
      }
    }

    // ---------------- entrar / sair ----------------
    function join(){
      if(joined || !roomCode || !ready()) return;
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        setStatus('Navegador sem suporte a microfone.');
        return;
      }
      setStatus('Pedindo acesso ao microfone…');
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false })
        .then(function(stream){
          localStream = stream;
          joined = true;
          muted = false;
          applyMute();
          joinBtn.textContent = 'Sair da voz';
          joinBtn.classList.add('on');
          muteBtn.hidden = false;
          setStatus('Conectado — sala ' + roomCode);
          announce();
          listen();
          hbTimer = setInterval(announce, HEARTBEAT_MS);
        })
        .catch(function(e){
          console.warn('[voz] microfone', e && e.message);
          setStatus('Microfone bloqueado. Libere a permissão e tente de novo.');
        });
    }

    function announce(){
      if(!joined || !roomCode) return;
      peersRef().doc(myId).set({ name: myName, muted: muted, ts: now() }, { merge:true })
        .catch(function(e){ console.warn('[voz] presença', e && e.message); });
    }

    function listen(){
      stopListening();
      unsubPeers = peersRef().onSnapshot(function(snap){
        var seen = {};
        snap.forEach(function(doc){
          var d = doc.data() || {};
          if(!d.ts || (now() - d.ts) > STALE_MS) return;
          seen[doc.id] = true;
          known[doc.id] = { name: d.name || 'Jogador', muted: !!d.muted };
          if(doc.id !== myId && joined && !peers[doc.id]) callPeer(doc.id, d.name);
        });
        Object.keys(known).forEach(function(id){
          if(!seen[id]){ delete known[id]; closePeer(id); }
        });
        renderPeers();
      }, function(e){ console.warn('[voz] presença listen', e && e.message); });

      unsubSignals = signalsRef().where('to', '==', myId).onSnapshot(function(snap){
        snap.docChanges().forEach(function(ch){
          if(ch.type !== 'added') return;
          var msg = ch.doc.data() || {};
          if(joined && msg.from && msg.from !== myId) handleSignal(msg);
          ch.doc.ref.delete().catch(function(){});
        });
      }, function(e){ console.warn('[voz] sinais listen', e && e.message); });
    }

    function stopListening(){
      if(unsubPeers){ unsubPeers(); unsubPeers = null; }
      if(unsubSignals){ unsubSignals(); unsubSignals = null; }
    }

    function leave(silent){
      if(hbTimer){ clearInterval(hbTimer); hbTimer = null; }
      Object.keys(peers).forEach(function(id){ send(id, 'bye'); closePeer(id); });
      if(localStream){ localStream.getTracks().forEach(function(t){ t.stop(); }); localStream = null; }
      if(joined && roomCode && ready()){
        peersRef().doc(myId).delete().catch(function(){});
      }
      joined = false;
      known = {};
      stopListening();
      joinBtn.textContent = 'Entrar na voz';
      joinBtn.classList.remove('on');
      muteBtn.hidden = true;
      renderPeers();
      if(!silent) setStatus(roomCode ? 'Fora da voz — sala ' + roomCode : 'Sem sala ativa');
    }

    function applyMute(){
      if(localStream){
        localStream.getAudioTracks().forEach(function(t){ t.enabled = !muted; });
      }
      muteBtn.textContent = muted ? 'Desmutar' : 'Mutar';
      muteBtn.classList.toggle('muted', muted);
      announce();
    }

    joinBtn.addEventListener('click', function(){
      if(joined) leave(); else join();
    });
    muteBtn.addEventListener('click', function(){
      muted = !muted;
      applyMute();
    });

    // ---------------- acompanhar a sessão do jogo ----------------
    function checkSession(){
      var s = getSession();
      var code = s && s.code ? s.code : null;
      var pid  = s && s.pid ? String(s.pid) : null;
      if(code !== roomCode || pid !== myId){
        if(joined) leave(true);
        roomCode = code;
        myId = pid;
        myName = (s && s.name) || 'Jogador';
        if(roomCode && myId){
          setStatus('Sala ' + roomCode + ' — clique para entrar na voz');
          joinBtn.disabled = false;
          host.style.display = '';
        }else{
          setStatus('Sem sala ativa');
          joinBtn.disabled = true;
          host.style.display = 'none';
        }
      }
    }

    checkSession();
    setInterval(checkSession, 1500);
    window.addEventListener('beforeunload', function(){ leave(true); });
  };
})();
