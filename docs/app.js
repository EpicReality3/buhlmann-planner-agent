(function(){'use strict';
const SURFACE=1.01325,PH2O=0.0627,BAR_PER_M=0.1,LN2=Math.log(2);
const HT_N2=[5,8,12.5,18.5,27,38.3,54.3,77,109,146,187,239,305,390,498,635];
const HT_HE=[1.88,3.02,4.72,6.99,10.21,14.48,20.53,29.11,41.2,55.19,70.69,90.34,115.29,147.42,188.24,240.03];
const A_N2=[1.1696,1.0,0.8618,0.7562,0.6667,0.5933,0.5282,0.4701,0.4187,0.3798,0.3497,0.3223,0.2971,0.2737,0.2523,0.2327];
const B_N2=[0.5578,0.6514,0.7222,0.7825,0.8126,0.8434,0.8693,0.891,0.9092,0.9222,0.9319,0.9403,0.9477,0.9544,0.9602,0.9653];
const A_HE=[1.6189,1.383,1.1919,1.0458,0.922,0.8205,0.7305,0.6502,0.595,0.5545,0.5333,0.5189,0.5181,0.5176,0.5172,0.5119];
const B_HE=[0.477,0.5747,0.6527,0.7223,0.7582,0.7957,0.8279,0.8553,0.8757,0.8903,0.8997,0.9073,0.9122,0.9171,0.9217,0.9267];
const STOP_STEP=3,ASCENT_RATE=9;
const pAmb=d=>SURFACE+d*BAR_PER_M,pinsp=(p,f)=>Math.max(0,(p-PH2O)*f);
function initT(){return{pN2:HT_N2.map(()=>pinsp(SURFACE,0.79)),pHe:HT_HE.map(()=>0)}}
function updConst(s,d,g,min){const p=pAmb(d),n=pinsp(p,g.FN2),h=pinsp(p,g.FHe);
 for(let i=0;i<s.pN2.length;i++){const kN2=LN2/HT_N2[i],kHe=LN2/HT_HE[i];
  s.pN2[i]+= (n-s.pN2[i])*(1-Math.exp(-kN2*min));
  s.pHe[i]+= (h-s.pHe[i])*(1-Math.exp(-kHe*min));}}
function ceilComp(n,h,gf,i){const sum=Math.max(1e-9,n+h);
 const a=(A_N2[i]*n+A_HE[i]*h)/sum,b=(B_N2[i]*n+B_HE[i]*h)/sum,pt=n+h;
 const pAmbMin=(pt-a*gf)/(b*gf); return Math.max(0,(pAmbMin-SURFACE)/BAR_PER_M);}
function ceilAll(s,gf){let w=0; for(let i=0;i<s.pN2.length;i++){const c=ceilComp(s.pN2[i],s.pHe[i],gf,i); if(c>w)w=c;} return w;}
function gfAtDepth(d,gfL,gfH,fc){const fs=Math.ceil(fc/STOP_STEP)*STOP_STEP; if(fs<=0)return gfH;
 const frac=Math.max(0,Math.min(1,1-d/fs)); return gfL+(gfH-gfL)*frac;}
function planDive(depth,tbt,gas,gfLpc,gfHpc,opt){
 const gfL=gfLpc/100,gfH=gfHpc/100,last=(opt&&opt.lastStopDepth)||3,minLast=Math.max(0,Math.floor((opt&&opt.minLastStopMinutes)||0));
 const st=initT(); updConst(st,depth,gas,tbt); const fc=ceilAll(st,gfL);
 const stops=[]; let cur=depth,tts=0;
 if(cur>last){let m=Math.ceil((cur-last)/ASCENT_RATE); for(let i=0;i<m;i++){const nd=Math.max(cur-ASCENT_RATE,last); updConst(st,nd,gas,1); cur=nd; tts++;}}
 let held=0; while(true){const gf=gfAtDepth(cur,gfL,gfH,fc),c=ceilAll(st,gf),need=c>0||held<minLast; if(!need)break; updConst(st,cur,gas,1); held++; tts++; if(held>360)break;}
 if(held>0) stops.push({depth:cur,time:held,gf:gfAtDepth(cur,gfL,gfH,fc)});
 if(cur>0){let m=Math.ceil(cur/ASCENT_RATE); for(let i=0;i<m;i++){const nd=Math.max(cur-ASCENT_RATE,0); updConst(st,nd,gas,1); cur=nd; tts++;}}
 return {firstStopDepth:stops.length?stops[0].depth:0,stops,tts:Math.round(tts*10)/10};}
const $=id=>document.getElementById(id);
function render(p){let h=`<p><b>TTS</b> : ${p.tts} min</p><table><thead><tr><th>Stop (m)</th><th>Durée (min)</th><th>GF</th></tr></thead><tbody>`;
 if(!p.stops.length)h+='<tr><td colspan="3">Aucun palier obligatoire</td></tr>';
 p.stops.forEach(s=>h+=`<tr><td>${s.depth}</td><td>${s.time}</td><td>${Math.round(s.gf*100)}%</td></tr>`); h+='</tbody></table>'; $('out').innerHTML=h;}
function compute(){const d=+$('depth').value,t=+$('tbt').value,FO2=(+$('fo2').value)/100,FHe=(+$('fhe').value)/100,FN2=1-FO2-FHe,gfl=+$('gfl').value,gfh=+$('gfh').value;
 const opt={lastStopDepth:$('last6').checked?6:3,minLastStopMinutes:+$('minLast').value|0};
 render(planDive(d,t,{FO2,FHe,FN2},gfl,gfh,opt));}
function selfTest(){
 const approx=(a,b,t)=>Math.abs(a-b)<=t, t1=approx((1.0-PH2O)*0.79,0.7405,0.02), t2=approx((4.0-PH2O)*0.79,3.1105,0.03), t3=approx((5.0-PH2O)*0.79,3.9005,0.03);
 const okSan=t1&&t2&&t3;
 const p1=planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:3,minLastStopMinutes:1});
 const ok1=p1.stops.length&&p1.stops.at(-1).depth===3&&p1.stops.at(-1).time>=1;
 const p2=planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:6,minLastStopMinutes:1});
 const ok2=p2.stops.length&&p2.stops.at(-1).depth===6&&p2.stops.at(-1).time>=2;
 const p3=planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:3,minLastStopMinutes:0});
 const ok3=!p3.stops.length||p3.stops.every(s=>s.time===0);
 $('out').innerHTML=`<p><b>Self-Test</b> : ${(okSan&&ok1&&ok2&&ok3)?'✅ OK':'❌ Échec'}</p>`;
}
document.getElementById('go').addEventListener('click',compute);
document.getElementById('selftest').addEventListener('click',selfTest);
})();
