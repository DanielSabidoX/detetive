/**
 * suspense_music_v2.js
 * Trilha ambiente instrumental sombria/suspense gerada em tempo real.
 * Versão limpa: sem chiado (white noise), drones sutis e sinos cristalinos.
 *
 * Uso:
 *   <script src="suspense_music_v2.js"></script>
 *   <script>addSuspenseMusic({ volume: 0.35 });</script>
 */
(function () {
  'use strict';

  let audioCtx = null;
  let masterGain = null;
  let activeNodes = [];
  let isPlaying = false;
  let bellTimer = null;
  let startedByUser = false;
  let buttonEl = null;

  function createContext() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(audioCtx.destination);
    return audioCtx;
  }

  function drone(ctx, freq, type, volume, pan = 0) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08 + Math.random() * 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);

    const stereoPanner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (stereoPanner) stereoPanner.pan.value = pan;

    osc.connect(gain);
    if (stereoPanner) {
      gain.connect(stereoPanner);
      stereoPanner.connect(masterGain);
    } else {
      gain.connect(masterGain);
    }

    osc.start(ctx.currentTime);
    lfo.start(ctx.currentTime);
    activeNodes.push(osc, lfo, lfoGain, gain);
    if (stereoPanner) activeNodes.push(stereoPanner);
  }

  function bell(ctx) {
    const now = ctx.currentTime;
    const baseFreq = 220 + Math.random() * 220 - 110; // 110–330 Hz

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = baseFreq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 5);

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.45;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.55;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    gain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    feedback.connect(masterGain);

    osc.start(now);
    osc.stop(now + 5.2);

    activeNodes.push(osc, filter, gain, delay, feedback);
  }

  function scheduleBell() {
    if (!audioCtx || !isPlaying) return;
    bell(audioCtx);
    const nextMs = 1800 + Math.random() * 2700; // 1.8s a 4.5s
    bellTimer = setTimeout(scheduleBell, nextMs);
  }

  function start() {
    if (isPlaying) return;
    const ctx = createContext();
    if (!ctx) return;

    isPlaying = true;
    startedByUser = true;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    activeNodes = [];

    // Drones graves e sutis (sem sawtooth, sem ruído branco)
    drone(ctx, 46.25, 'triangle', 0.05, -0.2);
    drone(ctx, 69.30, 'triangle', 0.03, 0.2);
    drone(ctx, 92.50, 'sine', 0.025, 0);

    // Sinos cristalinos frequentes
    scheduleBell();

    updateButton();
  }

  function stop() {
    if (!isPlaying) return;
    isPlaying = false;
    startedByUser = false;

    if (bellTimer) {
      clearTimeout(bellTimer);
      bellTimer = null;
    }

    if (audioCtx && masterGain) {
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    }

    setTimeout(() => {
      activeNodes.forEach(function (n) {
        if (typeof n.stop === 'function') {
          try { n.stop(); } catch (e) {}
        }
        if (typeof n.disconnect === 'function') {
          try { n.disconnect(); } catch (e) {}
        }
      });
      activeNodes = [];
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.suspend();
      }
    }, 1600);

    updateButton();
  }

  function toggle() {
    if (isPlaying) stop();
    else start();
  }

  function setVolume(value) {
    if (!masterGain || !audioCtx) return;
    const clamped = Math.max(0, Math.min(1, value));
    masterGain.gain.setTargetAtTime(clamped * 0.5, audioCtx.currentTime, 0.1);
  }

  function updateButton() {
    if (!buttonEl) return;
    buttonEl.textContent = isPlaying ? '♪ música: on' : '♪ música: off';
    buttonEl.setAttribute('aria-pressed', String(isPlaying));
    buttonEl.setAttribute('aria-label', isPlaying ? 'Pausar música de suspense' : 'Tocar música de suspense');
  }

  function createButton() {
    if (buttonEl) return buttonEl;
    buttonEl = document.createElement('button');
    buttonEl.id = 'suspense-music-toggle';
    buttonEl.textContent = '♪ música: off';
    buttonEl.setAttribute('aria-pressed', 'false');
    buttonEl.setAttribute('aria-label', 'Tocar música de suspense');
    buttonEl.style.cssText = [
      'position: fixed',
      'bottom: 18px',
      'right: 18px',
      'z-index: 9999',
      'padding: 10px 16px',
      'border-radius: 999px',
      'border: 1px solid rgba(255,255,255,0.15)',
      'background: rgba(15,23,42,0.85)',
      'color: #e2e8f0',
      'font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 14px',
      'cursor: pointer',
      'backdrop-filter: blur(6px)',
      'box-shadow: 0 4px 12px rgba(0,0,0,0.35)',
      'transition: transform 0.15s ease, background 0.15s ease'
    ].join(';');

    buttonEl.addEventListener('mouseenter', function () {
      buttonEl.style.background = 'rgba(30,41,59,0.9)';
    });
    buttonEl.addEventListener('mouseleave', function () {
      buttonEl.style.background = 'rgba(15,23,42,0.85)';
    });
    buttonEl.addEventListener('mousedown', function () {
      buttonEl.style.transform = 'scale(0.96)';
    });
    buttonEl.addEventListener('mouseup', function () {
      buttonEl.style.transform = 'scale(1)';
    });
    buttonEl.addEventListener('click', function () {
      toggle();
    });

    document.body.appendChild(buttonEl);
    return buttonEl;
  }

  function handleFirstInteraction() {
    if (!startedByUser) return;
    const ctx = createContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    window.removeEventListener('click', handleFirstInteraction);
    window.removeEventListener('keydown', handleFirstInteraction);
    window.removeEventListener('touchstart', handleFirstInteraction);
  }

  function handleVisibility() {
    if (document.hidden) {
      if (isPlaying) {
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.suspend();
        }
      }
    } else {
      if (isPlaying && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }
  }

  window.addSuspenseMusic = function (options) {
    options = options || {};
    createButton();
    if (typeof options.volume === 'number') {
      setVolume(options.volume);
    }

    // Aguarda interação do usuário para liberar o áudio no navegador.
    window.addEventListener('click', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { once: true });

    // Pausa automaticamente quando a aba fica oculta.
    document.addEventListener('visibilitychange', handleVisibility);
  };
})();
