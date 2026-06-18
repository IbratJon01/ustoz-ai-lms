import React, { useState, useEffect, useRef, useCallback } from "react";

// ═══ PROMPTS ══════════════════════════════════════════════
const CHAT_SYS = `You are "USTOZ AI" — professional Russian language teacher for Uzbek speakers.
USER PROFILE: {{PROFILE}}  MODULE: {{MODULE}}
RULES: Explain in Uzbek only. Russian sentences always with Uzbek translation (except Speaking mode).
GRAMMAR: 📌Mavzu→📝Tushuntirish(Uzbek)→📐Qoida→✅8 misol(RU+UZ)→🎯5 mashq. STOP after tasks.
WRITING: Task→wait→Baho:X/100|❌Xatolar|✅To'g'ri variant
DASHBOARD onboarding(isNew=true): ONE question at a time(5 total)→assign level A1-C2→plan.
DASHBOARD coach: 30-60min daily plan with specific topics.`;

// ═══ CONFIG ════════════════════════════════════════════════
const MODS = [
  {id:"grammar",  label:"Grammatika",  icon:"📚",color:"#7C3AED",light:"#EDE9FE",border:"#C4B5FD",desc:"Grammatika va qoidalar",  type:"chat"  },
  {id:"speaking", label:"So'zlashish", icon:"🗣️",color:"#0891B2",light:"#E0F2FE",border:"#7DD3FC",desc:"Ovozli suhbat",           type:"speak" },
  {id:"listening",label:"Eshitish",    icon:"🎧",color:"#9333EA",light:"#F3E8FF",border:"#D8B4FE",desc:"Adaptive audio + so'z banki",type:"listen"},
  {id:"reading",  label:"O'qish",      icon:"📖",color:"#059669",light:"#D1FAE5",border:"#6EE7B7",desc:"Matn + so'z tarjimasi",   type:"read"  },
  {id:"writing",  label:"Yozish",      icon:"✍️",color:"#DC2626",light:"#FEE2E2",border:"#FCA5A5",desc:"Yozma nutq",              type:"chat"  },
];
const DASH={id:"dashboard",label:"Dashboard",icon:"🏠",color:"#D97706",light:"#FEF3C7",border:"#FCD34D"};
const LC={A1:"#0891B2",A2:"#0284C7",B1:"#059669",B2:"#D97706",C1:"#7C3AED",C2:"#DC2626"};
const LEVELS=["A1","A2","B1","B2","C1","C2"];
const INIT={
  grammar:"Grammatika modulini boshlaylik. Darajamga mos birinchi mavzuni tushuntir.",
  writing:"Yozish darsini boshlaylik. Topshiriq ber.",
  dashboard:"Salom! Men yangi o'quvchiman. Darajamni aniqlash uchun birinchi savolni ber.",
};

// ═══ STORAGE ══════════════════════════════════════════════
const safe=async(fn,fb=null)=>{try{return await fn();}catch{return fb;}};
const db={
  getUser:   u      =>safe(async()=>{const r=localStorage.getItem(`u:${u}`);return r?JSON.parse(r):null;}),
  setUser:   (u,d)  =>safe(async()=>{localStorage.setItem(`u:${u}`,JSON.stringify(d));}),
  getProfile:u      =>safe(async()=>{const r=localStorage.getItem(`p:${u}`);return r?JSON.parse(r):null;}),
  setProfile:(u,d)  =>safe(async()=>{localStorage.setItem(`p:${u}`,JSON.stringify(d));}),
  getMsgs:   (u,m)  =>safe(async()=>{const r=localStorage.getItem(`c:${u}:${m}`);return r?JSON.parse(r):null;}),
  setMsgs:   (u,m,d)=>safe(async()=>{localStorage.setItem(`c:${u}:${m}`,JSON.stringify(d.slice(-50)));}),
};
function newProfile(username,name){
  return{username,name,level:"A1",disciplineScore:50,streakDays:1,lastLogin:new Date().toDateString(),
    completedLessons:{grammar:0,speaking:0,listening:0,reading:0,writing:0},
    totalMinutes:0,isNew:true,joinedAt:new Date().toLocaleDateString("uz-UZ"),
    vocabBank:{},
    listeningStats:{totalExercises:0,totalScore:0,lastScore:null,bestScore:0,adaptiveLevel:"A1",consecutiveGood:0,consecutiveBad:0}};
}

// ═══ ADAPTIVE UTILITIES ═══════════════════════════════════
function getAdaptiveLevel(stats,base){return stats?.adaptiveLevel||base||"A1";}
function calcNextLevel(cur,score,cGood,cBad){
  const i=LEVELS.indexOf(cur);
  if(score>=85&&cGood>=2)return LEVELS[Math.min(i+1,LEVELS.length-1)];
  if(score<50&&cBad>=2)return LEVELS[Math.max(i-1,0)];
  return cur;
}
function getUnknownWords(vocabBank,limit=6){
  return Object.entries(vocabBank||{})
    .filter(([,v])=>!v.mastered&&v.missed>0)
    .sort((a,b)=>b[1].missed-a[1].missed)
    .slice(0,limit).map(([w])=>w);
}
function updateVocabBank(bank,clickedWords,exerciseWords){
  const nb={...bank};
  const today=new Date().toISOString().slice(0,10);
  clickedWords.forEach(w=>{
    const k=w.toLowerCase().replace(/[.,!?;:«»]/g,"");
    if(!k||k.length<2)return;
    const prev=nb[k]||{};
    nb[k]={...prev,seen:(prev.seen||0)+1,missed:(prev.missed||0)+1,mastered:false,lastSeen:today};
  });
  // Mark mastered if seen correctly 3+ times without missing
  exerciseWords.forEach(w=>{
    const k=w.toLowerCase().replace(/[.,!?;:«»]/g,"");
    if(nb[k]&&nb[k].missed>0){nb[k].seen=(nb[k].seen||0)+1;}
  });
  return nb;
}

// ═══ TTS (natural Russian) ═════════════════════════════════
function getRuVoice(){
  const vs=window.speechSynthesis?.getVoices()||[];
  return(
    vs.find(v=>v.lang==="ru-RU"&&v.name.toLowerCase().includes("google"))||
    vs.find(v=>v.lang==="ru-RU"&&!v.localService)||
    vs.find(v=>v.lang==="ru-RU"&&v.name.toLowerCase().includes("microsoft"))||
    vs.find(v=>v.lang==="ru-RU")||
    vs.find(v=>v.lang.startsWith("ru"))||null
  );
}
function speakRu(text,rate=0.82,onWord=null,onEnd=null){
  window.speechSynthesis?.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang="ru-RU"; u.rate=rate; u.pitch=1.0;
  const v=getRuVoice(); if(v)u.voice=v;
  if(onWord){
    const ws=text.split(/\s+/);
    u.onboundary=e=>{
      if(e.name==="word"){
        let pos=0;
        for(let i=0;i<ws.length;i++){if(pos>=e.charIndex){onWord(i);break;}pos+=ws[i].length+1;}
      }
    };
  }
  if(onEnd)u.onend=onEnd;
  window.speechSynthesis?.speak(u);
  return u;
}
function stopRu(){window.speechSynthesis?.cancel();}

// ═══ AI CALLS ═════════════════════════════════════════════
function buildMsgs(raw){
  const v=raw.filter(m=>(m.role==="user"||m.role==="assistant")&&m.content?.trim());
  const o=[];
  for(const m of v){if(!o.length&&m.role!=="user")continue;if(o.length&&o[o.length-1].role===m.role)continue;o.push({role:m.role,content:m.content.trim()});}
  return o;
}
async function callAI(msgs,profile,modId){
  const api=buildMsgs(msgs);if(!api.length)throw new Error("Bo'sh xabarlar");
  const label=modId==="dashboard"?"Dashboard Coach":MODS.find(m=>m.id===modId)?.label||modId;
  const sys=CHAT_SYS.replace("{{PROFILE}}",JSON.stringify(profile)).replace("{{MODULE}}",label);
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1200,system:sys,messages:api})});
  if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.error?.message||`Xato ${res.status}`);}
  const d=await res.json();return d.content?.[0]?.text||"Javob kelmadi";
}
async function callJSON(prompt,sysExtra=""){
  const sys=`You generate structured language exercises. Return ONLY valid JSON — no markdown fences, no extra text. ${sysExtra}`;
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1800,system:sys,messages:[{role:"user",content:prompt}]})});
  if(!res.ok)throw new Error(`API ${res.status}`);
  const d=await res.json();const t=d.content?.[0]?.text||"";
  const m=t.match(/\{[\s\S]*\}/);if(!m)throw new Error("JSON format xatosi");
  return JSON.parse(m[0]);
}
async function translateWord(word){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:150,
      system:'Return ONLY JSON: {"translation":"Uzbek meaning","phonetic":"pronunciation","example":"short Russian example"}',
      messages:[{role:"user",content:`Russian word: "${word}"`}]})});
  const d=await res.json();
  try{const m=(d.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):{translation:"—",phonetic:"",example:""};}
  catch{return{translation:"—",phonetic:"",example:""};}
}

