/* ===== Arrastar o dado pela tela =====
   Adicione DEPOIS do dice_v3.js e depois do mountDice():
   <script src="dado/dice_drag.js"></script>
   <script>makeDiceDragable('#dado');</script>  */
(function(){
  var POS_KEY = 'casoArquivado_dado_pos_v1';

  window.makeDiceDraggable = function(target){
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if(!el) return;

    // restaura posicao salva
    try{
      var p = JSON.parse(localStorage.getItem(POS_KEY));
      if(p && typeof p.left === 'number'){
        el.style.left = p.left + 'px';
        el.style.top  = p.top  + 'px';
        el.style.right = 'auto';
      }
    }catch(e){}

    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;

    function down(e){
      // nao arrasta quando clica no botao (deixa o clique funcionar)
      if(e.target.closest('.dice-btn')) return;
      var r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top  = r.top  + 'px';
      el.style.right = 'auto';
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      el.classList.add('dragging');
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    }

    function move(e){
      if(!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      var w = el.offsetWidth, h = el.offsetHeight;
      var left = Math.min(Math.max(0, ox + dx), window.innerWidth  - w);
      var top  = Math.min(Math.max(0, oy + dy), window.innerHeight - h);
      el.style.left = left + 'px';
      el.style.top  = top  + 'px';
    }

    function up(){
      if(!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      try{
        localStorage.setItem(POS_KEY, JSON.stringify({
          left: parseFloat(el.style.left) || 0,
          top:  parseFloat(el.style.top)  || 0
        }));
      }catch(e){}
      // se arrastou, cancela o clique que rolaria o dado
      if(moved){
        var block = function(ev){ ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', block, true);
        setTimeout(function(){ el.removeEventListener('click', block, true); }, 0);
      }
    }

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
})();
