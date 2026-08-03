/* ============================================================
   Dice Sound PRO v2
   Som profissional de dado usando Web Audio API

   Uso:

   <script src="dice.js"></script>
   <script src="dice_sound.js"></script>

   <script>
      addDiceSound('#dado');
   </script>
============================================================ */

(function () {

let ctx=null;

function audio(){

    if(!ctx){

        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC) return null;

        ctx=new AC();

    }

    if(ctx.state==="suspended")
        ctx.resume();

    return ctx;

}

//------------------------------------------------------------
// Pink Noise
//------------------------------------------------------------

function pinkNoiseBuffer(ac,seconds=2){

    const length=ac.sampleRate*seconds;

    const buffer=ac.createBuffer(1,length,ac.sampleRate);

    const out=buffer.getChannelData(0);

    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;

    for(let i=0;i<length;i++){

        const white=Math.random()*2-1;

        b0=0.99886*b0+white*0.0555179;
        b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520;
        b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522;
        b5=-0.7616*b5-white*0.0168980;

        out[i]=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11;

        b6=white*0.115926;
    }

    return buffer;

}

//------------------------------------------------------------
// Saturação suave
//------------------------------------------------------------

function makeDistortionCurve(amount){

    const k=amount||8;
    const n=44100;

    const curve=new Float32Array(n);

    for(let i=0;i<n;i++){

        const x=i*2/n-1;

        curve[i]=((3+k)*x*20*Math.PI/180)/(Math.PI+k*Math.abs(x));

    }

    return curve;

}

//------------------------------------------------------------
// Impacto do dado
//------------------------------------------------------------

function click(ac,when,gainValue){

    const src=ac.createBufferSource();

    src.buffer=pinkNoiseBuffer(ac,0.10);

    src.playbackRate.value=0.9+Math.random()*0.25;

    const bp1=ac.createBiquadFilter();
    bp1.type="bandpass";
    bp1.frequency.value=700+Math.random()*350;
    bp1.Q.value=2.5;

    const bp2=ac.createBiquadFilter();
    bp2.type="bandpass";
    bp2.frequency.value=1700+Math.random()*600;
    bp2.Q.value=2;

    const mix=ac.createGain();

    const g=ac.createGain();

    g.gain.setValueAtTime(gainValue,when);

    g.gain.exponentialRampToValueAtTime(
        0.0001,
        when+0.05+Math.random()*0.03
    );

    src.connect(bp1);
    src.connect(bp2);

    bp1.connect(mix);
    bp2.connect(mix);

    mix.connect(g);
    g.connect(ac.destination);

    src.start(when);
    src.stop(when+0.10);

}

//------------------------------------------------------------

window.addDiceSound=function(target){

    const el=typeof target==="string"
        ?document.querySelector(target)
        :target;

    if(!el) return;

    const dice=el.querySelector(".dice");
    const resultEl=el.querySelector(".dice-result");

    if(!dice) return;

    let playing=false;

    let rumble;
    let rumbleGain;
    let lp;
    let interval;
    let clickTimer;
    let safety;

    //--------------------------------------------------------

    function start(){

        if(playing) return;

        const ac=audio();

        if(!ac) return;

        playing=true;

        rumble=ac.createBufferSource();
        rumble.buffer=pinkNoiseBuffer(ac,3);
        rumble.loop=true;

        lp=ac.createBiquadFilter();
        lp.type="lowpass";
        lp.frequency.value=500;

        const hp=ac.createBiquadFilter();
        hp.type="highpass";
        hp.frequency.value=70;

        const shaper=ac.createWaveShaper();
        shaper.curve=makeDistortionCurve(8);
        shaper.oversample="4x";

        const compressor=ac.createDynamicsCompressor();

        compressor.threshold.value=-18;
        compressor.knee.value=20;
        compressor.ratio.value=6;
        compressor.attack.value=0.003;
        compressor.release.value=0.25;

        rumbleGain=ac.createGain();

        rumbleGain.gain.setValueAtTime(
            0.0001,
            ac.currentTime
        );

        rumbleGain.gain.exponentialRampToValueAtTime(
            0.045,
            ac.currentTime+0.15
        );

        rumble
            .connect(lp)
            .connect(hp)
            .connect(shaper)
            .connect(compressor)
            .connect(rumbleGain)
            .connect(ac.destination);

        rumble.start();

        //----------------------------------------------------
        // movimento do rumble
        //----------------------------------------------------

        interval=setInterval(function(){

            lp.frequency.setTargetAtTime(
                320+Math.random()*280,
                ac.currentTime,
                0.05
            );

        },40);

        //----------------------------------------------------
        // impactos
        //----------------------------------------------------

        (function impacts(){

            if(!playing) return;

            click(
                ac,
                ac.currentTime,
                0.10+Math.random()*0.08
            );

            clickTimer=setTimeout(
                impacts,
                55+Math.random()*95
            );

        })();

        clearTimeout(safety);

        safety=setTimeout(stop,8000);

    }

    //--------------------------------------------------------

    function stop(){

        if(!playing) return;

        playing=false;

        clearInterval(interval);
        clearTimeout(clickTimer);
        clearTimeout(safety);

        const ac=audio();

        lp.frequency.exponentialRampToValueAtTime(
            120,
            ac.currentTime+0.40
        );

        rumbleGain.gain.cancelScheduledValues(
            ac.currentTime
        );

        rumbleGain.gain.setValueAtTime(
            rumbleGain.gain.value||0.04,
            ac.currentTime
        );

        rumbleGain.gain.exponentialRampToValueAtTime(
            0.0001,
            ac.currentTime+0.42
        );

        try{

            rumble.stop(ac.currentTime+0.45);

        }catch(e){}

        // impactos finais

        click(ac,ac.currentTime+0.02,0.18);
        click(ac,ac.currentTime+0.10,0.10);

    }

    //--------------------------------------------------------

    new MutationObserver(function(){

        if(dice.classList.contains("rolling"))
            start();

    }).observe(dice,{
        attributes:true,
        attributeFilter:["class"]
    });

    //--------------------------------------------------------

    if(resultEl){

        new MutationObserver(function(){

            if(/Resultado/i.test(resultEl.textContent||""))
                stop();

        }).observe(resultEl,{
            childList:true,
            characterData:true,
            subtree:true
        });

    }

    //--------------------------------------------------------

    window.addEventListener(
        "pointerdown",
        function(){
            audio();
        },
        {once:true}
    );

};

})();