// ═══ ADAPTIVE EXERCISE GENERATOR ══════════════════════════
async function generateListeningExercise(profile,unknownWords,adaptiveLevel,mode="normal"){
  const lvlDesc={
    A1:"Very simple: greetings, numbers, family, colors. Short sentences 5-8 words.",
    A2:"Daily routines, shopping, weather, food. Simple past and future. 8-12 word sentences.",
    B1:"Work, travel, hobbies, opinions. Mix of tenses. Natural contractions. 10-15 word sentences.",
    B2:"News, culture, social topics. Phrasal expressions. Nuanced vocabulary. Complex sentences.",
    C1:"Sophisticated discussions, idioms, implicit meaning. Native-speed natural dialogue.",
    C2:"Literary language, sarcasm, cultural references. Full native discourse.",
  };
  const modeInstr=mode==="review"
    ?`FOCUS MODE: Build the exercise around THESE specific words the user struggles with: ${unknownWords.join(", ")}. Use each word at least once naturally in the audioText.`
    :unknownWords.length>0
    ?`Try to naturally incorporate 2-3 of these vocabulary words the user previously missed: ${unknownWords.join(", ")}.`
    :"Choose a practical everyday situation.";

  const prompt=`Generate a Russian listening comprehension exercise.

LEVEL: ${adaptiveLevel}
Level description: ${lvlDesc[adaptiveLevel]||lvlDesc.A1}
${modeInstr}

CRITICAL RULES FOR audioText:
1. Write ONLY in Russian — zero English, Uzbek, or other languages
2. Sound like real native Russians talking naturally in everyday life  
3. Use natural contractions: "что ж", "ну да", "знаешь", "вот", "как-то" etc.
4. Match register to level: informal for A1-B1, more formal/varied for B2-C2
5. Include natural intonation markers through punctuation
6. NEVER use translated words or code-switching

Return this exact JSON structure:
{
  "title": "Situation title in Uzbek (max 6 words)",
  "scenario": "Brief Uzbek context: who, where, what situation (1-2 sentences)",
  "audioText": "Complete Russian text — PURE RUSSIAN ONLY, natural speech",
  "uzbekTranslation": "Accurate complete Uzbek translation of the audioText",
  "grammarPoint": "One grammar insight from this text, explained in Uzbek (1 sentence)",
  "vocab": [
    {"word": "Russian word", "translation": "Uzbek meaning", "phonetic": "stressed syllable marked with CAPS e.g. priVET", "example": ""}
  ],
  "questions": [
    {"id": 1, "q": "Uzbek comprehension question", "answer": "Expected Uzbek answer (1-3 words)", "hint": "short hint if needed"}
  ]
}

Make vocab 5-8 words. Make questions 4-5 total covering: main idea, details, vocabulary in context.`;

  return callJSON(prompt,"Generate natural Russian language exercises for Uzbek learners.");
}

// ═══ SHARED UI ════════════════════════════════════════════
function Txt({text}){
  return(<div>{text.split("\n").map((line,i)=>{
    if(!line.trim())return (<div key={i} style={{height:5}}/>);
    if(line.startsWith("# "))return (<h2 key={i} style={{color:"#4C1D95",fontWeight:800,fontSize:17,margin:"10px 0 4px",fontFamily:"Georgia,serif"}}>{line.slice(2)}</h2>);
    if(line.startsWith("## "))return (<h3 key={i} style={{color:"#6B7280",fontSize:14,margin:"8px 0 3px",fontWeight:700}}>{line.slice(3)}</h3>);
    if(line.startsWith("---"))return (<hr key={i} style={{border:"none",borderTop:"1px solid #E5E7EB",margin:"8px 0"}}/>);
    const p=line.split(/(\*\*[^*]+\*\*)/g);
    return(<div key={i} style={{color:"#374151",fontSize:14,lineHeight:1.85,marginBottom:2}}>{p.map((s,j)=>s.startsWith("**")&&s.endsWith("**")?<strong key={j} style={{color:"#111827"}}>{s.slice(2,-2)}</strong>:s)}</div>);
  })}</div>);
}
function LabeledInput({label,placeholder,type="text",value,onChange,onKeyDown}){
  const ref=useRef();
  return(<div>
    {label&&<label style={{display:"block",fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:5}}>{label}</label>}
    <input ref={ref} type={type} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown}
      onFocus={()=>{if(ref.current)ref.current.style.borderColor="#7C3AED";}}
      onBlur={()=>{if(ref.current)ref.current.style.borderColor="#E5E7EB";}}
      style={{width:"100%",padding:"12px 14px",background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:10,color:"#111827",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",transition:"border-color 0.2s"}}/>
  </div>);
}
function NavBtn({icon,label,active,color,light,border,badge,onClick,highlight}){
  const[h,setH]=useState(false);
  return(<button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
    style={{width:"100%",display:"flex",alignItems:"center",gap:9,padding:"8px 10px",background:active?light:h?"#F9FAFB":"transparent",border:active?`1px solid ${border}`:"1px solid transparent",borderRadius:10,cursor:"pointer",fontFamily:"inherit",marginBottom:2,transition:"all 0.15s",textAlign:"left"}}>
    <span style={{fontSize:15,width:20,textAlign:"center",flexShrink:0}}>{icon}</span>
    <span style={{color:active?color:h?"#374151":"#6B7280",fontSize:13,fontWeight:active?700:500,flex:1}}>{label}</span>
    {highlight&&<span style={{background:"#D97706",color:"#fff",fontSize:8,fontWeight:800,borderRadius:5,padding:"2px 6px"}}>YANGI</span>}
    {!highlight&&badge>0&&<span style={{background:light,color,fontSize:9,fontWeight:800,borderRadius:6,padding:"2px 7px",border:`1px solid ${border}`}}>{badge}</span>}
  </button>);
}
function Bubble({msg,cfg,initial}){
  const u=msg.role==="user";
  return(<div style={{display:"flex",flexDirection:u?"row-reverse":"row",gap:10,alignItems:"flex-start",animation:"fadeUp 0.2s ease"}}>
    <div style={{width:34,height:34,borderRadius:10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:u?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:cfg.light,border:u?"none":`1px solid ${cfg.border}`,color:u?"#fff":cfg.color,fontWeight:800,fontSize:u?14:16}}>{u?initial:cfg.icon}</div>
    <div style={{maxWidth:"80%",background:u?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:"#fff",border:u?"none":"1px solid #E5E7EB",borderRadius:u?"14px 4px 14px 14px":"4px 14px 14px 14px",padding:"12px 16px",boxShadow:u?`0 4px 14px ${cfg.color}30`:"0 2px 8px rgba(0,0,0,0.06)"}}>
      {u?<div style={{color:"#fff",fontSize:14,lineHeight:1.75}}>{msg.content}</div>:<Txt text={msg.content}/>}
    </div>
  </div>);
}
function Dots({cfg}){
  return(<div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
    <div style={{width:34,height:34,borderRadius:10,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{cfg.icon}</div>
    <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:"4px 14px 14px 14px",padding:"13px 18px",display:"flex",gap:5,alignItems:"center"}}>
      {[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:cfg.color,animation:`bounce 1.3s ${j*0.22}s infinite ease-in-out`}}/>)}
    </div>
  </div>);
}

// ═══ WORD TOOLTIP ══════════════════════════════════════════
function WordTooltip({tip,onClose}){
  if(!tip.show)return null;
  const left=Math.min(tip.x,window.innerWidth-240);
  const top=Math.min(tip.y+8,window.innerHeight-180);
  return(<div onClick={e=>e.stopPropagation()} style={{position:"fixed",left,top,background:"#fff",border:"1px solid #E5E7EB",borderRadius:13,padding:"13px 16px",boxShadow:"0 10px 30px rgba(0,0,0,0.14)",zIndex:9999,minWidth:200,maxWidth:260}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
      <span style={{color:"#111827",fontWeight:800,fontSize:17}}>{tip.word}</span>
      <button onClick={onClose} style={{color:"#9CA3AF",background:"none",border:"none",cursor:"pointer",fontSize:16,lineHeight:1,marginLeft:8}}>✕</button>
    </div>
    {tip.phonetic&&<div style={{color:"#9CA3AF",fontSize:11,marginBottom:4}}>[{tip.phonetic}]</div>}
    {tip.loading?<div style={{color:"#9CA3AF",fontSize:13}}>Yuklanmoqda...</div>
      :<div style={{color:"#374151",fontSize:14,fontWeight:600}}>{tip.translation}</div>}
    {tip.example&&<div style={{color:"#9CA3AF",fontSize:11,marginTop:4,fontStyle:"italic"}}>{tip.example}</div>}
    <button onClick={()=>speakRu(tip.word,0.7)} style={{marginTop:9,padding:"5px 12px",background:"#EDE9FE",border:"1px solid #C4B5FD",borderRadius:7,color:"#7C3AED",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🔊 Talaffuz</button>
  </div>);
}

// ═══ AUTH ═════════════════════════════════════════════════
function AuthScreen({onLogin}){
  const[tab,setTab]=useState("login");
  const[name,setName]=useState("");
  const[username,setUsername]=useState("");
  const[password,setPassword]=useState("");
  const[err,setErr]=useState("");
  const[load,setLoad]=useState(false);
  async function submit(){
    setErr("");setLoad(true);
    if(!username.trim()||!password.trim()){setErr("Login va parol kiritilishi shart");setLoad(false);return;}
    if(!/^[a-zA-Z0-9_]{3,20}$/.test(username)){setErr("Login: 3-20ta lotin harf/raqam/_");setLoad(false);return;}
    if(tab==="register"){
      if(!name.trim()){setErr("Ismingizni kiriting");setLoad(false);return;}
      if(password.length<4){setErr("Parol kamida 4 belgi");setLoad(false);return;}
      if(await db.getUser(username)){setErr("Bu login band");setLoad(false);return;}
      await db.setUser(username,{username,password,name,createdAt:Date.now()});
      const p=newProfile(username,name);await db.setProfile(username,p);onLogin({username,name},p);
    }else{
      const u=await db.getUser(username);
      if(!u||u.password!==password){setErr("Login yoki parol noto'g'ri");setLoad(false);return;}
      let p=await db.getProfile(username)||newProfile(username,u.name);
      const today=new Date().toDateString();
      if(p.lastLogin!==today){const yd=new Date();yd.setDate(yd.getDate()-1);p.streakDays=p.lastLogin===yd.toDateString()?(p.streakDays||0)+1:1;p.lastLogin=today;await db.setProfile(username,p);}
      onLogin({username,name:u.name},p);
    }
    setLoad(false);
  }
  const ok=e=>e.key==="Enter"&&submit();
  return(<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#F5F3FF,#EDE9FE 45%,#FEF3C7)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Sans',sans-serif",padding:20}}>
    <div style={{position:"fixed",top:-80,right:-80,width:300,height:300,borderRadius:"50%",background:"rgba(124,58,237,0.08)",pointerEvents:"none"}}/>
    <div style={{position:"fixed",bottom:-60,left:-60,width:260,height:260,borderRadius:"50%",background:"rgba(217,119,6,0.07)",pointerEvents:"none"}}/>
    <div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{position:"relative",display:"inline-block",marginBottom:14}}>
          <div style={{width:76,height:76,borderRadius:22,background:"linear-gradient(135deg,#7C3AED,#4C1D95)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,boxShadow:"0 12px 32px rgba(124,58,237,0.35)"}}>🇷🇺</div>
          <div style={{position:"absolute",top:-4,right:-4,width:22,height:22,borderRadius:"50%",background:"#D97706",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff"}}>AI</div>
        </div>
        <h1 style={{color:"#4C1D95",fontFamily:"Georgia,serif",fontSize:30,fontWeight:800,margin:"0 0 5px"}}>USTOZ AI</h1>
        <p style={{color:"#9CA3AF",fontSize:12,letterSpacing:"2px",textTransform:"uppercase"}}>Rus Tili O'rganish Platformasi</p>
      </div>
      <div style={{background:"#fff",borderRadius:22,padding:"28px 26px",boxShadow:"0 20px 60px rgba(124,58,237,0.12)",border:"1px solid rgba(124,58,237,0.08)"}}>
        <div style={{display:"flex",background:"#F3F4F6",borderRadius:12,padding:3,marginBottom:22}}>
          {[["login","Kirish"],["register","Ro'yxat"]].map(([t,l])=>(
            <button key={t} onClick={()=>{setTab(t);setErr("");}} style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",background:tab===t?"linear-gradient(135deg,#7C3AED,#4C1D95)":"transparent",color:tab===t?"#fff":"#9CA3AF",fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all 0.25s"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:13}}>
          {tab==="register"&&<LabeledInput label="To'liq Ism" placeholder="Masalan: Jasur" value={name} onChange={e=>setName(e.target.value)} onKeyDown={ok}/>}
          <LabeledInput label="Login" placeholder="faqat_lotin_harflar" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={ok}/>
          <LabeledInput label="Parol" placeholder="Kamida 4 belgi" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={ok}/>
        </div>
        {err&&<div style={{marginTop:12,padding:"10px 14px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:9,color:"#DC2626",fontSize:12.5,fontWeight:500}}>⚠ {err}</div>}
        <button onClick={submit} disabled={load} style={{width:"100%",marginTop:18,padding:"13px 0",background:load?"#F3F4F6":"linear-gradient(135deg,#7C3AED,#4C1D95)",border:"none",borderRadius:12,color:load?"#9CA3AF":"#fff",fontSize:14,fontWeight:700,cursor:load?"not-allowed":"pointer",fontFamily:"inherit",boxShadow:load?"none":"0 6px 22px rgba(124,58,237,0.3)"}}>
          {load?"⏳ Tekshirilmoqda...":tab==="login"?"Tizimga Kirish →":"Hisob Yaratish →"}
        </button>
        {tab==="login"&&<p style={{textAlign:"center",color:"#9CA3AF",fontSize:12,marginTop:14}}>Hisobingiz yo'qmi? <span onClick={()=>{setTab("register");setErr("");}} style={{color:"#7C3AED",cursor:"pointer",fontWeight:700}}>Ro'yxatdan o'ting</span></p>}
      </div>
    </div>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input::placeholder{color:#9CA3AF!important;}textarea::placeholder{color:#9CA3AF!important;}`}</style>
  </div>);
}

// ═══ SIDEBAR ══════════════════════════════════════════════
function Sidebar({user,profile,screen,onNav,onLogout}){
  const lc=LC[profile?.level||"A1"];
  const tot=Object.values(profile?.completedLessons||{}).reduce((a,b)=>a+b,0);
  const bankSize=Object.keys(profile?.vocabBank||{}).filter(k=>!(profile.vocabBank[k]?.mastered)).length;
  return(<aside style={{width:230,height:"100vh",background:"#fff",borderRight:"1px solid #E5E7EB",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden",boxShadow:"2px 0 12px rgba(0,0,0,0.04)"}}>
    <div style={{padding:"17px 15px",borderBottom:"1px solid #F3F4F6",display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:38,height:38,borderRadius:11,background:"linear-gradient(135deg,#7C3AED,#4C1D95)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🇷🇺</div>
      <div><div style={{color:"#4C1D95",fontSize:15,fontWeight:800,fontFamily:"Georgia,serif"}}>USTOZ AI</div><div style={{color:"#D1D5DB",fontSize:9,letterSpacing:"1px",textTransform:"uppercase"}}>LMS Platform</div></div>
    </div>
    <div style={{padding:"12px 13px",borderBottom:"1px solid #F3F4F6",background:"#FAFAFA"}}>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:9}}>
        <div style={{width:35,height:35,borderRadius:"50%",background:`${lc}15`,border:`2px solid ${lc}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:lc,flexShrink:0}}>{(user.name||user.username)[0].toUpperCase()}</div>
        <div style={{overflow:"hidden",flex:1}}><div style={{color:"#111827",fontSize:13,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user.name}</div><div style={{color:"#9CA3AF",fontSize:10}}>@{user.username}</div></div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        <span style={{background:`${lc}15`,border:`1px solid ${lc}30`,borderRadius:7,padding:"3px 9px",fontSize:11,fontWeight:800,color:lc}}>{profile?.level||"A1"}</span>
        <span style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:7,padding:"3px 9px",fontSize:11,color:"#D97706",fontWeight:600}}>🔥 {profile?.streakDays||0}</span>
        {bankSize>0&&<span style={{background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:7,padding:"3px 9px",fontSize:11,color:"#DC2626",fontWeight:600}}>📝 {bankSize}</span>}
      </div>
    </div>
    <nav style={{flex:1,padding:"10px 8px",overflowY:"auto"}}>
      <div style={{color:"#D1D5DB",fontSize:9,letterSpacing:"1px",textTransform:"uppercase",padding:"5px 8px 4px",fontWeight:700}}>Asosiy</div>
      <NavBtn {...DASH} active={screen==="dashboard"} onClick={()=>onNav("dashboard")} badge={0} highlight={profile?.isNew}/>
      <div style={{color:"#D1D5DB",fontSize:9,letterSpacing:"1px",textTransform:"uppercase",padding:"5px 8px 4px",fontWeight:700,marginTop:4}}>Modullar</div>
      {MODS.map(m=><NavBtn key={m.id} {...m} active={screen===m.id} badge={profile?.completedLessons?.[m.id]||0} onClick={()=>onNav(m.id)} highlight={false}/>)}
    </nav>
    <div style={{padding:"11px 13px",borderTop:"1px solid #F3F4F6"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:9}}>
        {[[profile?.disciplineScore||50,"Intizom","#7C3AED"],[tot,"Darslar","#059669"],[profile?.totalMinutes||0,"Min","#0891B2"]].map(([v,l,c],i)=>(
          <div key={i} style={{background:"#F9FAFB",border:"1px solid #F3F4F6",borderRadius:8,padding:"6px 4px",textAlign:"center"}}>
            <div style={{color:c,fontSize:14,fontWeight:800,lineHeight:1}}>{v}</div>
            <div style={{color:"#9CA3AF",fontSize:8,marginTop:2,textTransform:"uppercase"}}>{l}</div>
          </div>
        ))}
      </div>
      <button onClick={onLogout} style={{width:"100%",padding:"7px",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,color:"#9CA3AF",fontSize:11,cursor:"pointer",fontFamily:"inherit",transition:"all 0.2s"}}
        onMouseEnter={e=>{e.currentTarget.style.color="#DC2626";e.currentTarget.style.borderColor="#FECACA";e.currentTarget.style.background="#FEF2F2";}}
        onMouseLeave={e=>{e.currentTarget.style.color="#9CA3AF";e.currentTarget.style.borderColor="#E5E7EB";e.currentTarget.style.background="#F9FAFB";}}>
        ↗ Chiqish
      </button>
    </div>
  </aside>);
}

// ═══ CHAT PANE ════════════════════════════════════════════
function ChatPane({user,profile,updateProfile,modId}){
  const isDb=modId==="dashboard";
  const cfg=isDb?DASH:(MODS.find(m=>m.id===modId)||MODS[0]);
  const[msgs,setMsgs]=useState(null);
  const[input,setInput]=useState("");
  const[sending,setSending]=useState(false);
  const[errMsg,setErrMsg]=useState("");
  const[initErr,setInitErr]=useState(false);
  const[retryCount,setRetryCount]=useState(0);
  const bottomRef=useRef(null);
  const inputRef=useRef(null);
  const profRef=useRef(profile);
  const tRef=useRef(Date.now());
  const initDone=useRef(false);
  useEffect(()=>{profRef.current=profile;},[profile]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[msgs,sending]);
  useEffect(()=>{
    let cancelled=false;initDone.current=false;
    setMsgs(null);setInput("");setSending(false);setErrMsg("");setInitErr(false);
    async function init(){
      const saved=await db.getMsgs(user.username,modId);
      if(cancelled)return;
      if(saved&&saved.length>=2){setMsgs(saved);return;}
      if(initDone.current)return;initDone.current=true;setSending(true);
      const fm={role:"user",content:INIT[modId]||"Darsni boshlaylik."};
      try{
        const r=await callAI([fm],profRef.current,modId);
        if(cancelled)return;
        const ms=[fm,{role:"assistant",content:r}];
        setMsgs(ms);await db.setMsgs(user.username,modId,ms);
      }catch(e){if(!cancelled){setInitErr(true);setErrMsg(e.message);setMsgs([]);}}
      finally{if(!cancelled){setSending(false);tRef.current=Date.now();}}
    }
    init();return()=>{cancelled=true;};
  },[modId,retryCount]);

  async function send(){
    const text=input.trim();
    if(!text||sending||msgs===null)return;
    const um={role:"user",content:text};
    setInput("");setSending(true);setErrMsg("");
    let snap=[];
    setMsgs(prev=>{snap=[...(prev||[])];return[...snap,um];});
    await new Promise(r=>setTimeout(r,0));
    try{
      const r=await callAI([...snap,um],profRef.current,modId);
      const ai={role:"assistant",content:r};
      setMsgs(prev=>{const n=[...(prev||[]),ai];db.setMsgs(user.username,modId,n);return n;});
      if(!isDb){
        const el=Math.max(0,Math.round((Date.now()-tRef.current)/60000));tRef.current=Date.now();
        const cur=profRef.current;
        const up={...cur,totalMinutes:(cur.totalMinutes||0)+el,completedLessons:{...cur.completedLessons,[modId]:(cur.completedLessons?.[modId]||0)+1},disciplineScore:Math.min(100,(cur.disciplineScore||50)+1)};
        await db.setProfile(user.username,up);updateProfile(up);
      }else if(profRef.current.isNew){
        const lv=r.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
        if(lv){const up={...profRef.current,isNew:false,level:lv[1],listeningStats:{...profRef.current.listeningStats,adaptiveLevel:lv[1]}};await db.setProfile(user.username,up);updateProfile(up);}
      }
    }catch(e){
      setMsgs(prev=>{const n=prev||[];return n[n.length-1]?.role==="user"?n.slice(0,-1):n;});
      setInput(text);setErrMsg(e.message||"Xatolik yuz berdi");
    }finally{setSending(false);setTimeout(()=>inputRef.current?.focus(),80);}
  }

  const initial=(user.name||user.username)[0].toUpperCase();
  const visible=msgs?msgs.slice(1):[];
  const lc=LC[profile?.level||"A1"];
  return(<div style={{flex:1,display:"flex",flexDirection:"column",background:"#F9FAFB",overflow:"hidden"}}>
    <div style={{padding:"13px 20px",borderBottom:"1px solid #E5E7EB",background:"#fff",display:"flex",alignItems:"center",gap:12,flexShrink:0,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      <div style={{width:40,height:40,borderRadius:12,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{cfg.icon}</div>
      <div style={{flex:1}}><div style={{color:"#111827",fontSize:15,fontWeight:700}}>{cfg.label}{!isDb&&" Moduli"}</div><div style={{color:"#9CA3AF",fontSize:11}}>{isDb?(profile?.isNew?"Darajangizni aniqlash":"Murabbiy & reja"):cfg.desc}</div></div>
      <div style={{background:`${lc}15`,border:`1px solid ${lc}35`,borderRadius:9,padding:"5px 12px",textAlign:"center"}}><div style={{color:lc,fontSize:13,fontWeight:800}}>{profile?.level||"A1"}</div><div style={{color:"#9CA3AF",fontSize:8,textTransform:"uppercase"}}>Daraja</div></div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"18px 16px",display:"flex",flexDirection:"column",gap:13}}>
      {msgs===null&&!initErr&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:10}}>
        <div style={{width:54,height:54,borderRadius:15,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{cfg.icon}</div>
        <div style={{color:"#6B7280",fontSize:13}}>Yuklanmoqda...</div>
        <div style={{display:"flex",gap:5}}>{[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:cfg.color,animation:`bounce 1.2s ${j*0.2}s infinite ease-in-out`}}/>)}</div>
      </div>)}
      {initErr&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:12}}>
        <div style={{fontSize:36}}>⚠️</div>
        <div style={{color:"#DC2626",fontSize:14,fontWeight:700}}>Ulanishda xatolik</div>
        <div style={{color:"#9CA3AF",fontSize:12,marginBottom:8,textAlign:"center",maxWidth:260}}>{errMsg}</div>
        <button onClick={()=>setRetryCount(c=>c+1)} style={{padding:"9px 20px",background:"linear-gradient(135deg,#7C3AED,#4C1D95)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>🔄 Qayta urinish</button>
      </div>)}
      {visible.map((msg,i)=><Bubble key={i} msg={msg} cfg={cfg} initial={initial}/>)}
      {sending&&msgs!==null&&<Dots cfg={cfg}/>}
      {errMsg&&!initErr&&(<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:11,padding:"11px 15px",display:"flex",gap:9,alignItems:"flex-start"}}>
        <span>⚠️</span><div style={{flex:1}}><div style={{color:"#DC2626",fontSize:13,fontWeight:700,marginBottom:2}}>Xatolik</div><div style={{color:"#6B7280",fontSize:12}}>{errMsg}</div></div>
        <button onClick={()=>setErrMsg("")} style={{color:"#9CA3AF",background:"none",border:"none",cursor:"pointer",fontSize:14}}>✕</button>
      </div>)}
      <div ref={bottomRef}/>
    </div>
    <div style={{padding:"12px 16px 14px",borderTop:"1px solid #E5E7EB",background:"#fff",flexShrink:0,boxShadow:"0 -2px 8px rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",gap:9,alignItems:"flex-end"}}>
        <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder={msgs===null?"Yuklanmoqda...":sending?"AI yozmoqda...":"Javob yozing... (Enter)"}
          disabled={msgs===null||sending} rows={1}
          style={{flex:1,background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:12,padding:"11px 15px",color:"#111827",fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.55,maxHeight:120,transition:"border-color 0.2s",opacity:msgs===null?0.5:1}}
          onFocus={e=>e.target.style.borderColor=cfg.color} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
        <button onClick={send} disabled={!input.trim()||sending||msgs===null}
          style={{width:44,height:44,borderRadius:11,flexShrink:0,border:"none",background:(input.trim()&&!sending&&msgs!==null)?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:"#F3F4F6",cursor:(input.trim()&&!sending&&msgs!==null)?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,transition:"all 0.2s"}}>
          {sending?"⏳":"➤"}
        </button>
      </div>
      <div style={{textAlign:"center",color:"#D1D5DB",fontSize:10,marginTop:5}}>Shift+Enter — yangi qator · Enter — yuborish</div>
    </div>
  </div>);
}

// ═══ LISTENING MODULE (ADAPTIVE) ══════════════════════════
function ListeningModule({user,profile,updateProfile}){
  const cfg=MODS.find(m=>m.id==="listening");
  const[ex,setEx]=useState(null);
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const[playing,setPlaying]=useState(false);
  const[speed,setSpeed]=useState(0.82);
  const[curWord,setCurWord]=useState(-1);
  const[showSub,setShowSub]=useState(false);
  const[tip,setTip]=useState({show:false,word:"",translation:"",phonetic:"",example:"",loading:false,x:0,y:0});
  const[answers,setAnswers]=useState({});
  const[results,setResults]=useState(null);
  const[checking,setChecking]=useState(false);
  const[sessionClicks,setSessionClicks]=useState([]);
  const[mode,setMode]=useState("normal");
  const wordCache=useRef({});
  const utterRef=useRef(null);
  const stats=profile?.listeningStats||{totalExercises:0,totalScore:0,lastScore:null,bestScore:0,adaptiveLevel:profile?.level||"A1",consecutiveGood:0,consecutiveBad:0};
  const adaptiveLevel=getAdaptiveLevel(stats,profile?.level);
  const unknownWords=getUnknownWords(profile?.vocabBank,6);

  async function generate(genMode="normal"){
    setLoading(true);setErr("");setEx(null);setResults(null);setAnswers({});setSessionClicks([]);
    setCurWord(-1);setPlaying(false);stopRu();setMode(genMode);
    try{
      const data=await generateListeningExercise(profile,unknownWords,adaptiveLevel,genMode);
      setEx(data);
    }catch(e){setErr(e.message||"Mashq yaratishda xatolik yuz berdi");}
    setLoading(false);
  }

  function playAudio(){
    if(!ex)return;
    if(playing){stopRu();setPlaying(false);setCurWord(-1);return;}
    setCurWord(-1);
    speakRu(ex.audioText,speed,(wi)=>setCurWord(wi),()=>{setPlaying(false);setCurWord(-1);});
    setPlaying(true);
  }

  async function onWordClick(word,e){
    const clean=word.replace(/[.,!?;:«»"'—\-]/g,"").trim().toLowerCase();
    if(!clean||clean.length<2)return;
    setSessionClicks(p=>[...new Set([...p,clean])]);
    const rect=e.target.getBoundingClientRect();
    const cached=wordCache.current[clean];
    if(cached){setTip({show:true,...cached,word:clean,loading:false,x:rect.left,y:rect.bottom});return;}
    const vc=ex?.vocab?.find(v=>v.word.toLowerCase().replace(/[.,!?;:]/g,"")===clean);
    if(vc){const d={translation:vc.translation,phonetic:vc.phonetic||"",example:vc.example||""};wordCache.current[clean]=d;setTip({show:true,...d,word:clean,loading:false,x:rect.left,y:rect.bottom});return;}
    setTip({show:true,word:clean,translation:"",phonetic:"",example:"",loading:true,x:rect.left,y:rect.bottom});
    try{const d=await translateWord(clean);wordCache.current[clean]=d;setTip(p=>({...p,...d,loading:false}));}
    catch{setTip(p=>({...p,translation:"Tarjima topilmadi",loading:false}));}
  }

  async function checkAnswers(){
    if(!ex||checking)return;
    setChecking(true);
    const qa=ex.questions.map(q=>({...q,userAns:answers[q.id]||"",ok:false}));
    try{
      const prompt=`An Uzbek learner answered Russian listening comprehension questions. Evaluate each answer and give feedback in Uzbek.
Audio text: "${ex.audioText}"
${qa.map((q,i)=>`Q${i+1}: ${q.q}\nExpected: ${q.answer}\nUser said: ${q.userAns||"(blank)"}`).join("\n\n")}
For each question: ✅ if correct, ❌ if wrong (with brief explanation).
End with overall score X/10 and one encouraging sentence. Keep it brief.`;
      const feedback=await callAI([{role:"user",content:prompt}],profile,"listening");
      const scoreMatch=feedback.match(/(\d+)\/10/);
      const score10=scoreMatch?parseInt(scoreMatch[1]):Math.round(qa.filter(q=>(answers[q.id]||"").trim().length>1).length/qa.length*7);
      const scorePercent=Math.round(score10/10*100);
      // Update profile
      const newBank=updateVocabBank(profile?.vocabBank||{},sessionClicks,ex.vocab?.map(v=>v.word)||[]);
      const cGood=scorePercent>=80?(stats.consecutiveGood||0)+1:0;
      const cBad=scorePercent<50?(stats.consecutiveBad||0)+1:0;
      const nextLevel=calcNextLevel(adaptiveLevel,scorePercent,cGood,cBad);
      const newStats={
        totalExercises:(stats.totalExercises||0)+1,
        totalScore:(stats.totalScore||0)+scorePercent,
        lastScore:scorePercent,
        bestScore:Math.max(stats.bestScore||0,scorePercent),
        adaptiveLevel:nextLevel,
        consecutiveGood:cGood,
        consecutiveBad:cBad,
      };
      const up={...profile,vocabBank:newBank,listeningStats:newStats,
        completedLessons:{...profile.completedLessons,listening:(profile.completedLessons?.listening||0)+1},
        disciplineScore:Math.min(100,(profile.disciplineScore||50)+2),
      };
      await db.setProfile(user.username,up);updateProfile(up);
      setResults({feedback,scorePercent,nextLevel,cGood,cBad,
        levelUp:nextLevel!==adaptiveLevel&&LEVELS.indexOf(nextLevel)>LEVELS.indexOf(adaptiveLevel),
        levelDown:nextLevel!==adaptiveLevel&&LEVELS.indexOf(nextLevel)<LEVELS.indexOf(adaptiveLevel),
        newUnknown:sessionClicks.filter(w=>!ex.vocab?.some(v=>v.word.toLowerCase().includes(w))),
      });
    }catch(e){setErr(e.message);}
    setChecking(false);
  }

  const words=ex?ex.audioText.split(/(\s+)/):[];
  const avgScore=stats.totalExercises>0?Math.round(stats.totalScore/stats.totalExercises):0;

  return(<div style={{flex:1,display:"flex",flexDirection:"column",background:"#F9FAFB",overflow:"hidden"}} onClick={()=>setTip(t=>({...t,show:false}))}>
    <WordTooltip tip={tip} onClose={()=>setTip(t=>({...t,show:false}))}/>
    {/* Header */}
    <div style={{padding:"12px 18px",borderBottom:"1px solid #E5E7EB",background:"#fff",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <div style={{width:38,height:38,borderRadius:11,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>🎧</div>
        <div style={{flex:1}}><div style={{color:"#111827",fontSize:14,fontWeight:700}}>Eshitish Moduli — Adaptive</div><div style={{color:"#9CA3AF",fontSize:11}}>100% rus tili · tabiiy talaffuz · so'z banki</div></div>
      </div>
      {/* Adaptive stats bar */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{background:"#EDE9FE",border:"1px solid #C4B5FD",borderRadius:8,padding:"4px 11px",fontSize:12,fontWeight:700,color:"#7C3AED"}}>🎯 {adaptiveLevel} daraja</div>
        {avgScore>0&&<div style={{background:"#D1FAE5",border:"1px solid #6EE7B7",borderRadius:8,padding:"4px 11px",fontSize:12,fontWeight:700,color:"#059669"}}>📊 O'rtacha: {avgScore}%</div>}
        {unknownWords.length>0&&<div style={{background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:8,padding:"4px 11px",fontSize:12,fontWeight:600,color:"#DC2626"}}>📝 {unknownWords.length} noma'lum so'z</div>}
        {stats.lastScore!==null&&<div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,padding:"4px 11px",fontSize:12,color:"#16a34a"}}>Oxirgi: {stats.lastScore}%</div>}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          {unknownWords.length>0&&<button onClick={()=>generate("review")} style={{padding:"5px 11px",background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:8,color:"#DC2626",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>🔁 Noma'lum so'zlar</button>}
          <button onClick={()=>generate("normal")} disabled={loading} style={{padding:"5px 13px",background:loading?"#F3F4F6":"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:8,color:loading?"#9CA3AF":"#fff",fontSize:12,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit"}}>
            {loading?"⏳":"🎵 Yangi Mashq"}
          </button>
        </div>
      </div>
    </div>

    <div style={{flex:1,overflowY:"auto",padding:"16px 18px"}}>
      {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:11,padding:"12px 16px",color:"#DC2626",fontSize:13,marginBottom:14}}>⚠️ {err}</div>}

      {!ex&&!loading&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"70%",flexDirection:"column",gap:14}}>
        <div style={{width:80,height:80,borderRadius:20,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36}}>🎧</div>
        <div style={{color:"#111827",fontSize:15,fontWeight:700}}>Eshitish Moduliga Xush Kelibsiz</div>
        <div style={{color:"#6B7280",fontSize:13,textAlign:"center",maxWidth:320,lineHeight:1.6}}>
          Tizim sizning darajangiz (<strong style={{color:"#7C3AED"}}>{adaptiveLevel}</strong>) ga moslashtirilgan 100% rus tilidagi audio yaratadi. So'zga bosib tarjimasini biling.
        </div>
        {unknownWords.length>0&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:12,padding:"10px 16px",textAlign:"center",maxWidth:300}}>
          <div style={{color:"#DC2626",fontSize:12,fontWeight:700,marginBottom:4}}>📝 Noma'lum so'zlaringiz: {unknownWords.length} ta</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center"}}>
            {unknownWords.slice(0,4).map(w=><span key={w} style={{background:"#fff",border:"1px solid #FCA5A5",borderRadius:6,padding:"2px 8px",fontSize:11,color:"#DC2626"}}>{w}</span>)}
          </div>
        </div>}
        <div style={{display:"flex",gap:10}}>
          {unknownWords.length>0&&<button onClick={()=>generate("review")} style={{padding:"10px 20px",background:"linear-gradient(135deg,#DC2626,#b91c1c)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>🔁 So'z bankidan mashq</button>}
          <button onClick={()=>generate("normal")} style={{padding:"10px 22px",background:"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(147,51,234,0.3)"}}>🎵 Yangi Mashq</button>
        </div>
      </div>)}

      {loading&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50%",flexDirection:"column",gap:10}}>
        <div style={{fontSize:40}}>🎧</div><div style={{color:"#6B7280",fontSize:13}}>Rus tilida audio yaratilmoqda...</div>
        <div style={{display:"flex",gap:5}}>{[0,1,2].map(j=><div key={j} style={{width:8,height:8,borderRadius:"50%",background:cfg.color,animation:`bounce 1.2s ${j*0.2}s infinite ease-in-out`}}/>)}</div>
      </div>)}

      {ex&&(<div>
        {/* Mode badge */}
        {mode==="review"&&<div style={{background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:9,padding:"7px 14px",marginBottom:12,fontSize:12,color:"#DC2626",fontWeight:600}}>🔁 Noma'lum so'zlar bo'yicha maxsus mashq: {unknownWords.join(", ")}</div>}

        {/* Title + scenario */}
        <div style={{background:"#fff",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1px solid #E5E7EB"}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
            <span style={{background:cfg.light,border:`1px solid ${cfg.border}`,borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,color:cfg.color}}>{ex.difficulty||adaptiveLevel}</span>
            <span style={{color:"#9CA3AF",fontSize:11}}>Adaptive daraja</span>
          </div>
          <div style={{color:"#111827",fontSize:16,fontWeight:700,marginBottom:4}}>{ex.title}</div>
          {ex.scenario&&<div style={{color:"#6B7280",fontSize:12,lineHeight:1.5}}>📍 {ex.scenario}</div>}
        </div>

        {/* Audio player */}
        <div style={{background:"linear-gradient(135deg,#7C3AED,#4C1D95)",borderRadius:14,padding:"16px 18px",marginBottom:12,boxShadow:"0 6px 20px rgba(124,58,237,0.25)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <button onClick={playAudio} style={{width:50,height:50,borderRadius:"50%",background:"rgba(255,255,255,0.2)",border:"2px solid rgba(255,255,255,0.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,cursor:"pointer",color:"#fff",flexShrink:0,transition:"all 0.2s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.3)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.2)"}>
              {playing?"⏸":"▶"}
            </button>
            <div style={{flex:1}}>
              <div style={{color:"#fff",fontSize:12,fontWeight:600,marginBottom:6}}>{playing?"▶ Ijro etilmoqda (rus tili)...":"▶ Audio — tabiiy rus talaffuzi"}</div>
              <div style={{height:4,background:"rgba(255,255,255,0.2)",borderRadius:2}}><div style={{height:"100%",background:"rgba(255,255,255,0.8)",borderRadius:2,width:playing?"55%":"0",transition:"width 0.4s"}}/></div>
            </div>
            <div style={{display:"flex",gap:5}}>
              {[0.65,0.82,1.0].map(s=>(
                <button key={s} onClick={()=>{setSpeed(s);if(playing){stopRu();setPlaying(false);setCurWord(-1);}}} style={{padding:"4px 9px",background:speed===s?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.1)",border:`1px solid ${speed===s?"rgba(255,255,255,0.7)":"rgba(255,255,255,0.25)"}`,borderRadius:6,color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {s===0.65?"Sekin":s===0.82?"Normal":"Tez"}
                </button>
              ))}
            </div>
          </div>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>💡 So'z boyi yoqilmagan bo'lsa Chrome brauzerida eng yaxshi ishlaydi · TTS: ru-RU</div>
        </div>

        {/* Transcript with word highlighting */}
        <div style={{background:"#fff",borderRadius:14,padding:"16px 18px",marginBottom:12,border:"1px solid #E5E7EB"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{color:"#374151",fontSize:13,fontWeight:700}}>📝 Transkript — har bir so'zga bosing</div>
            <button onClick={()=>setShowSub(!showSub)} style={{padding:"5px 11px",background:showSub?"#EDE9FE":"#F3F4F6",border:`1px solid ${showSub?"#C4B5FD":"#E5E7EB"}`,borderRadius:7,color:showSub?"#7C3AED":"#6B7280",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {showSub?"🙈 Tarjimani yashir":"👁 Tarjimani ko'rsat"}
            </button>
          </div>
          <div style={{lineHeight:2.2,fontSize:15,color:"#111827",letterSpacing:"0.01em"}}>
            {words.map((w,i)=>{
              if(/^\s+$/.test(w)) return (<span key={i}>{w}</span>);
              const isHighlighted=playing&&curWord===Math.floor(i/2);
              return(<span key={i} onClick={e=>{e.stopPropagation();onWordClick(w,e);}}
                style={{cursor:"pointer",borderRadius:4,padding:"1px 2px",display:"inline-block",transition:"background 0.12s",
                  background:isHighlighted?"#DDD6FE":"transparent",
                  color:isHighlighted?"#4C1D95":"inherit",
                  fontWeight:isHighlighted?700:400,
                  textDecoration:"underline",textDecorationColor:"rgba(147,51,234,0.2)",textDecorationStyle:"dotted"}}
                onMouseEnter={e=>e.currentTarget.style.background="#EDE9FE"}
                onMouseLeave={e=>e.currentTarget.style.background=isHighlighted?"#DDD6FE":"transparent"}>
                {w}
              </span>);
            })}
          </div>
          {showSub&&<div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #F3F4F6",color:"#6B7280",fontSize:13,lineHeight:1.75,fontStyle:"italic"}}>{ex.uzbekTranslation}</div>}
          {ex.grammarPoint&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F3F4F6",background:"#F0FDF4",borderRadius:8,padding:"8px 12px",color:"#059669",fontSize:12}}><strong>📐 Grammatika:</strong> {ex.grammarPoint}</div>}
        </div>

        {/* Vocabulary */}
        {ex.vocab?.length>0&&(<div style={{background:"#fff",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1px solid #E5E7EB"}}>
          <div style={{color:"#374151",fontSize:13,fontWeight:700,marginBottom:10}}>📚 Asosiy so'zlar</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {ex.vocab.map((v,i)=>{
              const isMissed=sessionClicks.includes(v.word.toLowerCase().replace(/[.,!?;:]/g,""));
              return(<div key={i} onClick={e=>{e.stopPropagation();speakRu(v.word,0.7);setTip({show:true,word:v.word,translation:v.translation,phonetic:v.phonetic||"",example:v.example||"",loading:false,x:e.clientX,y:e.clientY});}}
                style={{background:isMissed?"#FEF2F2":"#F9FAFB",border:`1px solid ${isMissed?"#FCA5A5":"#E5E7EB"}`,borderRadius:9,padding:"6px 11px",cursor:"pointer",transition:"all 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#C4B5FD"}
                onMouseLeave={e=>e.currentTarget.style.borderColor=isMissed?"#FCA5A5":"#E5E7EB"}>
                <span style={{color:isMissed?"#DC2626":"#7C3AED",fontWeight:700,fontSize:13}}>{v.word}</span>
                {v.phonetic&&<span style={{color:"#9CA3AF",fontSize:10,marginLeft:5}}>[{v.phonetic}]</span>}
                <div style={{color:"#374151",fontSize:11,marginTop:1}}>{v.translation}</div>
              </div>);
            })}
          </div>
          {sessionClicks.length>0&&<div style={{marginTop:8,color:"#9CA3AF",fontSize:11}}>🔴 Siz bu darsda {sessionClicks.length} ta so'zni qidirdingiz — ular so'z bankiga qo'shiladi.</div>}
        </div>)}

        {/* Questions */}
        {!results&&(<div style={{background:"#fff",borderRadius:14,padding:"16px 18px",border:"1px solid #E5E7EB"}}>
          <div style={{color:"#374151",fontSize:13,fontWeight:700,marginBottom:14}}>❓ Tushunish savollari</div>
          {ex.questions?.map((q,i)=>(
            <div key={q.id} style={{marginBottom:14}}>
              <div style={{color:"#111827",fontSize:13.5,fontWeight:600,marginBottom:6}}>{i+1}. {q.q}</div>
              {q.hint&&<div style={{color:"#9CA3AF",fontSize:11,marginBottom:5,fontStyle:"italic"}}>💡 {q.hint}</div>}
              <input value={answers[q.id]||""} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))}
                placeholder="Javobingizni o'zbek yoki rus tilida yozing..."
                style={{width:"100%",padding:"10px 13px",background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:9,color:"#111827",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor="#9333EA"} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
            </div>
          ))}
          <button onClick={checkAnswers} disabled={checking} style={{width:"100%",padding:"11px",background:checking?"#F3F4F6":"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:10,color:checking?"#9CA3AF":"#fff",fontSize:13,fontWeight:700,cursor:checking?"not-allowed":"pointer",fontFamily:"inherit",boxShadow:checking?"none":"0 4px 12px rgba(147,51,234,0.25)"}}>
            {checking?"⏳ Tekshirilmoqda...":"✅ Javoblarni Tekshirish"}
          </button>
        </div>)}

        {/* Results */}
        {results&&(<div style={{background:"#fff",borderRadius:14,padding:"16px 18px",border:"1px solid #E5E7EB"}}>
          {/* Score */}
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,padding:"14px 16px",background:results.scorePercent>=80?"#F0FDF4":results.scorePercent>=50?"#FEF3C7":"#FEF2F2",borderRadius:11,border:`1px solid ${results.scorePercent>=80?"#BBF7D0":results.scorePercent>=50?"#FCD34D":"#FECACA"}`}}>
            <div style={{fontSize:36}}>{results.scorePercent>=80?"🏆":results.scorePercent>=50?"👍":"💪"}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:26,fontWeight:800,color:results.scorePercent>=80?"#059669":results.scorePercent>=50?"#D97706":"#DC2626"}}>{results.scorePercent}%</div>
              <div style={{color:"#6B7280",fontSize:12}}>{results.scorePercent>=80?"Ajoyib natija!":results.scorePercent>=50?"Yaxshi harakat!":"Davom eting, oldinda yaxshi natijalarga erishasiz!"}</div>
            </div>
            {results.levelUp&&<div style={{background:"#059669",color:"#fff",borderRadius:9,padding:"6px 12px",fontSize:12,fontWeight:800,textAlign:"center"}}>🚀 DARAJA OSHDI!<div style={{fontSize:10}}>{adaptiveLevel}→{results.nextLevel}</div></div>}
            {results.levelDown&&<div style={{background:"#D97706",color:"#fff",borderRadius:9,padding:"6px 12px",fontSize:12,fontWeight:700,textAlign:"center"}}>📚 Mustahkamlash<div style={{fontSize:10}}>Qo'shimcha mashq</div></div>}
          </div>
          {/* AI feedback */}
          <div style={{background:"#F3E8FF",border:"1px solid #D8B4FE",borderRadius:10,padding:"12px 14px",marginBottom:12}}><Txt text={results.feedback}/></div>
          {/* Unknown words from this session */}
          {results.newUnknown?.length>0&&(<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
            <div style={{color:"#DC2626",fontSize:12,fontWeight:700,marginBottom:6}}>📝 So'z bankiga qo'shildi:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {results.newUnknown.map(w=><span key={w} style={{background:"#fff",border:"1px solid #FCA5A5",borderRadius:6,padding:"2px 8px",fontSize:12,color:"#DC2626"}}>{w}</span>)}
            </div>
          </div>)}
          {/* Next action */}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>generate("normal")} style={{flex:1,padding:"10px",background:"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>🎵 Yangi Mashq</button>
            {(results.scorePercent<70||results.newUnknown?.length>0)&&<button onClick={()=>generate("review")} style={{flex:1,padding:"10px",background:"linear-gradient(135deg,#DC2626,#b91c1c)",border:"none",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>🔁 Noma'lum so'zlar</button>}
          </div>
        </div>)}
      </div>)}
    </div>
  </div>);
}

// ═══ READING MODULE ════════════════════════════════════════
function ReadingModule({user,profile,updateProfile}){
  const cfg=MODS.find(m=>m.id==="reading");
  const[ex,setEx]=useState(null);const[loading,setLoading]=useState(false);const[err,setErr]=useState("");
  const[tip,setTip]=useState({show:false,word:"",translation:"",phonetic:"",example:"",loading:false,x:0,y:0});
  const[answers,setAnswers]=useState({});const[results,setResults]=useState(null);const[checking,setChecking]=useState(false);
  const wordCache=useRef({});
  async function generate(){
    setLoading(true);setErr("");setEx(null);setResults(null);setAnswers({});
    try{const d=await callJSON(`Generate Russian reading exercise for level ${profile?.level||"A1"}.
Return JSON: {"title":"Uzbek title","text":"Pure Russian text 6-10 sentences","uzbekTranslation":"Uzbek translation","vocab":[{"word":"Russian","translation":"Uzbek","phonetic":"pronunciation"}],"questions":[{"id":1,"q":"Uzbek question","answer":"expected answer"}]}`,
      "Generate Russian language reading exercises for Uzbek learners. audioText must be 100% Russian.");
      setEx(d);
    }catch(e){setErr(e.message);}
    setLoading(false);
  }
  async function onWordClick(word,e){
    const clean=word.replace(/[.,!?;:«»"'—]/g,"").trim().toLowerCase();
    if(!clean||clean.length<2)return;
    const rect=e.target.getBoundingClientRect();
    const cached=wordCache.current[clean];
    if(cached){setTip({show:true,...cached,word:clean,loading:false,x:rect.left,y:rect.bottom});return;}
    const vc=ex?.vocab?.find(v=>v.word.toLowerCase()===clean);
    if(vc){const d={translation:vc.translation,phonetic:vc.phonetic||"",example:""};wordCache.current[clean]=d;setTip({show:true,...d,word:clean,loading:false,x:rect.left,y:rect.bottom});return;}
    setTip({show:true,word:clean,translation:"",phonetic:"",example:"",loading:true,x:rect.left,y:rect.bottom});
    try{const d=await translateWord(clean);wordCache.current[clean]=d;setTip(p=>({...p,...d,loading:false}));}
    catch{setTip(p=>({...p,translation:"Tarjima topilmadi",loading:false}));}
  }
  async function checkAnswers(){
    if(!ex||checking)return;setChecking(true);
    try{
      const prompt=`Check reading comprehension answers. Text: "${ex.text}"\n${ex.questions.map((q,i)=>`Q${i+1}: ${q.q}\nUser: ${answers[q.id]||""}\nCorrect: ${q.answer}`).join("\n\n")}\nGive feedback in Uzbek. Score X/10.`;
      const feedback=await callAI([{role:"user",content:prompt}],profile,"reading");
      setResults({feedback});
      const up={...profile,completedLessons:{...profile.completedLessons,reading:(profile.completedLessons?.reading||0)+1},disciplineScore:Math.min(100,(profile.disciplineScore||50)+1)};
      await db.setProfile(user.username,up);updateProfile(up);
    }catch(e){setErr(e.message);}
    setChecking(false);
  }
  return(<div style={{flex:1,display:"flex",flexDirection:"column",background:"#F9FAFB",overflow:"hidden"}} onClick={()=>setTip(t=>({...t,show:false}))}>
    <WordTooltip tip={tip} onClose={()=>setTip(t=>({...t,show:false}))}/>
    <div style={{padding:"13px 18px",borderBottom:"1px solid #E5E7EB",background:"#fff",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
      <div style={{width:38,height:38,borderRadius:11,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19}}>📖</div>
      <div style={{flex:1}}><div style={{color:"#111827",fontSize:14,fontWeight:700}}>O'qish Moduli</div><div style={{color:"#9CA3AF",fontSize:11}}>So'zga bosing → tarjima & talaffuz</div></div>
      <button onClick={generate} disabled={loading} style={{padding:"7px 14px",background:loading?"#F3F4F6":"linear-gradient(135deg,#059669,#047857)",border:"none",borderRadius:9,color:loading?"#9CA3AF":"#fff",fontSize:12,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit"}}>
        {loading?"⏳":"📖 Yangi Matn"}
      </button>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"16px 18px"}}>
      {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:11,padding:"11px 15px",color:"#DC2626",fontSize:13,marginBottom:12}}>⚠️ {err}</div>}
      {!ex&&!loading&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"70%",flexDirection:"column",gap:12}}>
        <div style={{width:72,height:72,borderRadius:18,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>📖</div>
        <div style={{color:"#111827",fontSize:14,fontWeight:700}}>O'qish mashqini boshlash</div>
        <button onClick={generate} style={{padding:"10px 22px",background:"linear-gradient(135deg,#059669,#047857)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(5,150,105,0.3)"}}>📖 Matn Olish</button>
      </div>)}
      {loading&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50%",flexDirection:"column",gap:10}}>
        <div style={{fontSize:36}}>📖</div><div style={{color:"#6B7280",fontSize:13}}>Matn yaratilmoqda...</div>
        <div style={{display:"flex",gap:5}}>{[0,1,2].map(j=><div key={j} style={{width:8,height:8,borderRadius:"50%",background:cfg.color,animation:`bounce 1.2s ${j*0.2}s infinite ease-in-out`}}/>)}</div>
      </div>)}
      {ex&&(<div>
        <div style={{background:"#fff",borderRadius:13,padding:"14px 17px",marginBottom:12,border:"1px solid #E5E7EB"}}>
          <div style={{color:"#111827",fontSize:16,fontWeight:700,marginBottom:8}}>{ex.title}</div>
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <button onClick={()=>speakRu(ex.text,0.82)} style={{padding:"5px 11px",background:"#D1FAE5",border:"1px solid #6EE7B7",borderRadius:7,color:"#059669",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🔊 Butun matn</button>
            <button onClick={stopRu} style={{padding:"5px 11px",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:7,color:"#6B7280",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>⏹ Stop</button>
          </div>
          <div style={{lineHeight:2.3,fontSize:15,color:"#111827"}}>
            {ex.text.split(/(\s+)/g).map((w,i)=>{
              if(/^\s+$/.test(w)) return (<span key={i}>{w}</span>);
              return(<span key={i} onClick={e=>{e.stopPropagation();onWordClick(w,e);}}
                style={{cursor:"pointer",borderRadius:4,padding:"1px 3px",display:"inline-block",transition:"background 0.12s",textDecoration:"underline",textDecorationColor:"rgba(5,150,105,0.2)",textDecorationStyle:"dotted"}}
                onMouseEnter={e=>e.currentTarget.style.background="#D1FAE5"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {w}
              </span>);
            })}
          </div>
          <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F3F4F6",color:"#6B7280",fontSize:12,lineHeight:1.7,fontStyle:"italic"}}>{ex.uzbekTranslation}</div>
        </div>
        {ex.vocab?.length>0&&(<div style={{background:"#fff",borderRadius:13,padding:"13px 17px",marginBottom:12,border:"1px solid #E5E7EB"}}>
          <div style={{color:"#374151",fontSize:13,fontWeight:700,marginBottom:9}}>📚 Lug'at</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {ex.vocab.map((v,i)=>(<div key={i} onClick={e=>{e.stopPropagation();speakRu(v.word,0.7);setTip({show:true,word:v.word,translation:v.translation,phonetic:v.phonetic||"",example:"",loading:false,x:e.clientX,y:e.clientY});}}
              style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:9,padding:"6px 11px",cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#6EE7B7"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="#E5E7EB"}>
              <span style={{color:"#059669",fontWeight:700,fontSize:13}}>{v.word}</span>
              {v.phonetic&&<span style={{color:"#9CA3AF",fontSize:10,marginLeft:4}}>[{v.phonetic}]</span>}
              <div style={{color:"#374151",fontSize:11,marginTop:1}}>{v.translation}</div>
            </div>))}
          </div>
        </div>)}
        <div style={{background:"#fff",borderRadius:13,padding:"14px 17px",border:"1px solid #E5E7EB"}}>
          <div style={{color:"#374151",fontSize:13,fontWeight:700,marginBottom:12}}>❓ Savollar</div>
          {ex.questions?.map((q,i)=>(<div key={q.id} style={{marginBottom:12}}>
            <div style={{color:"#111827",fontSize:13.5,fontWeight:600,marginBottom:5}}>{i+1}. {q.q}</div>
            <input value={answers[q.id]||""} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))} placeholder="Javob..."
              style={{width:"100%",padding:"9px 12px",background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:8,color:"#111827",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
              onFocus={e=>e.target.style.borderColor="#059669"} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
          </div>))}
          <button onClick={checkAnswers} disabled={checking} style={{width:"100%",padding:"10px",background:checking?"#F3F4F6":"linear-gradient(135deg,#059669,#047857)",border:"none",borderRadius:9,color:checking?"#9CA3AF":"#fff",fontSize:13,fontWeight:700,cursor:checking?"not-allowed":"pointer",fontFamily:"inherit"}}>
            {checking?"⏳ Tekshirilmoqda...":"✅ Tekshirish"}
          </button>
          {results?.feedback&&<div style={{marginTop:12,padding:"12px 14px",background:"#D1FAE5",border:"1px solid #6EE7B7",borderRadius:10}}><Txt text={results.feedback}/></div>}
        </div>
      </div>)}
    </div>
  </div>);
}

// ═══ SPEAKING MODULE ═══════════════════════════════════════
function SpeakingModule({user,profile,updateProfile}){
  const cfg=MODS.find(m=>m.id==="speaking");
  const[conv,setConv]=useState([]);const[recording,setRecording]=useState(false);
  const[transcript,setTranscript]=useState("");const[aiSpeaking,setAiSpeaking]=useState(false);
  const[ttsOn,setTtsOn]=useState(true);const[textInput,setTextInput]=useState("");
  const[processing,setProcessing]=useState(false);const[errMsg,setErrMsg]=useState("");
  const[started,setStarted]=useState(false);
  const bottomRef=useRef(null);const recognRef=useRef(null);
  const profRef=useRef(profile);const sendRef=useRef(null);
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const hasSR=!!SR;
  useEffect(()=>{profRef.current=profile;},[profile]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[conv,processing]);
  useEffect(()=>{sendRef.current=sendSpeech;});
  useEffect(()=>{if(!recording&&transcript.trim()&&!processing)sendRef.current?.(transcript);},[recording]);

  async function startSession(){
    setStarted(true);setProcessing(true);
    try{
      const r=await callAI([{role:"user",content:"So'zlashish modulini boshlaylik. Menga rus tilida oddiy savol ber. Faqat rus tilida gapir."}],profRef.current,"speaking");
      setConv([{role:"assistant",content:r}]);
      if(ttsOn){setAiSpeaking(true);speakRu(r.replace(/[*_#]/g,""),0.85,null,()=>setAiSpeaking(false));}
    }catch(e){setErrMsg(e.message);}
    setProcessing(false);
  }

  function startRecording(){
    if(!hasSR){setErrMsg("Brauzeringiz ovozni tanib olmaydi. Matn yozing.");return;}
    setTranscript("");setErrMsg("");
    const r=new SR();r.lang="ru-RU";r.continuous=false;r.interimResults=true;
    r.onresult=e=>{let t="";for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;setTranscript(t);};
    r.onend=()=>setRecording(false);
    r.onerror=e=>{setRecording(false);setErrMsg("Mikrofon: "+e.error);};
    recognRef.current=r;r.start();setRecording(true);
  }

  async function sendSpeech(text){
    if(!text.trim())return;
    setTranscript("");setProcessing(true);setErrMsg("");
    const um={role:"user",content:text};
    const nc=[...conv,um];setConv(nc);
    try{
      const sys=`You are a Russian speaking coach for Uzbek learners. After the user's Russian message:
1. ✅ To'g'ri qismlar (correct parts, in Uzbek)
2. ❌ Xatolar (mistakes with corrections, in Uzbek)
3. 💡 To'g'ri variant: [corrected Russian sentence]
4. 🗣️ [Your Russian reply continuing the conversation]
Be brief, encouraging. Max 120 words.`;
      const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:700,system:sys,messages:buildMsgs(nc)})});
      const d=await res.json();const r=d.content?.[0]?.text||"Javob kelmadi";
      setConv(p=>[...p,{role:"assistant",content:r}]);
      const ruPart=r.match(/🗣️[^:]*:(.*?)(?:\n|$)/s)?.[1]?.trim()||"";
      if(ttsOn&&ruPart){setAiSpeaking(true);speakRu(ruPart.replace(/[*_#]/g,""),0.88,null,()=>setAiSpeaking(false));}
      const up={...profRef.current,completedLessons:{...profRef.current.completedLessons,speaking:(profRef.current.completedLessons?.speaking||0)+1},disciplineScore:Math.min(100,(profRef.current.disciplineScore||50)+1)};
      await db.setProfile(user.username,up);updateProfile(up);
    }catch(e){setErrMsg(e.message||"Xatolik");}
    setProcessing(false);
  }

  return(<div style={{flex:1,display:"flex",flexDirection:"column",background:"#F9FAFB",overflow:"hidden"}}>
    <div style={{padding:"13px 18px",borderBottom:"1px solid #E5E7EB",background:"#fff",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
      <div style={{width:38,height:38,borderRadius:11,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19}}>🗣️</div>
      <div style={{flex:1}}><div style={{color:"#111827",fontSize:14,fontWeight:700}}>So'zlashish Moduli</div><div style={{color:"#9CA3AF",fontSize:11}}>Ovozli suhbat + xato tahlili</div></div>
      <div style={{display:"flex",gap:7}}>
        <button onClick={()=>{setTtsOn(!ttsOn);if(aiSpeaking)stopRu();}} style={{padding:"5px 11px",background:ttsOn?"#E0F2FE":"#F3F4F6",border:`1px solid ${ttsOn?"#7DD3FC":"#E5E7EB"}`,borderRadius:8,color:ttsOn?"#0891B2":"#6B7280",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{ttsOn?"🔊":"🔇"}</button>
        {started&&<button onClick={()=>{setConv([]);setStarted(false);stopRu();setAiSpeaking(false);}} style={{padding:"5px 11px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,color:"#DC2626",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🔄</button>}
      </div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:11}}>
      {!started&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"80%",flexDirection:"column",gap:14}}>
        <div style={{width:76,height:76,borderRadius:20,background:cfg.light,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34}}>🎤</div>
        <div style={{color:"#111827",fontSize:15,fontWeight:700}}>So'zlashish Suhbati</div>
        <div style={{color:"#6B7280",fontSize:13,textAlign:"center",maxWidth:280,lineHeight:1.6}}>AI siz bilan rus tilida suhbat quradi, xatolaringizni tuzatadi va talaffuzingizni tahlil qiladi.</div>
        {!hasSR&&<div style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:10,padding:"9px 14px",color:"#D97706",fontSize:12,textAlign:"center",maxWidth:260}}>⚠️ Brauzer ovozni qo'llab-quvvatlamaydi — matn yozasiz.</div>}
        <button onClick={startSession} style={{padding:"11px 26px",background:"linear-gradient(135deg,#0891B2,#0e7490)",border:"none",borderRadius:11,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 6px 18px rgba(8,145,178,0.35)"}}>🎤 Suhbatni Boshlash</button>
      </div>)}
      {conv.map((msg,i)=>{
        const isU=msg.role==="user";
        return(<div key={i} style={{display:"flex",flexDirection:isU?"row-reverse":"row",gap:9,alignItems:"flex-start",animation:"fadeUp 0.2s ease"}}>
          <div style={{width:33,height:33,borderRadius:9,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:isU?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:cfg.light,border:isU?"none":`1px solid ${cfg.border}`,color:isU?"#fff":cfg.color,fontWeight:800,fontSize:isU?13:15}}>
            {isU?(user.name||"U")[0].toUpperCase():"🤖"}
          </div>
          <div style={{maxWidth:"82%",background:isU?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:"#fff",border:isU?"none":"1px solid #E5E7EB",borderRadius:isU?"13px 4px 13px 13px":"4px 13px 13px 13px",padding:"11px 15px",boxShadow:isU?`0 3px 12px ${cfg.color}30`:"0 2px 8px rgba(0,0,0,0.06)"}}>
            {isU?<div style={{color:"#fff",fontSize:14,lineHeight:1.7}}>{msg.content}</div>:<Txt text={msg.content}/>}
            {!isU&&ttsOn&&<button onClick={()=>speakRu(msg.content.replace(/[✅❌💡🗣️*_#][^\n]*/g,"").trim(),0.88)} style={{marginTop:7,padding:"4px 9px",background:"#E0F2FE",border:"1px solid #7DD3FC",borderRadius:6,color:"#0891B2",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🔊 Qayta tinglash</button>}
          </div>
        </div>);
      })}
      {aiSpeaking&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"9px 13px",background:"#E0F2FE",border:"1px solid #7DD3FC",borderRadius:10,maxWidth:"55%"}}>
        <span>🔊</span><span style={{color:"#0891B2",fontSize:13,fontWeight:600}}>AI gapirmoqda...</span>
        <div style={{display:"flex",gap:4}}>{[0,1,2].map(j=><div key={j} style={{width:6,height:6,borderRadius:"50%",background:"#0891B2",animation:`bounce 1.2s ${j*0.2}s infinite ease-in-out`}}/>)}</div>
      </div>}
      {processing&&<Dots cfg={cfg}/>}
      {errMsg&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:9,padding:"9px 13px",color:"#DC2626",fontSize:13,display:"flex",gap:8,alignItems:"center"}}><span>⚠️</span><span style={{flex:1}}>{errMsg}</span><button onClick={()=>setErrMsg("")} style={{color:"#9CA3AF",background:"none",border:"none",cursor:"pointer"}}>✕</button></div>}
      {transcript&&<div style={{background:"#E0F2FE",border:"1px solid #7DD3FC",borderRadius:9,padding:"9px 13px",color:"#0891B2",fontSize:13}}><strong>🎤</strong> {transcript}</div>}
      <div ref={bottomRef}/>
    </div>
    {started&&(<div style={{padding:"11px 15px 13px",borderTop:"1px solid #E5E7EB",background:"#fff",flexShrink:0}}>
      <div style={{display:"flex",gap:9,alignItems:"center"}}>
        {hasSR&&<button onClick={recording?()=>recognRef.current?.stop():startRecording} disabled={processing||aiSpeaking}
          style={{width:52,height:52,borderRadius:"50%",flexShrink:0,border:"none",background:recording?"linear-gradient(135deg,#DC2626,#b91c1c)":"linear-gradient(135deg,#0891B2,#0e7490)",cursor:(processing||aiSpeaking)?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,boxShadow:recording?"0 0 0 6px rgba(220,38,38,0.2)":"0 4px 14px rgba(8,145,178,0.4)",animation:recording?"pulse 1.5s infinite":"none"}}>
          {recording?"⏹":"🎤"}
        </button>}
        <div style={{flex:1,display:"flex",gap:8}}>
          <textarea value={textInput} onChange={e=>setTextInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendSpeech(textInput);setTextInput("");}}}
            placeholder="Ruscha yozing... (Enter)" rows={1} disabled={processing||aiSpeaking}
            style={{flex:1,background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:11,padding:"10px 13px",color:"#111827",fontSize:13.5,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.5,maxHeight:100,transition:"border-color 0.2s"}}
            onFocus={e=>e.target.style.borderColor=cfg.color} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
          <button onClick={()=>{sendSpeech(textInput);setTextInput("");}} disabled={!textInput.trim()||processing||aiSpeaking}
            style={{width:43,height:43,borderRadius:10,border:"none",background:(textInput.trim()&&!processing)?`linear-gradient(135deg,${cfg.color},${cfg.color}cc)`:"#F3F4F6",cursor:(textInput.trim()&&!processing)?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>➤</button>
        </div>
      </div>
    </div>)}
  </div>);
}

// ═══ DASHBOARD ════════════════════════════════════════════
function DashboardShell({user,profile,onNav,updateProfile}){
  const tot=Object.values(profile?.completedLessons||{}).reduce((a,b)=>a+b,0);
  const lc=LC[profile?.level||"A1"];
  const bankSize=Object.keys(profile?.vocabBank||{}).filter(k=>!profile.vocabBank[k]?.mastered).length;
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"13px 18px 11px",background:"#fff",borderBottom:"1px solid #E5E7EB",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}>
        <div><h1 style={{color:"#111827",fontSize:17,fontWeight:800}}>Salom, {user.name}! 👋</h1><p style={{color:"#9CA3AF",fontSize:11,marginTop:2}}>{new Date().toLocaleDateString("uz-UZ",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p></div>
        {profile?.isNew&&<div style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:10,padding:"7px 12px",textAlign:"center"}}><div style={{color:"#D97706",fontSize:12,fontWeight:700}}>🎯 Yangi o'quvchi</div><div style={{color:"#9CA3AF",fontSize:10,marginTop:1}}>Chat orqali baholashni boshlang ↓</div></div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:!profile?.isNew?10:0}}>
        {[[profile?.level||"A1","Daraja",lc,"🎯"],[`${profile?.streakDays||0}k`,"Seria","#D97706","🔥"],[`${tot}`,"Darslar","#059669","✅"],[`${bankSize}`,"So'z banki","#DC2626","📝"]].map(([v,l,c,ic],i)=>(
          <div key={i} style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:10,padding:"10px 11px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>{ic}</span><div><div style={{color:c,fontSize:15,fontWeight:800,lineHeight:1}}>{v}</div><div style={{color:"#9CA3AF",fontSize:9,textTransform:"uppercase",letterSpacing:"0.4px",marginTop:1}}>{l}</div></div>
          </div>
        ))}
      </div>
      {!profile?.isNew&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {MODS.map(m=>(
          <button key={m.id} onClick={()=>onNav(m.id)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 11px",background:m.light,border:`1px solid ${m.border}`,borderRadius:18,cursor:"pointer",fontFamily:"inherit",fontWeight:600,fontSize:11.5,color:m.color,transition:"all 0.2s"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow=`0 3px 10px ${m.color}25`;}}
            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
            <span>{m.icon}</span>{m.label}
          </button>
        ))}
      </div>}
    </div>
    <ChatPane user={user} profile={profile} updateProfile={updateProfile} modId="dashboard"/>
  </div>);
}

// ═══ APP ══════════════════════════════════════════════════
export default function App(){
  const[user,setUser]=useState(null);
  const[profile,setProfile]=useState(null);
  const[screen,setScreen]=useState("dashboard");
  const login=useCallback((u,p)=>{setUser(u);setProfile(p);setScreen("dashboard");},[]);
  const logout=useCallback(()=>{setUser(null);setProfile(null);setScreen("dashboard");},[]);
  const updProf=useCallback(p=>setProfile(p),[]);
  if(!user) return <AuthScreen onLogin={login}/>;
  return(<div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"'IBM Plex Sans',sans-serif",background:"#F9FAFB"}}>
    <Sidebar user={user} profile={profile} screen={screen} onNav={setScreen} onLogout={logout}/>
    <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {screen==="dashboard"  &&<DashboardShell user={user} profile={profile} onNav={setScreen} updateProfile={updProf}/>}
      {screen==="listening"  &&<ListeningModule user={user} profile={profile} updateProfile={updProf}/>}
      {screen==="reading"    &&<ReadingModule user={user} profile={profile} updateProfile={updProf}/>}
      {screen==="speaking"   &&<SpeakingModule user={user} profile={profile} updateProfile={updProf}/>}
      {(screen==="grammar"||screen==="writing")&&<ChatPane user={user} profile={profile} updateProfile={updProf} modId={screen}/>}
    </main>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      ::-webkit-scrollbar{width:5px;} ::-webkit-scrollbar-track{background:#F9FAFB;} ::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:4px;}
      input::placeholder{color:#9CA3AF!important;} textarea::placeholder{color:#9CA3AF!important;}
      @keyframes bounce{0%,80%,100%{transform:scale(0.55);opacity:0.35}40%{transform:scale(1.1);opacity:1}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{box-shadow:0 0 0 6px rgba(220,38,38,0.2)}50%{box-shadow:0 0 0 12px rgba(220,38,38,0.05)}}
    `}</style>
  </div>);
}
